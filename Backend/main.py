# main.py (FastAPI Backend - MULTI-FRAME VIDEO ANALYSIS + T5 SUMMARIZATION)

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
from transformers import (
    pipeline, 
    BlipProcessor, 
    BlipForConditionalGeneration,
    Blip2Processor,
    Blip2ForConditionalGeneration,
    T5ForConditionalGeneration,
    T5Tokenizer
)
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
    fast: bool | None = None  # Optional: request faster captioning on CPU

class VideoSequenceInput(BaseModel):
    frames: list[str]  # List of base64 images (6 frames)

class CaptionSummarizationInput(BaseModel):
    captions: list[str]  # List of captions to summarize (NEW for parallel processing)

# --- Initialize FastAPI App ---
app = FastAPI(
    title="ReadBuddy AI Backend",
    description="Summarizes webpage text, generates captions for images, and analyzes video sequences",
    version="6.0.0"
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
t5_model = None
t5_tokenizer = None
device = None
image_transform = None

# --- Model Loading ---
@app.on_event("startup")
def load_models():
    global summarizer, processor, blip_model, t5_model, t5_tokenizer, device, image_transform
    print("⏳ Loading AI models (this may take a few minutes)...")
    
    # Properly set device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"🔧 Using device: {device}")
    
    try:
        # 1. Summarization Model (BART) for long text
        device_id = 0 if torch.cuda.is_available() else -1
        summarizer = pipeline(
            "summarization", 
            model="facebook/bart-large-cnn", 
            device=device_id
        )
        print("✅ BART summarization model loaded")

        # 2. Image Captioning Model (BLIP-2 FlanT5-XXL - BETTER QUALITY + MORE STABLE)
        print("⏳ Loading BLIP-2 model (better quality captioning)...")
        try:
            # Try BLIP-2 FlanT5 first (more stable, better quality)
            processor = Blip2Processor.from_pretrained(
                "Salesforce/blip2-flan-t5-xl",
                local_files_only=False,
                trust_remote_code=True
            )
            blip_model = Blip2ForConditionalGeneration.from_pretrained(
                "Salesforce/blip2-flan-t5-xl",
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                local_files_only=False,
                trust_remote_code=True
            ).to(device)
            print("✅ BLIP-2 FlanT5-XL loaded (best quality!)")
            
        except Exception as e:
            print(f"⚠️ BLIP-2 FlanT5-XL failed: {e}")
            print("🔄 Falling back to BLIP-2 FlanT5-base (smaller, faster)...")
            
            try:
                processor = Blip2Processor.from_pretrained(
                    "Salesforce/blip2-flan-t5-base",
                    local_files_only=False
                )
                blip_model = Blip2ForConditionalGeneration.from_pretrained(
                    "Salesforce/blip2-flan-t5-base",
                    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                    local_files_only=False
                ).to(device)
                print("✅ BLIP-2 FlanT5-base loaded (good quality)")
                
            except Exception as e2:
                print(f"⚠️ BLIP-2 FlanT5-base also failed: {e2}")
                print("🔄 Falling back to original BLIP-base (most stable)...")
                
                # Ultimate fallback: original BLIP
                processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
                blip_model = BlipForConditionalGeneration.from_pretrained(
                    "Salesforce/blip-image-captioning-base"
                ).to(device)
                print("✅ BLIP-base loaded (fallback, basic quality)")
        
        # 3. Manual image preprocessing transform (FALLBACK for BLIP-2)
        image_transform = transforms.Compose([
            transforms.Resize((224, 224)),  # BLIP-2 uses 224x224
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.48145466, 0.4578275, 0.40821073],
                std=[0.26862954, 0.26130258, 0.27577711]
            )
        ])
        
        print("✅ Image captioning model loaded successfully")

        # 4. T5 Model for Video Sequence Summarization
        print("⏳ Loading T5 model for video summarization...")
        t5_tokenizer = T5Tokenizer.from_pretrained("t5-base")
        t5_model = T5ForConditionalGeneration.from_pretrained("t5-base").to(device)
        print("✅ T5 summarization model loaded")
        
        # Verify models loaded
        if processor is None or blip_model is None:
            raise RuntimeError("BLIP model or processor failed to load")
        
        if t5_model is None or t5_tokenizer is None:
            raise RuntimeError("T5 model or tokenizer failed to load")
        
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

def generate_detailed_caption(img, fast: bool = False):
    """
        Generate DETAILED, LONG captions for video frames using BLIP model
        Focuses on visual details like colors, actions, movements for blind users
    """
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
                pixel_values = image_transform(img).unsqueeze(0).to(device)
                inputs = {"pixel_values": pixel_values}
                print("   ✅ Method 2 (manual): Success")
                
            except Exception as e2:
                print(f"   ⚠️ Method 2 also failed: {e2}")
                print("   🔄 Trying Method 3 (raw tensor conversion)...")
                
                # METHOD 3: Direct numpy to tensor (LAST RESORT)
                try:
                    img_resized = img.resize((224, 224), Image.Resampling.LANCZOS)  # BLIP-2 uses 224x224
                    img_array = np.array(img_resized).astype(np.float32) / 255.0
                    mean = np.array([0.48145466, 0.4578275, 0.40821073])
                    std = np.array([0.26862954, 0.26130258, 0.27577711])
                    img_array = (img_array - mean) / std
                    img_tensor = torch.from_numpy(img_array).permute(2, 0, 1).unsqueeze(0).float().to(device)
                    inputs = {"pixel_values": img_tensor}
                    print("   ✅ Method 3 (raw): Success")
                    
                except Exception as e3:
                    print(f"   ❌ All methods failed: {e3}")
                    return None

        # IMPROVED: Better captions with more detail for better summaries
        use_fast = fast or (device is not None and device.type != 'cuda')

        gen_kwargs = {
            'max_length': 80,         # INCREASED: More detailed captions (was 200)
            'min_length': 25,         # INCREASED: Ensure substantial descriptions (was 50)
            'num_beams': 5,           # BALANCED: Good quality (was 8)
            'length_penalty': 1.2,    # ADJUSTED: Slightly prefer longer captions (was 1.0)
            'repetition_penalty': 2.5, # INCREASED: Prevent repetitive phrases (was 2.0)
            'early_stopping': True,
            'do_sample': False,
        }

        if use_fast:
            gen_kwargs.update({
                'max_length': 75,     # INCREASED: Better quality even in fast mode (was 60)
                'min_length': 20,     # INCREASED: Ensure meaningful captions (was 10)
                'num_beams': 3,       # INCREASED: Balance speed and quality (was 1)
            })

        # Generate caption
        with torch.no_grad():
            generated_ids = blip_model.generate(
                **inputs,
                **gen_kwargs
            )

        # Decode caption
        caption = processor.decode(generated_ids[0], skip_special_tokens=True)
        caption = caption.strip()
        
        # Capitalize first letter and add period if needed
        if caption:
            caption = caption[0].upper() + caption[1:] if len(caption) > 1 else caption.upper()
            if not caption.endswith(('.', '!', '?')):
                caption += '.'

        return caption if caption else None

    except Exception as e:
        print(f"   ⚠️ Detailed caption generation error: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def generate_caption_safe(img):
    """
    Generate caption for an image using BLIP model (original function, kept for compatibility)
    """
    return generate_detailed_caption(img)

def summarize_video_sequence(captions_list):
    """
    Summarizes multiple video frame captions into a coherent narrative using T5
    
    Args:
        captions_list: List of 6 caption strings
        
    Returns:
        Coherent summary string
    """
    try:
        if not captions_list or len(captions_list) == 0:
            return "No captions available to summarize."
        
        # Filter out error captions
        valid_captions = [c for c in captions_list if c and not c.startswith("Frame") and not c.startswith("Unable")]
        
        if len(valid_captions) == 0:
            return "Unable to generate summary from the provided frames."
        
        # IMPROVED: Simple, direct prompt that won't be repeated in output
        # Concatenate captions into a narrative
        caption_text = ". ".join([c for c in valid_captions])
        input_text = f"summarize: In this 30-second video sequence: {caption_text}"
        
        # Tokenize
        inputs = t5_tokenizer(
            input_text,
            return_tensors="pt",
            max_length=512,
            truncation=True,
            padding=True
        ).to(device)
        
        # IMPROVED: Generate coherent, natural summary
        with torch.no_grad():
            summary_ids = t5_model.generate(
                inputs.input_ids,
                max_length=200,        # Moderate length for TTS
                min_length=60,         # Ensure substantial output
                num_beams=4,           # Balance quality and speed
                length_penalty=2.0,    # Encourage complete sentences
                repetition_penalty=2.5, # Avoid repetition
                early_stopping=True,
                no_repeat_ngram_size=3, # Prevent 3-gram repetition
                do_sample=False        # Deterministic for consistency
            )
        
        summary = t5_tokenizer.decode(summary_ids[0], skip_special_tokens=True)
        summary = summary.strip()
        
        # CRITICAL: Remove any prompt leakage from T5 output
        # T5 sometimes repeats the input - strip known prompt patterns
        prompt_patterns = [
            "summarize:",
            "Describe what is visually happening",
            "Create a vivid narrative",
            "Make it flow like a story",
            "Here are the frame descriptions:",
            "In this 30-second video sequence:"
        ]
        
        for pattern in prompt_patterns:
            if summary.lower().startswith(pattern.lower()):
                summary = summary[len(pattern):].strip()
        
        # Capitalize and add period
        if summary:
            summary = summary[0].upper() + summary[1:] if len(summary) > 1 else summary.upper()
            if not summary.endswith(('.', '!', '?')):
                summary += '.'
        
        return summary if summary else "Unable to generate a coherent summary."
        
    except Exception as e:
        print(f"❌ Error in summarize_video_sequence: {e}")
        import traceback
        traceback.print_exc()
        return f"Error generating summary: {str(e)}"

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
            "image_captioning": "BLIP-Base (Enhanced)",
            "video_summarization": "T5-Base",
            "device": str(device),
            "models_loaded": {
                "summarizer": summarizer is not None,
                "blip_processor": processor is not None,
                "blip_model": blip_model is not None,
                "t5_model": t5_model is not None,
                "t5_tokenizer": t5_tokenizer is not None
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

        # Generate DETAILED caption (fast mode on CPU if requested)
        try:
            fast_mode = bool(data.fast) if data.fast is not None else (device is not None and device.type != 'cuda')
            description = generate_detailed_caption(image, fast=fast_mode)
            
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

@app.post("/analyze-video-sequence")
async def analyze_video_sequence(data: VideoSequenceInput):
    """
    Analyzes a sequence of video frames (6 frames) and returns:
    - Individual captions for each frame
    - A summarized narrative of the entire sequence
    """
    print(f"🎬 Received video sequence analysis request ({len(data.frames)} frames)")
    
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
    
    if not t5_model or not t5_tokenizer:
        print("❌ T5 model not loaded")
        return JSONResponse(
            status_code=503,
            content={"error": "T5 Summarization model not loaded."},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )

    try:
        captions = []
        
        # Process each frame
        for i, frame_data in enumerate(data.frames):
            try:
                print(f"   Processing frame {i+1}/{len(data.frames)}...")
                
                # Handle data URL prefix
                if ',' in frame_data:
                    header, encoded_data = frame_data.split(',', 1)
                else:
                    encoded_data = frame_data
                
                # Decode base64
                image_bytes = base64.b64decode(encoded_data)
                image = Image.open(io.BytesIO(image_bytes))
                
                if image.mode != 'RGB':
                    image = image.convert('RGB')
                
                # Generate detailed caption
                caption = generate_detailed_caption(image)
                
                if caption:
                    captions.append(caption)
                    print(f"   ✅ Frame {i+1}: {caption[:50]}...")
                else:
                    captions.append(f"Frame {i+1}: Unable to analyze")
                    print(f"   ⚠️ Frame {i+1}: Failed to generate caption")
                
            except Exception as e:
                error_msg = f"Frame {i+1}: Error - {str(e)}"
                captions.append(error_msg)
                print(f"   ❌ {error_msg}")
        
        # Generate summary from all captions
        print("📝 Generating summary from all captions...")
        summary = summarize_video_sequence(captions)
        print(f"✅ Summary generated: {summary[:100]}...")
        
        return JSONResponse(
            content={
                "individual_captions": captions,
                "summary": summary,
                "frame_count": len(data.frames),
                "status": "success"
            },
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )
        
    except Exception as e:
        print(f"❌ Error in video sequence analysis: {e}")
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

@app.post("/summarize-captions")
async def summarize_captions(data: CaptionSummarizationInput):
    """
    NEW: Summarizes an array of captions into a coherent narrative (for parallel processing)
    
    This endpoint is used when frames are captured and captioned in parallel,
    then sent here for final summarization once all captions are collected.
    """
    print(f"📝 Received caption summarization request ({len(data.captions)} captions)")
    
    # Check if T5 model is loaded
    if not t5_model or not t5_tokenizer:
        print("❌ T5 model not loaded")
        return JSONResponse(
            status_code=503,
            content={"error": "T5 Summarization model not loaded."},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )

    try:
        # Validate input
        if not data.captions or len(data.captions) == 0:
            raise ValueError("No captions provided")
        
        print(f"   Captions received:")
        for i, caption in enumerate(data.captions):
            print(f"   {i+1}. {caption[:60]}...")
        
        # Generate summary using the same T5 function
        summary = summarize_video_sequence(data.captions)
        print(f"✅ Summary generated: {summary[:100]}...")
        
        return JSONResponse(
            content={
                "summary": summary,
                "caption_count": len(data.captions),
                "status": "success"
            },
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )
        
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
        print(f"❌ Error in caption summarization: {e}")
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

@app.options("/analyze-video-sequence")
async def options_analyze_video_sequence():
    """Handle preflight requests for video sequence analysis"""
    return JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "3600",
        }
    )

@app.options("/summarize-captions")
async def options_summarize_captions():
    """Handle preflight requests for caption summarization"""
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
            # Process all images but limit results to 5
            if valid_images >= 5:
                print(f"   ⏭️ Skipping image {idx}/{len(image_urls)} - already have 5 captions")
                break
                
            if not url.startswith("http"):
                print(f"   ⏭️ Skipping image {idx}/{len(image_urls)} - not HTTP URL")
                continue

            try:
                print(f"   📥 Processing image {idx}/{len(image_urls)}: {url[:60]}...")
                image_data = download_image_safe(url)
                img = Image.open(io.BytesIO(image_data))
                
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                width, height = img.size
                print(f"      Image size: {width}x{height}")
                
                if width < 50 or height < 50:
                    print(f"   ⏭️ Skipping image {idx} - too small ({width}x{height})")
                    continue
                
                max_size = 384
                if max(width, height) > max_size:
                    ratio = max_size / max(width, height)
                    new_width = int(width * ratio)
                    new_height = int(height * ratio)
                    img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                    print(f"      Resized to: {new_width}x{new_height}")
                
                caption_text = generate_caption_safe(img)
                
                if caption_text:
                    image_descriptions.append({
                        "url": url,
                        "caption": caption_text,
                        "size": f"{width}x{height}"
                    })
                    valid_images += 1
                    print(f"   ✅ Caption {valid_images}: {caption_text[:60]}...")
                else:
                    print(f"   ⚠️ Image {idx} - caption generation returned None")
                
            except UnidentifiedImageError as e:
                print(f"   ❌ Image {idx} - UnidentifiedImageError: {str(e)[:100]}")
                continue
            except requests.exceptions.RequestException as e:
                print(f"   ❌ Image {idx} - Network error: {str(e)[:100]}")
                continue
            except Exception as e:
                print(f"   ❌ Image {idx} - Unexpected error: {str(e)[:100]}")
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
                    description = f"YouTube video detected (ID: {youtube_id}). Visual analysis is available via '/analyze-video-frame' or '/analyze-video-sequence' endpoint."
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