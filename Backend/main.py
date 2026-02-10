# main.py (FastAPI Backend - MULTI-FRAME VIDEO ANALYSIS + PEGASUS SUMMARIZATION)
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
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from transformers import (
    pipeline, 
    Blip2Processor,
    BlipImageProcessor,
    AutoTokenizer,
    InstructBlipForConditionalGeneration,
    PegasusForConditionalGeneration,
    PegasusTokenizer
)
from urllib.parse import urlparse, parse_qs
from requests.adapters import HTTPAdapter, Retry

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Google Gemini API Configuration - Multiple keys for failover
GEMINI_API_KEYS = [
    "AIzaSyB8REm_mE21KUvaqyBvW3TAud8sUr4vEFM",
    "AIzaSyAnZF9D6t_aFim2-5XN0vkNTO6f4LrZ5EY",
    "AIzaSyAEewmCimLn3gU0IdNN4AdcN_VfEsPgti0",
    "AIzaSyB-BRRFMCHjXNRAhO5_O3DBw7KvjSi6-4k",
    "AIzaSyBnhGuphkyqBlqn-4G6LC2fyVXjI16MOAo",
    "AIzaSyBJ2ETFfZ6iMBk0lIMYFn8NG5b5TCLv57Y"
]
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent"
current_gemini_key_index = 0  # Track which key we're currently using

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
# summarizer = None  # REMOVED - Using Gemini API instead to save memory
processor = None
image_processor_standalone = None  # For separate image processing if needed
tokenizer_standalone = None  # For separate text tokenization if needed
instructblip_model = None
pegasus_model = None
pegasus_tokenizer = None
device = None
image_transform = None

# --- Model Loading ---
@app.on_event("startup")
def load_models():
    global processor, image_processor_standalone, tokenizer_standalone, instructblip_model, pegasus_model, pegasus_tokenizer, device, image_transform
    print("⏳ Loading AI models (this may take a few minutes)...")
    
    # Properly set device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"🔧 Using device: {device}")
    
    try:
        # REMOVED: BART summarization model (too large, using Gemini API instead)
        # We'll use Gemini API for text summarization to save memory
        summarizer = None
        print("✅ Text summarization: Using Gemini API (no local model needed)")

        # Image Captioning: Primary = InstructBLIP, Fallback = Gemini API
        print("⏳ Loading InstructBLIP model (primary for image captioning)...")
        print("   Note: Gemini API will be used as fallback if this fails")
        
        # Import the components we need to manually construct the processor
        from transformers import BlipImageProcessor, AutoTokenizer
        
        try:
            # Load InstructBLIP-FlanT5-XL as primary image captioning model
            print("   Loading InstructBLIP-FlanT5-XL (primary captioning model)...")
            
            # Load image processor and tokenizer separately to avoid config conflicts
            image_processor_standalone = BlipImageProcessor.from_pretrained("Salesforce/instructblip-flan-t5-xl")
            tokenizer_standalone = AutoTokenizer.from_pretrained("Salesforce/instructblip-flan-t5-xl", use_fast=False)
            
            # Manually construct the processor (Blip2Processor expects image_processor and tokenizer)
            processor = Blip2Processor(image_processor=image_processor_standalone, tokenizer=tokenizer_standalone)
            
            instructblip_model = InstructBlipForConditionalGeneration.from_pretrained(
                "Salesforce/instructblip-flan-t5-xl",
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                device_map="auto" if torch.cuda.is_available() else None,
                low_cpu_mem_usage=True
            )
            if not torch.cuda.is_available():
                instructblip_model = instructblip_model.to(device)
            
            # SPEED OPTIMIZATION: Enable inference mode and CPU optimizations
            instructblip_model.eval()
            
            if device.type == 'cpu':
                print("   🚀 Applying CPU optimizations...")
                try:
                    torch.set_num_threads(4)  # Limit threads to reduce overhead
                    torch.set_flush_denormal(True)  # Faster float operations
                except Exception as opt_err:
                    print(f"   ⚠️ Some CPU optimizations unavailable: {opt_err}")
            
            print("✅ InstructBLIP-FlanT5-XL loaded successfully (PRIMARY for images)!")
            
        except Exception as e:
            print(f"⚠️ InstructBLIP loading failed: {e}")
            print("⚠️ Continuing without InstructBLIP (Gemini API will be used as primary)")
            processor = None
            image_processor_standalone = None
            tokenizer_standalone = None
            instructblip_model = None
        
        # 3. Manual image preprocessing transform
        image_transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.48145466, 0.4578275, 0.40821073],
                std=[0.26862954, 0.26130258, 0.27577711]
            )
        ])
        
        print("✅ Image captioning setup complete (InstructBLIP primary, Gemini fallback)")

        # 4. Pegasus Model for Video Sequence Summarization
        print("⏳ Loading Pegasus model for video summarization...")
        pegasus_tokenizer = PegasusTokenizer.from_pretrained("google/pegasus-xsum")
        pegasus_model = PegasusForConditionalGeneration.from_pretrained("google/pegasus-xsum").to(device)
        print("✅ Pegasus summarization model loaded")
        
        # Verify critical models loaded
        if pegasus_model is None or pegasus_tokenizer is None:
            raise RuntimeError("Pegasus model or tokenizer failed to load")
        
        print(f"✅ All models loaded successfully on {device}!")
        print(f"📊 Memory usage: InstructBLIP (~5GB primary), Pegasus (~2GB), Gemini API (cloud fallback)")
        print(f"💡 Image captioning priority: InstructBLIP → Gemini API")

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

def generate_gemini_caption(img):
    """
    Generate detailed image caption using Google Gemini API with automatic failover.
    Tries multiple API keys in sequence if one fails due to quota/rate limits.
    
    Args:
        img: PIL Image object
        
    Returns:
        str: Detailed caption or None if all keys fail
    """
    global current_gemini_key_index
    
    try:
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
        
        # Convert image to base64
        buffered = io.BytesIO()
        img.save(buffered, format="JPEG", quality=85)
        img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        # Prepare Gemini API request
        headers = {
            "Content-Type": "application/json"
        }
        
        payload = {
            "contents": [{
                "parts": [
                    {
                        "text": "Describe this image in detail for a visually impaired person. Include colors, objects, people, actions, settings, and any text visible. Be descriptive and thorough (4-6 sentences)."
                    },
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": img_base64
                        }
                    }
                ]
            }],
            "generationConfig": {
                "temperature": 0.4,
                "topK": 32,
                "topP": 1,
                "maxOutputTokens": 300  # Increased from 200 for longer descriptions
            }
        }
        
        # Try each API key in sequence until one succeeds
        for attempt in range(len(GEMINI_API_KEYS)):
            # Calculate which key to try (rotate through keys)
            key_index = (current_gemini_key_index + attempt) % len(GEMINI_API_KEYS)
            api_key = GEMINI_API_KEYS[key_index]
            
            try:
                # Make API request with current key
                response = requests.post(
                    f"{GEMINI_API_URL}?key={api_key}",
                    headers=headers,
                    json=payload,
                    timeout=15
                )
                
                if response.status_code == 200:
                    result = response.json()
                    
                    # Extract caption from response
                    if 'candidates' in result and len(result['candidates']) > 0:
                        candidate = result['candidates'][0]
                        if 'content' in candidate and 'parts' in candidate['content']:
                            parts = candidate['content']['parts']
                            if len(parts) > 0 and 'text' in parts[0]:
                                caption = parts[0]['text'].strip()
                                
                                # Clean up the caption
                                if caption:
                                    # Capitalize first letter
                                    caption = caption[0].upper() + caption[1:] if len(caption) > 1 else caption.upper()
                                    # Add period if needed
                                    if not caption.endswith(('.', '!', '?')):
                                        caption += '.'
                                    
                                    # Success! Update the current key index for next time
                                    current_gemini_key_index = key_index
                                    print(f"   ✅ Gemini caption generated (API key #{key_index + 1}): {caption[:60]}...")
                                    return caption
                    
                    print(f"   ⚠️ Unexpected Gemini response format: {result}")
                    # Try next key
                    continue
                    
                elif response.status_code == 429:
                    # Quota exceeded - try next API key
                    print(f"   ⚠️ API key #{key_index + 1} quota exceeded, trying next key...")
                    continue
                    
                else:
                    # Other error - try next key
                    print(f"   ⚠️ API key #{key_index + 1} error {response.status_code}, trying next key...")
                    continue
                    
            except requests.exceptions.Timeout:
                print(f"   ⚠️ API key #{key_index + 1} timeout, trying next key...")
                continue
            except Exception as key_error:
                print(f"   ⚠️ API key #{key_index + 1} failed: {key_error}, trying next key...")
                continue
        
        # All keys failed
        print(f"   ❌ All {len(GEMINI_API_KEYS)} Gemini API keys failed")
        return None
            
    except Exception as e:
        print(f"   ❌ Gemini caption error: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def generate_detailed_caption(img, fast: bool = False):
    """
    Generate DETAILED, LONG captions for video frames using InstructBLIP model
    Uses instruction prompts to guide the model for accessibility-focused descriptions
    """
    try:
        # Verify models are loaded
        if processor is None or instructblip_model is None:
            print("   ⚠️ InstructBLIP model not loaded")
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

        # InstructBLIP requires a text prompt (instruction)
        # Optimized prompt for accessibility - detailed visual descriptions
        prompt = "Provide a comprehensive and detailed description of this image for a visually impaired person. Include all colors, objects, people, their positions, actions, facial expressions, clothing, settings, background details, spatial relationships, and any text visible. Be thorough and complete."
        
        # Process image and prompt together
        try:
            # Try using the combined processor first
            inputs = processor(
                images=img,
                text=prompt,
                return_tensors="pt",
                padding="max_length",
                max_length=512,
                truncation=True
            )
            
            # Check if we got the required inputs
            if 'pixel_values' not in inputs or 'input_ids' not in inputs:
                print(f"   ⚠️ Processor didn't return expected keys: {list(inputs.keys())}")
                
                # Fallback: process image and text separately
                print(f"   🔄 Trying separate processing...")
                pixel_values = image_processor_standalone(images=img, return_tensors="pt").pixel_values
                text_inputs = tokenizer_standalone(
                    prompt,
                    return_tensors="pt",
                    padding="max_length",
                    max_length=512,
                    truncation=True
                )
                
                # Combine manually
                inputs = {
                    'pixel_values': pixel_values,
                    'input_ids': text_inputs.input_ids,
                    'attention_mask': text_inputs.attention_mask
                }
            
            # Move all tensors to device
            inputs = {k: v.to(device) if isinstance(v, torch.Tensor) else v for k, v in inputs.items()}
            
            # InstructBLIP expects 'qformer_input_ids' not 'input_ids'
            # Rename the key if needed
            if 'input_ids' in inputs and 'qformer_input_ids' not in inputs:
                print(f"   🔄 Renaming 'input_ids' to 'qformer_input_ids' for InstructBLIP")
                inputs['qformer_input_ids'] = inputs.pop('input_ids')
            
            if 'attention_mask' in inputs and 'qformer_attention_mask' not in inputs:
                print(f"   🔄 Renaming 'attention_mask' to 'qformer_attention_mask' for InstructBLIP")
                inputs['qformer_attention_mask'] = inputs.pop('attention_mask')
            
            print("   ✅ InstructBLIP processing: Success")
            print(f"   📊 Input keys: {list(inputs.keys())}")
            for key in inputs.keys():
                if isinstance(inputs[key], torch.Tensor):
                    print(f"   📊 {key} shape: {inputs[key].shape}")
            
        except Exception as e:
            print(f"   ❌ InstructBLIP processing failed: {e}")
            import traceback
            traceback.print_exc()
            return None

        # Generate caption with InstructBLIP
        use_fast = fast or (device is not None and device.type != 'cuda')

        gen_kwargs = {
            'max_length': 150,        # Reduced from 512 for faster video frame captioning
            'min_length': 40,         # Reduced from 100 - Still detailed but faster
            'num_beams': 3,           # Reduced from 5 for speed
            'length_penalty': 1.5,    # Reduced from 2.0
            'repetition_penalty': 2.5, # Prevent repetitive phrases
            'early_stopping': True,
            'do_sample': False,
        }

        if use_fast:
            # ULTRA-FAST mode for video frames on CPU (greedy decoding)
            gen_kwargs.update({
                'max_length': 60,     # Very short captions (was 100)
                'min_length': 20,     # Minimal requirement (was 30)
                'num_beams': 1,       # GREEDY DECODING - 2-3x faster! (was 2)
                'do_sample': False,   # Deterministic output
                # Remove early_stopping and length_penalty - not used with num_beams=1
            })

        # Generate caption with InstructBLIP
        with torch.no_grad():
            generated_ids = instructblip_model.generate(
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
    Generate caption for an image using Gemini API (primary) with InstructBLIP as fallback.
    For individual images (Alt+2), Gemini provides better quality and faster cloud processing.
    
    Args:
        img: PIL Image object or numpy array
        
    Returns:
        str: Image caption or error message
    """
    try:
        # Try Gemini API first (fast, cloud-based, high quality for individual images)
        print("   🌟 Trying Gemini API for image captioning (5 keys with failover)...")
        caption = generate_gemini_caption(img)
        
        if caption:
            print("   ✅ Gemini API caption successful")
            return caption
        
        # Fallback to InstructBLIP if all Gemini keys fail
        print("   ⚠️ All Gemini keys failed, falling back to InstructBLIP...")
        caption = generate_detailed_caption(img)
        
        if caption:
            print("   ✅ InstructBLIP caption successful")
            return caption
        
        return "Unable to generate caption for this image."
        
    except Exception as e:
        print(f"   ❌ Caption generation error: {str(e)}")
        return f"Error: {str(e)}"

def summarize_video_sequence(captions_list):
    """
    Summarizes multiple video frame captions into a coherent narrative using Pegasus
    
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
        
        # Concatenate captions into a narrative
        caption_text = ". ".join([c for c in valid_captions])
        input_text = f"summarize: {caption_text}"
        
        # Tokenize with Pegasus-XSUM's maximum supported length (512 tokens)
        # The model's position embeddings only support up to 512 positions
        inputs = pegasus_tokenizer(
            input_text,
            return_tensors="pt",
            max_length=512,  # Changed from 1024 - Pegasus position embeddings limit
            truncation=True,
            padding=True
        ).to(device)
        
        # Generate summary with Pegasus
        with torch.no_grad():
            summary_ids = pegasus_model.generate(
                inputs.input_ids,
                max_length=150,         # Moderate length for TTS
                min_length=40,          # Ensure substantial output
                num_beams=4,            # Balance quality and speed
                length_penalty=2.0,     # Encourage complete sentences
                early_stopping=True,
                no_repeat_ngram_size=3  # Prevent 3-gram repetition
            )
        
        summary = pegasus_tokenizer.decode(summary_ids[0], skip_special_tokens=True)
        summary = summary.strip()
        
        # Clean up any prompt leakage (Pegasus uses "summarize:" prefix)
        if summary.lower().startswith("summarize:"):
            summary = summary[10:].strip()
        elif summary.lower().startswith("video sequence:"):
            summary = summary[15:].strip()
        
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
            "text_summarization": "Google Gemini API with 6-key failover (Cloud)",
            "image_captioning": "Gemini API with 6-key failover (Primary) + InstructBLIP (Fallback)",
            "video_frame_captioning": "Gemini API with 6-key failover (Primary) + InstructBLIP (Fallback)",
            "video_summarization": "Pegasus-XSUM",
            "gemini_api_keys": f"{len(GEMINI_API_KEYS)} keys available",
            "device": str(device),
            "models_loaded": {
                "instructblip_processor": processor is not None,
                "instructblip_model": instructblip_model is not None,
                "pegasus_model": pegasus_model is not None,
                "pegasus_tokenizer": pegasus_tokenizer is not None
            },
            "memory_saved": "BART model removed - using Gemini API for text summarization"
        }
    }

@app.post("/analyze-video-frame")
async def analyze_video_frame(data: VideoFrameInput):
    """Analyzes a single video frame (Base64 image) and returns a description.
    For video frames, we use Gemini API as primary (fast, cloud-based, multiple keys for failover) with InstructBLIP as fallback."""
    print("📹 Received video frame analysis request")

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

        # FOR VIDEO FRAMES: Use Gemini API first (fast, cloud-based, with failover)
        # Then fall back to InstructBLIP if all Gemini keys fail
        try:
            print("   🌟 Trying Gemini API for video frame (fast, cloud-based, 3 keys)...")
            description = generate_gemini_caption(image)
            
            if description and description != "Unable to analyze this image":
                print(f"   ✅ Gemini caption successful: {description[:80]}...")
            else:
                # Fallback to InstructBLIP if all Gemini keys failed
                print("   ⚠️ All Gemini keys failed, falling back to InstructBLIP (slower)...")
                if instructblip_model and processor:
                    fast_mode = bool(data.fast) if data.fast is not None else (device is not None and device.type != 'cuda')
                    description = generate_detailed_caption(image, fast=fast_mode)
                    
                    if description:
                        print(f"   ✅ InstructBLIP caption successful: {description[:80]}...")
                    else:
                        description = "Unable to generate description for this frame."
                else:
                    description = "Unable to generate description for this frame."
            
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
    if not instructblip_model or not processor:
        print("❌ InstructBLIP model not loaded")
        return JSONResponse(
            status_code=503,
            content={"error": "InstructBLIP Image Captioning model not loaded."},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )
    
    if not pegasus_model or not pegasus_tokenizer:
        print("❌ Pegasus model not loaded")
        return JSONResponse(
            status_code=503,
            content={"error": "Pegasus Summarization model not loaded."},
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
                
                # Generate detailed caption with FAST mode for video frames
                caption = generate_detailed_caption(image, fast=True)
                
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
    
    # Check if Pegasus model is loaded
    if not pegasus_model or not pegasus_tokenizer:
        print("❌ Pegasus model not loaded")
        return JSONResponse(
            status_code=503,
            content={"error": "Pegasus Summarization model not loaded."},
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
    Streams back results as they are generated (SSE format).
    """
    try:
        data = await request.json()
        text = data.get("text", "")
        image_urls = data.get("images", [])
        video_urls = data.get("videos", [])
        
        print(f"📥 Received {len(image_urls)} images, {len(video_urls)} videos")
        
        async def generate_stream():
            import json
            
            # --- TEXT SUMMARIZATION (Using Gemini API) ---
            summaries = []
            if text and text.strip():
                chunks = [text[i:i + 3000] for i in range(0, len(text), 3000)]  # Larger chunks for Gemini
                for idx, chunk in enumerate(chunks, 1):
                    try:
                        # Use Gemini API for text summarization
                        headers = {"Content-Type": "application/json"}
                        payload = {
                            "contents": [{
                                "parts": [{
                                    "text": f"Summarize the following text in 2-3 concise sentences for a visually impaired person:\n\n{chunk}"
                                }]
                            }],
                            "generationConfig": {
                                "temperature": 0.3,
                                "maxOutputTokens": 150
                            }
                        }
                        
                        # Try each API key until one succeeds
                        success = False
                        for attempt in range(len(GEMINI_API_KEYS)):
                            key_index = (current_gemini_key_index + attempt) % len(GEMINI_API_KEYS)
                            api_key = GEMINI_API_KEYS[key_index]
                            
                            try:
                                response = requests.post(
                                    f"{GEMINI_API_URL}?key={api_key}",
                                    headers=headers,
                                    json=payload,
                                    timeout=10
                                )
                                
                                if response.status_code == 200:
                                    result = response.json()
                                    if 'candidates' in result and len(result['candidates']) > 0:
                                        summary_text = result['candidates'][0]['content']['parts'][0]['text']
                                        summaries.append(summary_text.strip())
                                        success = True
                                        break
                                    else:
                                        summaries.append(f"⚠️ Could not summarize chunk {idx}")
                                        success = True
                                        break
                                elif response.status_code == 429:
                                    print(f"   ⚠️ Text summary API key #{key_index + 1} quota exceeded, trying next...")
                                    continue
                                else:
                                    print(f"   ⚠️ Text summary API key #{key_index + 1} error {response.status_code}, trying next...")
                                    continue
                            except Exception as key_error:
                                print(f"   ⚠️ Text summary API key #{key_index + 1} failed: {key_error}, trying next...")
                                continue
                        
                        if not success:
                            summaries.append(f"⚠️ All API keys failed for chunk {idx}")
                            
                    except Exception as e:
                        print(f"⚠️ Error summarizing chunk {idx}: {str(e)}")
                        summaries.append(f"⚠️ Error summarizing chunk {idx}: {str(e)}")
            else:
                summaries = ["No readable text found on this page."]
            
            # Send text summaries first
            yield f"data: {json.dumps({'type': 'text_summaries', 'data': summaries})}\n\n"
            
            # --- IMAGE CAPTIONING (NO LIMIT) ---
            valid_images = 0
            
            for idx, url in enumerate(image_urls, 1):
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
                        valid_images += 1
                        caption_data = {
                            "url": url,
                            "caption": caption_text,
                            "size": f"{width}x{height}",
                            "index": valid_images,
                            "total": len(image_urls)
                        }
                        print(f"   ✅ Caption {valid_images}: {caption_text[:60]}...")
                        
                        # Stream this caption immediately
                        yield f"data: {json.dumps({'type': 'image_caption', 'data': caption_data})}\n\n"
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

            if valid_images == 0:
                yield f"data: {json.dumps({'type': 'image_caption', 'data': {'caption': 'No valid images found or could not generate captions.', 'url': '', 'size': ''}})}\n\n"

            # --- VIDEO ANALYSIS ---
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
                    
                    video_data = {
                        "url": url,
                        "type": video_type,
                        "description": description,
                        "method": "detection"
                    }
                    valid_videos += 1
                    
                    # Stream video info
                    yield f"data: {json.dumps({'type': 'video_description', 'data': video_data})}\n\n"
                            
                except Exception:
                    continue

            if valid_videos == 0:
                yield f"data: {json.dumps({'type': 'video_description', 'data': {'description': 'No videos found on this page.', 'url': '', 'type': 'none'}})}\n\n"

            print(f"✅ Processing complete: {valid_images} images, {valid_videos} videos, {len(summaries)} text chunks")
            
            # Send completion message
            yield f"data: {json.dumps({'type': 'complete', 'data': {'images_processed': valid_images, 'videos_processed': valid_videos, 'text_chunks': len(summaries)}})}\n\n"
        
        return StreamingResponse(
            generate_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
            }
        )
        
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
