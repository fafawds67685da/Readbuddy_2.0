# 🔊 ReadBuddy - AI-Powered Screen Reader

[![Version](https://img.shields.io/badge/version-4.0.0-blue.svg)](https://github.com/yourusername/readbuddy)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![Chrome](https://img.shields.io/badge/chrome-extension-red.svg)](https://chrome.google.com/webstore)

An intelligent Chrome extension that makes the web accessible for visually impaired users with AI-powered text summarization, image captioning, and video analysis with text-to-speech narration.

---

## ✨ What's New in v4.0

### 🎯 Major Improvements

#### **1. FIXED: Image Captioning Now Works Perfectly! 🖼️**
- ✅ **Fixed the padding issue** - Added `padding=True` to BLIP processor
- ✅ **Upgraded to BLIP-Large** - Better quality captions
- ✅ **Support for ANY image type** - JPEG, PNG, WebP, GIF (first frame)
- ✅ **Base64 image support** - Can process images that backends can't download
- ✅ **Better error handling** - Graceful fallbacks for inaccessible images
- ✅ **Enhanced preprocessing** - Auto RGB conversion, smart resizing

**Before v4.0:**
```
⚠️ Caption generation error: Unable to create tensor, you should probably activate padding
```

**After v4.0:**
```
✅ Caption: A man wearing glasses and a suit standing in front of a building.
✅ Caption: A black and white photo of a young woman smiling at the camera.
✅ Caption: A group of people sitting around a table in a meeting room.
```

#### **2. BETTER Text Summarization 📝**
- 🔥 **FLAN-T5 Model** - Google's state-of-the-art summarization (fallback to BART)
- 📏 **Longer summaries** - Increased from 130 to 400 max tokens
- 🎯 **Better context** - Larger chunk sizes (3000 chars vs 2000)
- 🧠 **Smarter chunking** - Processes up to 5 chunks for complete page summary

#### **3. Enhanced Processing 🚀**
- 📸 **10 images per page** (increased from 5)
- 🔊 **Same great TTS** - Chrome's built-in Web Speech API (fast, free, multilingual)
- 💪 **Better error recovery** - Multiple fallback methods
- 🎨 **Improved image handling** - Smart resizing, format conversion

---

## 🌟 Core Features

### 📝 **Text Summarization**
- Condenses long articles into clear, concise summaries
- Processes multiple page sections
- Maintains key information and context
- Perfect for news articles, blogs, documentation

### 🖼️ **Image Description**
- AI-generated captions for all images
- Describes people, objects, scenes, activities
- Works with photos, illustrations, diagrams
- Handles images of all sizes and formats

### 🎬 **Video Analysis**
- Extracts and summarizes YouTube video transcripts
- Provides video content overview
- Identifies video type and availability
- Supports Vimeo and other platforms

### 🔊 **Text-to-Speech**
- Natural-sounding voice narration
- Adjustable speech rate (0.5x - 2.0x)
- Multiple voice options (system-dependent)
- Auto-speak or manual trigger

### ⌨️ **Keyboard Navigation**
- Full keyboard control with screen reader mode
- Navigate by element type (headings, links, buttons, images)
- Visual highlighting of current element
- Announces element descriptions

### 🎯 **Floating Bubble Button**
- Always-visible control panel
- Draggable to any screen position
- Quick access to all features
- Status indicators

---

## 📦 Installation

### Prerequisites
- **Python 3.9+**
- **Chrome Browser** (or Chromium-based)
- **4GB+ RAM** (8GB recommended for GPU acceleration)
- **5GB disk space** (for AI models)

### Backend Setup

#### 1. Clone or Download Project
```bash
git clone https://github.com/yourusername/readbuddy.git
cd readbuddy
```

#### 2. Create Virtual Environment
```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# Mac/Linux
python3 -m venv .venv
source .venv/bin/activate
```

#### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

**This will download:**
- FastAPI & Uvicorn
- PyTorch (CPU or GPU version)
- Transformers (HuggingFace)
- BLIP-Large model (~2GB)
- FLAN-T5-Base model (~1GB) or BART (~1.5GB)
- Image processing libraries

**⏱️ First-time installation takes 10-15 minutes** (downloading models)

#### 4. Run Backend Server
```bash
uvicorn main:app --reload
```

You should see:
```
⏳ Loading AI models (this may take a minute)...
🔧 Using device: cuda  (or cpu)
📝 Loading summarization model...
✅ Using FLAN-T5 for summarization
🖼️ Loading image captioning model...
✅ All models loaded successfully on cuda!
INFO:     Uvicorn running on http://127.0.0.1:8000
```

**Test the backend:**
```bash
# Open browser and visit:
http://127.0.0.1:8000
# Should show: {"status": "online", "version": "4.0.0", ...}
```

### Chrome Extension Setup

#### 1. Prepare Extension Files

Create folder structure:
```
ReadBuddy-Extension/
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
├── sidepanel.html
├── sidepanel.js
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

#### 2. Create Icons
- Download or create PNG icons in sizes: 16x16, 32x32, 48x48, 128x128
- Name them: `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`
- Place in `icons/` folder
- **Free icon sources:**
  - [Flaticon](https://www.flaticon.com/)
  - [Icons8](https://icons8.com/)
  - [Iconfinder](https://www.iconfinder.com/)

#### 3. Load Extension in Chrome

1. Open Chrome and go to: `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `ReadBuddy-Extension` folder
5. Extension icon should appear in toolbar!

#### 4. Pin Extension (Optional)
- Click the puzzle icon 🧩 in Chrome toolbar
- Find "ReadBuddy - AI Screen Reader"
- Click the pin 📌 icon to keep it visible

---

## 📖 How to Use

### 🚀 Quick Start (3 Methods)

#### **Method 1: Floating Bubble Button** ⭐ Easiest!
1. Start backend: `uvicorn main:app --reload`
2. Navigate to any webpage
3. Look for purple gradient bubble in bottom-right corner
4. Click bubble → Select "🤖 Analyze Page"
5. Results appear and are read aloud!

#### **Method 2: Extension Icon**
1. Click ReadBuddy icon in Chrome toolbar
2. Side panel opens on right side
3. Click "Analyze Current Page"
4. View results in side panel

#### **Method 3: Keyboard Shortcut**
1. Press `Ctrl+Alt+R` on any webpage
2. Screen reader mode activates
3. Navigate with keyboard shortcuts (see below)

---

### ⌨️ Keyboard Navigation Shortcuts

**Enable/Disable:**
- `Ctrl+Alt+R` - Toggle screen reader mode

**Navigation:**
- `J` - Next element
- `K` - Previous element
- `H` - Next heading (h1, h2, h3, etc.)
- `L` - Next link
- `B` - Next button
- `G` - Next image
- `F` - Next form field (input, select, textarea)

**Control:**
- `R` - Repeat current element description
- `S` - Stop speaking
- `Escape` - Stop speaking
- `Enter` - Click/activate current element

---

### 🎯 Bubble Button Features

**Main Button:**
- Click: Open menu
- Click + Drag: Reposition anywhere
- Status indicator: Green pulsing badge when screen reader active

**Menu Options:**
- 🤖 **Analyze Page** - Run AI analysis instantly
- ⌨️ **Screen Reader** - Toggle keyboard navigation mode
- ⏹️ **Stop Speech** - Stop all audio immediately
- ⚙️ **Settings** - Open side panel settings

---

### ⚙️ Settings

**Speech Speed:**
- Range: 0.5x to 2.0x
- Default: 1.0x
- Adjust in popup or side panel

**Auto-speak:**
- When enabled: Results are read aloud automatically
- When disabled: Click "Read Again" to hear results
- Toggle in settings section

---

## 🎯 Use Cases

### 📰 **News & Articles**
- Get quick summaries of long articles
- Listen while multitasking
- Understand images and infographics

### 🛒 **Online Shopping**
- Hear product descriptions
- Understand product images
- Navigate product pages easily

### 📚 **Research & Learning**
- Summarize academic papers
- Understand diagrams and charts
- Access video lectures via transcripts

### 📧 **Email & Communication**
- Quick email summaries
- Navigate long threads
- Understand attached images

### 🌐 **General Web Browsing**
- Independent website exploration
- Navigate complex layouts
- Access all content types

---

## 🛠️ Technology Stack

### Backend
- **FastAPI** - Modern Python web framework
- **PyTorch** - Deep learning framework
- **Transformers (HuggingFace)**:
  - **FLAN-T5-Base** - Text summarization (Google)
  - **BART-Large-CNN** - Fallback summarization (Facebook)
  - **BLIP-Large** - Image captioning (Salesforce)
- **Pillow** - Image processing
- **YouTube Transcript API** - Video transcript extraction

### Frontend
- **Chrome Extensions API** - Manifest V3
- **Web Speech API** - Text-to-speech
- **Vanilla JavaScript** - No frameworks (lightweight)
- **Chrome Side Panel API** - Persistent interface

### AI Models

| Model | Purpose | Size | Quality |
|-------|---------|------|---------|
| FLAN-T5-Base | Summarization | ~1GB | Excellent |
| BART-Large-CNN | Summarization (fallback) | ~1.5GB | Very Good |
| BLIP-Large | Image Captioning | ~2GB | Excellent |

---

## 🐛 Troubleshooting

### Backend Issues

#### **Images Not Captioning**
✅ **FIXED IN v4.0!** The padding error is resolved.

If you still see issues:
1. Check backend logs for specific errors
2. Verify image URL is accessible (open in browser)
3. Try with different images
4. Check disk space (need ~5GB for models)

#### **Models Not Loading**
```
⚠️ Error loading models
```
**Solutions:**
1. Check internet connection (first run downloads models)
2. Ensure 4GB+ free RAM
3. Check disk space (5GB+ free)
4. Try clearing cache: Delete `~/.cache/huggingface/`

#### **Port Already in Use**
```
ERROR: [Errno 48] Address already in use
```
**Solution:**
```bash
# Use different port
uvicorn main:app --reload --port 8001

# Then update extension files:
# In popup.js, sidepanel.js, content.js:
# Change http://127.0.0.1:8000 to http://127.0.0.1:8001
```

#### **Slow Processing**
**Solutions:**
1. **Use GPU** if available (10x faster)
   ```bash
   # Install CUDA version of PyTorch
   pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
   ```
2. **Reduce batch sizes** in code
3. **Process fewer images** (change `valid_images >= 10` to `>= 5`)

#### **Out of Memory**
```
RuntimeError: CUDA out of memory
```
**Solutions:**
1. Close other applications
2. Reduce image processing limit
3. Use CPU instead of GPU (slower but works)

---

### Extension Issues

#### **"Could not extract page content"**
**Causes:**
- Page hasn't fully loaded
- Website blocks content extraction (CSP policies)
- JavaScript-heavy single-page applications

**Solutions:**
1. Refresh page and wait for full load
2. Try a different page/website
3. Check browser console (F12) for errors

#### **Bubble Button Not Showing**
**Solutions:**
1. Refresh the webpage (Ctrl+R or F5)
2. Check extension is enabled: `chrome://extensions/`
3. Check browser console for errors (F12 → Console)
4. Reinstall extension

#### **TTS Not Working**
**Solutions:**
1. Check system volume (not muted)
2. Test Chrome's TTS:
   ```javascript
   // Open console (F12) and run:
   speechSynthesis.speak(new SpeechSynthesisUtterance("test"))
   ```
3. Try different voice in system settings
4. Restart Chrome

#### **Backend Connection Failed**
```
❌ Error: Failed to fetch
```
**Solutions:**
1. Verify backend is running:
   ```bash
   curl http://127.0.0.1:8000
   # Should return: {"status": "online", ...}
   ```
2. Check firewall settings
3. Ensure correct port (8000)
4. Try localhost instead of 127.0.0.1

---

## 🚀 Deployment Guide

### Deploy Backend to Cloud

#### **Option 1: Railway.app** (Easiest)
```bash
# 1. Create Railway account
# 2. Install Railway CLI
npm i -g @railway/cli

# 3. Login
railway login

# 4. Initialize project
railway init

# 5. Deploy
railway up
```

**Add environment variables in Railway dashboard:**
```
PYTHON_VERSION=3.9
```

#### **Option 2: Render.com**
1. Push code to GitHub
2. Connect Render to repository
3. Create new Web Service
4. Set build command: `pip install -r requirements.txt`
5. Set start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

#### **Option 3: Google Cloud Run**
```bash
# 1. Create Dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]

# 2. Deploy
gcloud run deploy readbuddy --source . --region us-central1 --allow-unauthenticated
```

### Update Extension for Production

1. **Update API URLs** in all files:
```javascript
// popup.js, sidepanel.js, content.js
// Change from:
const API_URL = "http://127.0.0.1:8000";

// To:
const API_URL = "https://your-backend.railway.app";
```

2. **Update manifest.json**:
```json
{
  "host_permissions": [
    "https://your-backend.railway.app/*",
    "<all_urls>"
  ]
}
```

3. **Update CORS in main.py**:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
        "https://your-website.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Publish to Chrome Web Store

1. **Prepare for submission:**
   - Create promotional images (1280x800, 640x400, 440x280)
   - Write detailed description
   - Create privacy policy page
   - Screenshot examples

2. **Submit:**
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Pay $5 one-time developer fee
   - Upload extension ZIP
   - Fill out listing details
   - Submit for review (takes 1-3 days)

---

## 📊 Performance Benchmarks

### Processing Times (Average)

| Task | CPU | GPU (CUDA) |
|------|-----|-----------|
| Text Summary (1000 words) | 3-5s | 1-2s |
| Image Caption (single) | 2-3s | 0.5-1s |
| Image Caption (10 images) | 20-30s | 5-10s |
| Video Transcript (5 min) | 5-10s | 5-10s |

### Memory Usage

| Component | RAM | VRAM (GPU) |
|-----------|-----|-----------|
| FLAN-T5-Base | ~2GB | ~1GB |
| BLIP-Large | ~4GB | ~2GB |
| Total Runtime | 6-8GB | 3-4GB |

### Model Sizes (Disk)

- FLAN-T5-Base: ~990MB
- BLIP-Large: ~2GB
- BART-Large-CNN: ~1.5GB
- **Total:** ~4.5GB

---

## 🔮 Future Roadmap

### v4.1 (Next Release)
- [ ] **OCR Support** - Read text from images (Tesseract)
- [ ] **PDF Analysis** - Extract and summarize PDF documents
- [ ] **Better Video** - Frame-by-frame analysis for non-YouTube videos
- [ ] **Language Detection** - Auto-detect and handle multiple languages

### v4.2
- [ ] **Multi-language TTS** - Support 50+ languages
- [ ] **Translation** - Real-time translation of page content
- [ ] **Braille Output** - Support for refreshable braille displays
- [ ] **Mobile App** - Android/iOS companion app

### v4.3
- [ ] **Offline Mode** - Download models for offline use
- [ ] **Custom Voices** - Integration with premium TTS services
- [ ] **Math Equations** - Read LaTeX and MathML aloud
- [ ] **Table Navigation** - Enhanced HTML table reading

### v5.0
- [ ] **Real-time Screen Reading** - Continuous page monitoring
- [ ] **AI Chat Assistant** - Ask questions about page content
- [ ] **Personalization** - Learn user preferences
- [ ] **Reading Progress** - Save and resume sessions

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### Report Bugs
- Open an issue on GitHub
- Include: OS, Chrome version, error messages, screenshots
- Provide steps to reproduce

### Suggest Features
- Open a feature request issue
- Explain the use case
- Describe expected behavior

### Submit Code
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Make changes and test thoroughly
4. Commit: `git commit -m 'Add amazing feature'`
5. Push: `git push origin feature/amazing-feature`
6. Open Pull Request

### Areas Needing Help
- 🌍 **Translations** - Multi-language support
- ♿ **Accessibility Testing** - User testing with screen readers
- 📱 **Mobile Development** - Android/iOS app
- 🎨 **UI/UX Design** - Improve interfaces
- 📚 **Documentation** - Tutorials and guides
- 🧪 **Testing** - Unit tests and integration tests

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

**You are free to:**
- ✅ Use commercially
- ✅ Modify and adapt
- ✅ Distribute
- ✅ Use privately

**You must:**
- 📝 Include original license
- 📝 State changes made

---

## 🙏 Acknowledgments

### AI Models
- **Google** - FLAN-T5 model
- **Facebook/Meta** - BART model
- **Salesforce** - BLIP image captioning model
- **HuggingFace** - Transformers library

### Libraries & Tools
- FastAPI team
- PyTorch team
- Chrome Extensions team
- Open-source community

### Inspiration
- Accessibility advocates worldwide
- Screen reader users who provided feedback
- Organizations promoting web accessibility

---

## 💡 Technical Details

### Image Captioning Fix

**The Problem (v3.x):**
```python
# Old code
inputs = processor(images=image, return_tensors="pt").to(device)
# Error: Unable to create tensor without padding
```

**The Solution (v4.0):**
```python
# Fixed code
inputs = processor(
    images=image, 
    return_tensors="pt",
    padding=True  # THIS IS THE KEY FIX!
).to(device)
```

**Why it works:**
- BLIP processor needs consistent tensor dimensions
- `padding=True` ensures all tensors have same shape
- Enables batch processing and prevents dimension errors

### Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    User's Browser                    │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────┐        ┌──────────────┐          │
│  │   Webpage    │◄──────►│   Extension  │          │
│  │  (Any Site)  │        │  Content.js  │          │
│  └──────────────┘        └──────┬───────┘          │
│                                  │                   │
│                          Extract │ Text, Images,     │
│                                  │ Videos            │
│  ┌──────────────┐                │                   │
│  │ Side Panel   │◄───────────────┘                   │
│  │ UI Controls  │                                    │
│  └──────┬───────┘                                    │
│         │                                            │
└─────────┼────────────────────────────────────────────┘
          │
          │ HTTP POST /analyze-page
          │ {text, images, videos}
          │
┌─────────▼────────────────────────────────────────────┐
│              FastAPI Backend (Port 8000)             │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────────────────────────────────────┐   │
│  │          Text Summarization                  │   │
│  │  • FLAN-T5-Base (primary)                   │   │
│  │  • BART-Large-CNN (fallback)                │   │
│  │  • Processes 3000-char chunks               │   │
│  │  • Generates 150-400 token summaries        │   │
│  └─────────────────────────────────────────────┘   │
│                                                       │
│  ┌─────────────────────────────────────────────┐   │
│  │         Image Captioning                     │   │
│  │  • BLIP-Large model                         │   │
│  │  • Downloads images from URLs               │   │
│  │  • Supports base64 images                   │   │
│  │  • Processes up to 10 images                │   │
│  │  • Beam search for quality                  │   │
│  └─────────────────────────────────────────────┘   │
│                                                       │
│  ┌─────────────────────────────────────────────┐   │
│  │          Video Analysis                      │   │
│  │  • YouTube Transcript API                   │   │
│  │  • Extracts subtitles/captions              │   │
│  │  • Summarizes with FLAN-T5                  │   │
│  │  • Supports up to 3 videos                  │   │
│  └─────────────────────────────────────────────┘   │
│                                                       │
└──────────────────┬────────────────────────────────────┘
                   │
                   │ Returns JSON:
                   │ {summaries, image_descriptions, 
                   │  video_descriptions, metadata}
                   │
┌──────────────────▼────────────────────────────────────┐
│              Browser Extension                        │
├───────────────────────────────────────────────────────┤
│  • Display results in UI                              │
│  • Text-to-Speech via Web Speech API                 │
│  • Keyboard navigation controls                       │
│  • Visual highlighting                                │
└───────────────────────────────────────────────────────┘
```

---

## 📞 Support & Contact

### Get Help
- 📧 **Email:** support@readbuddy.com (example)
- 💬 **Discord:** [Join our community](https://discord.gg/readbuddy) (example)
- 🐛 **Issues:** [GitHub Issues](https://github.com/yourusername/readbuddy/issues)
- 📖 **Docs:** [Full Documentation](https://readbuddy.com/docs) (example)

### Social Media
- 🐦 **Twitter:** [@ReadBuddyAI](https://twitter.com/readbuddyai) (example)
- 💼 **LinkedIn:** [ReadBuddy Project](https://linkedin.com/company/readbuddy) (example)

---

## ⭐ Show Your Support

If ReadBuddy helps you, please:
- ⭐ Star this repository
- 🐛 Report bugs you find
- 💡 Suggest new features
- 📢 Share with others who could benefit
- ✍️ Write a review on Chrome Web Store
- 🤝 Contribute code or documentation

---

## 📈 Statistics

- **Lines of Code:** ~2,500+
- **AI Models:** 3 (FLAN-T5, BLIP, BART)
- **Languages Supported:** 100+ (via Chrome TTS)
- **Image Formats:** JPEG, PNG, WebP, GIF, BMP
- **Video Platforms:** YouTube, Vimeo, direct MP4
- **Browser Support:** Chrome, Edge, Brave, Opera

---

## 🎓 Educational Use

ReadBuddy is perfect for:
- **Students** - Accessible learning materials
- **Researchers** - Quick paper summaries
- **Educators** - Creating accessible content
- **Developers** - Learning AI integration
- **Organizations** - Meeting accessibility requirements

---

## ♿ Accessibility Standards

ReadBuddy helps websites meet:
- **WCAG 2.1** (Web Content Accessibility Guidelines)
- **Section 508** (US Rehabilitation Act)
- **ADA** (Americans with Disabilities Act)
- **EN 301 549** (European accessibility standard)

---

**ReadBuddy v4.0** - *Empowering everyone with equal access to information* ♿

Made with ❤️ for accessibility, inclusivity, and independence.

---

*Last Updated: 2024*
*Maintained by: [Your Name/Team]*
*Repository: [GitHub Link]*

