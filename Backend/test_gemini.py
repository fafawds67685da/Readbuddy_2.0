"""
Test script to verify Google Gemini API integration for image captioning
"""

import requests
import base64
import io
from PIL import Image
import numpy as np

# Google Gemini API Configuration
GEMINI_API_KEY = "AIzaSyB8REm_mE21KUvaqyBvW3TAud8sUr4vEFM"
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent"

def test_gemini_caption():
    """Test Gemini API with a simple test image"""
    
    # Create a simple test image (red square)
    img_array = np.zeros((200, 200, 3), dtype=np.uint8)
    img_array[:, :, 0] = 255  # Red channel
    img = Image.fromarray(img_array)
    
    print("📸 Created test image (200x200 red square)")
    
    # Convert to base64
    buffered = io.BytesIO()
    img.save(buffered, format="JPEG", quality=85)
    img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
    
    print(f"✅ Converted to base64 ({len(img_base64)} characters)")
    
    # Prepare API request
    headers = {
        "Content-Type": "application/json"
    }
    
    payload = {
        "contents": [{
            "parts": [
                {
                    "text": "Describe this image in detail for a visually impaired person. Include colors, objects, people, actions, settings, and any text visible. Be descriptive but concise (2-3 sentences)."
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
            "maxOutputTokens": 200
        }
    }
    
    print("\n🌐 Sending request to Gemini API...")
    
    try:
        response = requests.post(
            f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
            headers=headers,
            json=payload,
            timeout=15
        )
        
        print(f"📡 Response status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print("\n✅ SUCCESS! Gemini API Response:")
            print(f"Full response: {result}")
            
            # Extract caption
            if 'candidates' in result and len(result['candidates']) > 0:
                candidate = result['candidates'][0]
                if 'content' in candidate and 'parts' in candidate['content']:
                    parts = candidate['content']['parts']
                    if len(parts) > 0 and 'text' in parts[0]:
                        caption = parts[0]['text'].strip()
                        print(f"\n📝 Caption: {caption}")
                        return caption
            
            print("\n⚠️ Could not extract caption from response")
            return None
        else:
            print(f"\n❌ ERROR! Status {response.status_code}")
            print(f"Response: {response.text}")
            return None
            
    except Exception as e:
        print(f"\n❌ EXCEPTION: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    print("=" * 60)
    print("Google Gemini API Test for Image Captioning")
    print("=" * 60)
    print()
    
    caption = test_gemini_caption()
    
    print("\n" + "=" * 60)
    if caption:
        print("✅ TEST PASSED - Gemini API is working!")
    else:
        print("❌ TEST FAILED - Check API key or connection")
    print("=" * 60)
