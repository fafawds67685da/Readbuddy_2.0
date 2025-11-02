from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from transformers import pipeline, BlipProcessor, BlipForConditionalGeneration
from PIL import Image, UnidentifiedImageError
import requests
import io
import urllib3
from urllib.parse import urlparse, parse_qs
import torch
import numpy as np

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI(
    title="ReadBuddy AI Backend",
    description="Summarizes webpage text, generates captions for images, and analyzes videos",
    version="4.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load models
print("⏳ Loading AI models (this may take a minute)...")
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"🔧 Using device: {device}")

# Use BART for summarization
summarizer = pipeline("summarization", model="facebook/bart-large-cnn", device=0 if device == "cuda" else -1)

# Load BLIP with proper configuration
processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
blip_model = BlipForConditionalGeneration.from_pretrained(
    "Salesforce/blip-image-captioning-base"
).to(device)

print(f"✅ Models loaded successfully on {device}!")

def extract_youtube_id(url):
    """Extract YouTube video ID from URL"""
    try:
        parsed = urlparse(url)
        if 'youtube.com' in parsed.netloc:
            return parse_qs(parsed.query).get('v', [None])[0]
        elif 'youtu.be' in parsed.netloc:
            return parsed.path.strip('/')
    except:
        pass
    return None

def get_youtube_transcript(video_id):
    """Get YouTube video transcript"""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        full_text = " ".join([item['text'] for item in transcript])
        return full_text
    except Exception as e:
        print(f"⚠️ Could not get YouTube transcript: {e}")
        return None

def generate_caption_safe(img):
    """
    FIXED: Properly handles PIL Images for BLIP captioning with padding
    """
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

        # Process with BLIP — FIXED: added padding=True, return_tensors="pt"
        inputs = processor(
            images=img,
            return_tensors="pt",
            padding=True
        ).to(device)

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
        if caption:
            caption = caption[0].upper() + caption[1:] if len(caption) > 1 else caption.upper()
            if not caption.endswith(('.', '!', '?')):
                caption += '.'

        return caption or None

    except Exception as e:
        print(f"   ⚠️ Caption generation error: {str(e)}")
        import traceback
        traceback.print_exc()
        return None


def download_image_safe(url, timeout=15):
    """Improved image downloader with SSL, retry, and correct host handling"""
    import urllib.parse
    from requests.adapters import HTTPAdapter, Retry

    try:
        # Ensure the URL is clean and correctly parsed
        parsed = urllib.parse.urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError(f"Invalid URL: {url}")

        # Normalize hostname (fix hhost/uplooad typos caused by broken URLs)
        clean_url = urllib.parse.urlunparse(parsed._replace(netloc=parsed.netloc.replace("hhost", "host").replace("uplooad", "upload")))

        # Create a robust session with retry policy
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

        response = session.get(clean_url, timeout=timeout, verify=True, headers=headers)
        response.raise_for_status()

        return response.content

    except requests.exceptions.SSLError:
        print(f"   ⚠️ SSL issue, retrying with verify=False: {url}")
        try:
            response = requests.get(clean_url, timeout=timeout, verify=False)
            response.raise_for_status()
            return response.content
        except Exception as e2:
            print(f"   ❌ SSL retry failed: {e2}")
            raise
    except Exception as e:
        print(f"   ❌ Failed to download image: {e}")
        raise


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "online",
        "version": "4.0.0",
        "device": device,
        "models": {
            "summarizer": "BART-Large-CNN",
            "image_captioning": "BLIP-Base",
            "device": device
        }
    }

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
                    print(f"✅ Summarized chunk {idx}/{len(chunks)} ({len(summary[0]['summary_text'])} chars)")
                except Exception as e:
                    summaries.append(f"⚠️ Error summarizing chunk {idx}: {str(e)}")
        else:
            summaries = ["No readable text found on this page."]

        # --- FIXED IMAGE CAPTIONING ---
        image_descriptions = []
        valid_images = 0
        
        for idx, url in enumerate(image_urls, 1):
            if valid_images >= 5:
                break
                
            if not url.startswith("http"):
                print(f"⚠️ Skipping non-HTTP URL: {url[:70]}")
                continue

            try:
                print(f"🔍 Processing image {idx}: {url[:70]}...")
                
                # Download image
                image_data = download_image_safe(url)
                
                # Open as PIL Image
                img = Image.open(io.BytesIO(image_data))
                
                # Convert to RGB IMMEDIATELY
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                width, height = img.size
                print(f"   📐 Image size: {width}x{height}")
                
                # Skip very small images
                if width < 50 or height < 50:
                    print(f"   ⚠️ Image too small, skipping")
                    continue
                
                # Resize if needed - KEEP AS PIL IMAGE
                max_size = 384
                if max(width, height) > max_size:
                    ratio = max_size / max(width, height)
                    new_width = int(width * ratio)
                    new_height = int(height * ratio)
                    img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                    print(f"   📏 Resized to: {new_width}x{new_height}")
                
                # Generate caption - pass PIL Image directly
                caption_text = generate_caption_safe(img)
                
                if caption_text:
                    image_descriptions.append({
                        "url": url,
                        "caption": caption_text,
                        "size": f"{width}x{height}"
                    })
                    
                    print(f"   ✅ Caption: {caption_text}")
                    valid_images += 1
                else:
                    print(f"   ⚠️ Could not generate caption")
                
            except UnidentifiedImageError:
                print(f"   ⚠️ Cannot identify image format")
                continue
            except requests.exceptions.RequestException as e:
                print(f"   ⚠️ Request error: {str(e)[:100]}")
                continue
            except Exception as e:
                print(f"   ⚠️ Unexpected error: {str(e)[:100]}")
                import traceback
                traceback.print_exc()
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
                print(f"🎬 Processing video {idx}: {url[:70]}...")
                
                youtube_id = extract_youtube_id(url)
                
                if youtube_id:
                    print(f"   📺 YouTube video detected: {youtube_id}")
                    
                    transcript = get_youtube_transcript(youtube_id)
                    
                    if transcript and len(transcript.strip()) > 50:
                        transcript_chunk = transcript[:2000]
                        try:
                            summary = summarizer(transcript_chunk, max_length=150, min_length=50, do_sample=False)
                            
                            video_descriptions.append({
                                "url": url,
                                "type": "youtube",
                                "description": summary[0]["summary_text"],
                                "method": "transcript"
                            })
                            
                            print(f"   ✅ Summarized YouTube transcript")
                            valid_videos += 1
                        except Exception as e:
                            print(f"   ⚠️ Error summarizing transcript: {e}")
                            video_descriptions.append({
                                "url": url,
                                "type": "youtube",
                                "description": f"YouTube video found (ID: {youtube_id}) but could not summarize transcript.",
                                "method": "metadata"
                            })
                            valid_videos += 1
                    else:
                        video_descriptions.append({
                            "url": url,
                            "type": "youtube",
                            "description": f"YouTube video found (ID: {youtube_id}) but transcript is unavailable.",
                            "method": "metadata"
                        })
                        valid_videos += 1
                else:
                    video_descriptions.append({
                        "url": url,
                        "type": "video",
                        "description": "Video detected but detailed analysis requires YouTube transcript.",
                        "method": "detection"
                    })
                    valid_videos += 1
                        
            except Exception as e:
                print(f"   ⚠️ Video error: {str(e)[:100]}")
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
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)