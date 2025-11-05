# main.py (FastAPI Backend - TENSOR CONVERSION FIX)

import os
import io
import base64
import urllib3
import requests
import torch
import numpy as np
from torchvision import transforms

from PIL import Image, UnidentifiedImageError
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from transformers import pipeline, BlipProcessor, BlipForConditionalGeneration
from urllib.parse import urlparse, parse_qs
from requests.adapters import HTTPAdapter, Retry

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- Pydantic Models ---
class PageInput(BaseModel):
    text: str
    images: list[str]
    videos: list[str]

class VideoFrameInput(BaseModel):
    image_data: str  # Base64 image data

# --- Initialize FastAPI App ---
app = FastAPI(
    title="ReadBuddy AI Backend",
    description="Summarizes webpage text, generates captions for images, and analyzes videos",
    version="5.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

# --- Global Models ---
summarizer = None
processor = None
blip_model = None
device = None
image_transform = None

# --- Model Loading ---
@app.on_event("startup")
def load_models():
    global summarizer, processor, blip_model, device, image_transform
    print("⏳ Loading AI models (this may take a minute)...")
    
    # Properly set device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"🔧 Using device: {device}")
    
    try:
        # 1. Summarization Model (BART)
        device_id = 0 if torch.cuda.is_available() else -1
        summarizer = pipeline(
            "summarization", 
            model="facebook/bart-large-cnn", 
            device=device_id
        )
        print("✅ Summarization model loaded")

        # 2. Image Captioning Model (BLIP)
        processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
        blip_model = BlipForConditionalGeneration.from_pretrained(
            "Salesforce/blip-image-captioning-base"
        ).to(device)
        
        # 3. Manual image preprocessing transform (FALLBACK)
        # This bypasses processor issues by manually preprocessing
        image_transform = transforms.Compose([
            transforms.Resize((384, 384)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.48145466, 0.4578275, 0.40821073],
                std=[0.26862954, 0.26130258, 0.27577711]
            )
        ])
        
        # Verify models loaded
        if processor is None or blip_model is None:
            raise RuntimeError("BLIP model or processor failed to load")
        
        print(f"✅ All models loaded successfully on {device}!")

    except Exception as e:
        print(f"⚠️ Error loading one or more models: {e}")
        import traceback
        traceback.print_exc()
        raise

# --- Helper Functions ---

def extract_youtube_id(url):
    try:
        parsed = urlparse(url)
        if 'youtube.com' in parsed.netloc:
            return parse_qs(parsed.query).get('v', [None])[0]
        elif 'youtu.be' in parsed.netloc:
            return parsed.path.strip('/')
    except:
        pass
    return None

def generate_caption_safe(img):
    """Generate caption for an image using BLIP model with MANUAL tensor handling"""
    try:
        # Verify models are loaded
        if processor is None or blip_model is None:
            print("   ⚠️ BLIP model not loaded")
            return None

        # Ensure it's a PIL Image
        if not isinstance(img, Image.Image):
            if isinstance(img, np.ndarray):
                if img.dtype in [np.float32, np.float64]:
                    if img.max() <= 1.0:
                        img = (img * 255).astype(np.uint8)
                    else:
                        img = img.astype(np.uint8)
                img = Image.fromarray(img)
            else:
                raise ValueError(f"Expected PIL Image, got {type(img)}")

        # Ensure RGB mode
        if img.mode != 'RGB':
            img = img.convert('RGB')

        # METHOD 1: Try using processor with list wrapping (batch mode)
        try:
            inputs = processor(
                images=[img],  # Wrap in list for batch processing
                return_tensors="pt",
                padding=True
            )
            
            # Move tensors to device
            inputs = {k: v.to(device) if isinstance(v, torch.Tensor) else v 
                      for k, v in inputs.items()}
            
            print("   ✅ Method 1 (processor): Success")
            
        except Exception as e:
            print(f"   ⚠️ Method 1 failed: {e}")
            print("   🔄 Trying Method 2 (manual transform)...")
            
            # METHOD 2: Manual preprocessing (FALLBACK)
            try:
                # Manually transform the image
                pixel_values = image_transform(img).unsqueeze(0).to(device)
                inputs = {"pixel_values": pixel_values}
                print("   ✅ Method 2 (manual): Success")
                
            except Exception as e2:
                print(f"   ⚠️ Method 2 also failed: {e2}")
                print("   🔄 Trying Method 3 (raw tensor conversion)...")
                
                # METHOD 3: Direct numpy to tensor (LAST RESORT)
                try:
                    # Resize image
                    img_resized = img.resize((384, 384), Image.Resampling.LANCZOS)
                    
                    # Convert to numpy and normalize
                    img_array = np.array(img_resized).astype(np.float32) / 255.0
                    
                    # Normalize with CLIP stats
                    mean = np.array([0.48145466, 0.4578275, 0.40821073])
                    std = np.array([0.26862954, 0.26130258, 0.27577711])
                    img_array = (img_array - mean) / std
                    
                    # Convert to tensor: (H, W, C) -> (C, H, W)
                    img_tensor = torch.from_numpy(img_array).permute(2, 0, 1).unsqueeze(0).float().to(device)
                    inputs = {"pixel_values": img_tensor}
                    print("   ✅ Method 3 (raw): Success")
                    
                except Exception as e3:
                    print(f"   ❌ All methods failed: {e3}")
                    return None

        # Generate caption
        with torch.no_grad():
            generated_ids = blip_model.generate(
                **inputs,
                max_length=50,
                num_beams=3,
                early_stopping=True
            )

        # Decode and clean caption
        caption = processor.decode(generated_ids[0], skip_special_tokens=True)
        caption = caption.strip()
        
        # Capitalize first letter and add period if needed
        if caption:
            caption = caption[0].upper() + caption[1:] if len(caption) > 1 else caption.upper()
            if not caption.endswith(('.', '!', '?')):
                caption += '.'

        return caption if caption else None

    except Exception as e:
        print(f"   ⚠️ Caption generation error: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def download_image_safe(url, timeout=15):
    session = requests.Session()
    retries = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["GET"]
    )
    session.mount("https://", HTTPAdapter(max_retries=retries))
    session.mount("http://", HTTPAdapter(max_retries=retries))
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }

    try:
        response = session.get(url, timeout=timeout, verify=True, headers=headers)
        response.raise_for_status()
        return response.content

    except requests.exceptions.SSLError:
        try:
            response = requests.get(url, timeout=timeout, verify=False, headers=headers)
            response.raise_for_status()
            return response.content
        except Exception:
            raise
    except Exception:
        raise

# --- Global Exception Handler ---
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch all exceptions and return proper JSON response with CORS headers"""
    print(f"❌ Global exception: {exc}")
    import traceback
    traceback.print_exc()
    
    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc),
            "error_type": type(exc).__name__,
            "message": "An internal error occurred. Check server logs for details."
        },
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        }
    )

# --- Endpoints ---

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "online",
        "version": app.version,
        "device": str(device),
        "models": {
            "summarizer": "BART-Large-CNN",
            "image_captioning": "BLIP-Base",
            "device": str(device),
            "models_loaded": {
                "summarizer": summarizer is not None,
                "blip_processor": processor is not None,
                "blip_model": blip_model is not None
            }
        }
    }

@app.post("/analyze-video-frame")
async def analyze_video_frame(data: VideoFrameInput):
    """Analyzes a single video frame (Base64 image) and returns a description."""
    print("📹 Received video frame analysis request")
    
    # Check if models are loaded
    if not blip_model or not processor:
        print("❌ BLIP model not loaded")
        return JSONResponse(
            status_code=503,
            content={"error": "BLIP Image Captioning model not loaded."},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )

    try:
        # Validate input
        if not data.image_data:
            raise ValueError("No image data provided")
        
        # Handle both with and without data URL prefix
        image_data_str = data.image_data
        if ',' in image_data_str:
            header, encoded_data = image_data_str.split(',', 1)
        else:
            encoded_data = image_data_str
        
        # Decode Base64 string to bytes
        try:
            image_bytes = base64.b64decode(encoded_data)
        except Exception as e:
            print(f"❌ Base64 decode error: {e}")
            raise ValueError(f"Invalid base64 encoding: {str(e)}")
        
        # Open image using PIL
        try:
            image = Image.open(io.BytesIO(image_bytes))
            
            # Convert to RGB if needed
            if image.mode != 'RGB':
                image = image.convert('RGB')
                
            print(f"✅ Image loaded successfully: {image.size}, mode: {image.mode}")
            
        except Exception as e:
            print(f"❌ PIL Image open error: {e}")
            raise ValueError(f"Invalid image data: {str(e)}")

        # Generate caption using the multi-method safe function
        try:
            description = generate_caption_safe(image)
            
            if not description:
                description = "Unable to generate description for this frame."
                print(f"⚠️ No description generated, using fallback")
            else:
                print(f"✅ Generated description: {description}")
            
            return JSONResponse(
                content={"description": description, "status": "success"},
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                    "Access-Control-Allow-Headers": "*",
                }
            )
            
        except Exception as e:
            print(f"❌ Caption generation error: {e}")
            import traceback
            traceback.print_exc()
            raise ValueError(f"Error generating description: {str(e)}")

    except ValueError as ve:
        print(f"❌ Validation error: {ve}")
        return JSONResponse(
            status_code=400,
            content={"error": str(ve), "status": "error"},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": f"Internal server error: {str(e)}", "status": "error"},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )

@app.options("/analyze-video-frame")
async def options_analyze_video_frame():
    """Handle preflight requests for video frame analysis"""
    return JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "3600",
        }
    )

@app.post("/analyze-page")
async def analyze_page(request: Request):
    """
    Receives webpage text + image URLs + video URLs from Chrome extension.
    Returns summarized text, AI-generated image captions, and video descriptions.
    """
    try:
        data = await request.json()
        text = data.get("text", "")
        image_urls = data.get("images", [])
        video_urls = data.get("videos", [])
        
        print(f"📥 Received {len(image_urls)} images, {len(video_urls)} videos")
        
        # --- TEXT SUMMARIZATION ---
        summaries = []
        if text and text.strip():
            chunks = [text[i:i + 2000] for i in range(0, len(text), 2000)]
            for idx, chunk in enumerate(chunks, 1):
                try:
                    summary = summarizer(chunk, max_length=130, min_length=30, do_sample=False)
                    summaries.append(summary[0]["summary_text"])
                except Exception as e:
                    summaries.append(f"⚠️ Error summarizing chunk {idx}: {str(e)}")
        else:
            summaries = ["No readable text found on this page."]

        # --- IMAGE CAPTIONING ---
        image_descriptions = []
        valid_images = 0
        
        for idx, url in enumerate(image_urls, 1):
            if valid_images >= 5:
                break
                
            if not url.startswith("http"):
                continue

            try:
                image_data = download_image_safe(url)
                img = Image.open(io.BytesIO(image_data))
                
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                width, height = img.size
                
                if width < 50 or height < 50:
                    continue
                
                max_size = 384
                if max(width, height) > max_size:
                    ratio = max_size / max(width, height)
                    new_width = int(width * ratio)
                    new_height = int(height * ratio)
                    img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                
                caption_text = generate_caption_safe(img)
                
                if caption_text:
                    image_descriptions.append({
                        "url": url,
                        "caption": caption_text,
                        "size": f"{width}x{height}"
                    })
                    valid_images += 1
                
            except (UnidentifiedImageError, requests.exceptions.RequestException):
                continue
            except Exception:
                continue

        if not image_descriptions:
            image_descriptions = [{"caption": "No valid images found or could not generate captions.", "url": "", "size": ""}]

        # --- VIDEO ANALYSIS ---
        video_descriptions = []
        valid_videos = 0
        
        for idx, url in enumerate(video_urls, 1):
            if valid_videos >= 3:
                break
            
            try:
                youtube_id = extract_youtube_id(url)
                
                if youtube_id:
                    description = f"YouTube video detected (ID: {youtube_id}). Visual analysis is available via '/analyze-video-frame' endpoint."
                    video_type = "youtube"
                else:
                    description = "Video detected. Detailed analysis requires the separate visual frame analysis feature from the extension."
                    video_type = "video"
                
                video_descriptions.append({
                    "url": url,
                    "type": video_type,
                    "description": description,
                    "method": "detection"
                })
                valid_videos += 1
                        
            except Exception:
                continue

        if not video_descriptions:
            video_descriptions = [{"description": "No videos found on this page.", "url": "", "type": "none"}]

        print(f"✅ Processing complete: {valid_images} images, {valid_videos} videos, {len(summaries)} text chunks")
        
        return {
            "summaries": summaries,
            "image_descriptions": image_descriptions,
            "video_descriptions": video_descriptions,
            "count": {
                "images_processed": valid_images,
                "images_received": len(image_urls),
                "videos_processed": valid_videos,
                "videos_received": len(video_urls),
                "text_chunks": len(summaries)
            }
        }
        
    except Exception as e:
        print(f"❌ Error in /analyze-page: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal server error during page analysis.")

@app.options("/analyze-page")
async def options_analyze_page():
    """Handle preflight requests for page analysis"""
    return JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "3600",
        }
    )

if __name__ == "__main__":
    load_models() 
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)