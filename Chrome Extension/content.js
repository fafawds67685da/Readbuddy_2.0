// content.js - FIXED: Improved video element tracking and error recovery

// --- Video Analysis State ---
let analysisInterval = null;
let currentVideoElement = null;
const ANALYSIS_INTERVAL_SECONDS = 30;
let videoCheckInterval = null;
let captureAttempts = 0;
const MAX_CAPTURE_ATTEMPTS = 3;

// --- Video Analysis Functions (CORS-Compatible) ---
function findViableVideo() {
  // Try YouTube-specific selector first
  let video = document.querySelector('video.html5-main-video');
  
  // Fall back to any video element
  if (!video) {
    const videos = Array.from(document.querySelectorAll('video'));
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 200) {
        video = v;
        break;
      }
    }
  }
  
  return video;
}

// NEW: Validate if video element is still valid
function isVideoElementValid(video) {
  if (!video) return false;
  
  // Check if element is still in DOM
  if (!document.body.contains(video)) return false;
  
  // Check if element has valid dimensions
  const rect = video.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  
  // Check if video has valid properties
  if (video.readyState === 0) return false;
  
  return true;
}

// NEW: Re-find video element if current one becomes invalid
function ensureVideoElement() {
  if (isVideoElementValid(currentVideoElement)) {
    return currentVideoElement;
  }
  
  console.log("⚠️ Video element lost, attempting to re-find...");
  currentVideoElement = findViableVideo();
  
  if (currentVideoElement) {
    console.log("✅ Video element re-acquired:", currentVideoElement);
  } else {
    console.log("❌ Could not re-find video element");
  }
  
  return currentVideoElement;
}

function startVideoAnalysisLoop() {
  if (analysisInterval) {
    stopVideoAnalysisLoop();
  }
  
  currentVideoElement = findViableVideo();
  
  if (!currentVideoElement) {
    chrome.runtime.sendMessage({ 
      action: 'videoAnalysisError', 
      message: "Could not find a visible video element on the page." 
    });
    return;
  }
  
  console.log("✅ Found video element:", currentVideoElement);
  
  chrome.runtime.sendMessage({ 
    action: 'videoAnalysisLoading', 
    message: `Found video. Starting analysis every ${ANALYSIS_INTERVAL_SECONDS} seconds.` 
  });
  
  // Try to play video if paused
  if (currentVideoElement.paused) {
    currentVideoElement.play().catch(e => 
      console.log("Could not auto-play video:", e)
    );
  }
  
  let nextCaptureTime = Math.ceil(currentVideoElement.currentTime / ANALYSIS_INTERVAL_SECONDS) * ANALYSIS_INTERVAL_SECONDS;
  
  // NEW: Periodic video element validation (every 5 seconds)
  videoCheckInterval = setInterval(() => {
    ensureVideoElement();
  }, 5000);
  
  analysisInterval = setInterval(() => {
    // NEW: Ensure video element is still valid before attempting capture
    const video = ensureVideoElement();
    
    if (!video) {
      console.error("❌ Video element lost and could not be recovered");
      chrome.runtime.sendMessage({ 
        action: 'videoAnalysisError', 
        message: "Video element was removed from page. Analysis stopped." 
      });
      stopVideoAnalysisLoop();
      return;
    }
    
    const currentTime = video.currentTime;
    
    if (currentTime >= nextCaptureTime) {
      video.pause();
      
      const timestamp = currentTime;
      console.log(`📹 Capturing frame at ${Math.floor(timestamp)}s`);
      
      chrome.runtime.sendMessage({ 
        action: 'videoAnalysisLoading', 
        message: `Capturing frame at ${Math.floor(timestamp)}s...` 
      });
      
      // Reset capture attempts
      captureAttempts = 0;
      
      // Use CORS-compatible capture method with retry logic
      captureVideoFrameCORS(video, timestamp);
      
      nextCaptureTime += ANALYSIS_INTERVAL_SECONDS;
    }
  }, 1000);
  
  console.log("✅ Video analysis loop started (CORS-compatible mode)");
}

function stopVideoAnalysisLoop() {
  if (analysisInterval) {
    clearInterval(analysisInterval);
    analysisInterval = null;
    console.log("🛑 Video analysis loop stopped.");
  }
  
  // NEW: Clear video check interval
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
    videoCheckInterval = null;
  }
  
  if (currentVideoElement) {
    console.log("⏸️ Video remains paused.");
  }
  
  // Reset state
  captureAttempts = 0;
}

// IMPROVED: Better error handling and retry logic
async function captureVideoFrameCORS(video, timestamp) {
  try {
    // Validate video element one more time before capture
    if (!isVideoElementValid(video)) {
      throw new Error("Video element is no longer valid");
    }
    
    let imageData = null;
    
    // Method 1: Try canvas capture (works for same-origin videos)
    try {
      imageData = captureWithCanvas(video);
      console.log("✅ Canvas capture successful");
    } catch (canvasError) {
      console.log("⚠️ Canvas blocked by CORS, trying MediaStream...");
      
      // Method 2: Use MediaStream API (works for YouTube)
      try {
        imageData = await captureWithMediaStream(video);
        console.log("✅ MediaStream capture successful");
      } catch (streamError) {
        console.log("⚠️ MediaStream failed, trying screenshot...");
        
        // Method 3: Use Chrome's captureVisibleTab (most reliable)
        imageData = await captureWithScreenshot(video);
        console.log("✅ Screenshot capture successful");
      }
    }
    
    if (!imageData) {
      throw new Error("All capture methods failed");
    }
    
    chrome.runtime.sendMessage({ 
      action: 'videoAnalysisLoading', 
      message: `Frame captured at ${Math.floor(timestamp)}s. Analyzing with AI...` 
    });
    
    await sendFrameToBackend(imageData, timestamp);
    
  } catch (error) {
    console.error("❌ Error capturing video frame:", error);
    
    // NEW: Retry logic
    captureAttempts++;
    
    if (captureAttempts < MAX_CAPTURE_ATTEMPTS) {
      console.log(`🔄 Retrying capture (attempt ${captureAttempts + 1}/${MAX_CAPTURE_ATTEMPTS})...`);
      
      chrome.runtime.sendMessage({ 
        action: 'videoAnalysisLoading', 
        message: `Capture failed, retrying (${captureAttempts}/${MAX_CAPTURE_ATTEMPTS})...` 
      });
      
      // Wait 2 seconds before retry
      setTimeout(() => {
        captureVideoFrameCORS(video, timestamp);
      }, 2000);
      
    } else {
      // Max retries reached, report error but don't stop the loop
      chrome.runtime.sendMessage({ 
        action: 'videoAnalysisError', 
        message: `Frame capture failed after ${MAX_CAPTURE_ATTEMPTS} attempts. Continuing with next interval...` 
      });
      
      // Reset attempts for next capture
      captureAttempts = 0;
      
      // Resume video playback
      if (video && !video.paused) {
        video.play().catch(e => console.log("Could not resume video:", e));
      }
    }
  }
}

// Method 1: Canvas capture (fastest but CORS-restricted)
function captureWithCanvas(video) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // This will throw if CORS-protected
  return canvas.toDataURL('image/jpeg', 0.8);
}

// Method 2: MediaStream capture (works with YouTube)
async function captureWithMediaStream(video) {
  return new Promise((resolve, reject) => {
    try {
      const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
      
      if (!stream) {
        reject(new Error("captureStream not supported"));
        return;
      }
      
      const track = stream.getVideoTracks()[0];
      if (!track) {
        reject(new Error("No video track available"));
        return;
      }
      
      const imageCapture = new ImageCapture(track);
      
      imageCapture.grabFrame()
        .then(imageBitmap => {
          const canvas = document.createElement('canvas');
          canvas.width = imageBitmap.width;
          canvas.height = imageBitmap.height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(imageBitmap, 0, 0);
          
          const imageData = canvas.toDataURL('image/jpeg', 0.8);
          
          track.stop();
          
          resolve(imageData);
        })
        .catch(reject);
        
    } catch (error) {
      reject(error);
    }
  });
}

// Method 3: Screenshot capture (most reliable)
async function captureWithScreenshot(video) {
  return new Promise((resolve, reject) => {
    try {
      const rect = video.getBoundingClientRect();
      
      chrome.runtime.sendMessage(
        { 
          action: "captureVisibleTab",
          videoRect: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          }
        },
        (response) => {
          if (response && response.imageData) {
            cropImageToVideo(response.imageData, rect)
              .then(resolve)
              .catch(reject);
          } else {
            reject(new Error(response?.error || "Screenshot capture failed"));
          }
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

// Helper: Crop screenshot to video area
async function cropImageToVideo(imageData, rect) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        rect.left, rect.top, rect.width, rect.height,
        0, 0, rect.width, rect.height
      );
      
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = imageData;
  });
}

// Send frame to backend via background script
async function sendFrameToBackend(imageData, timestamp) {
  try {
    const analysisResult = await chrome.runtime.sendMessage({
      action: 'analyzeVideoFrame', 
      imageData: imageData
    });
    
    if (analysisResult && analysisResult.success) {
      const description = analysisResult.result.description || "The AI could not generate a clear description.";
      
      chrome.runtime.sendMessage({ 
        action: 'videoAnalysisUpdate', 
        description: description, 
        timestamp: timestamp 
      });
      
      // Reset capture attempts on success
      captureAttempts = 0;
      
    } else {
      const errorMessage = analysisResult ? (analysisResult.error || "Unknown AI analysis error.") : "No response from background service.";
      
      // Don't stop the loop, just log the error
      console.error("❌ AI Analysis Failed:", errorMessage);
      
      chrome.runtime.sendMessage({ 
        action: 'videoAnalysisError', 
        message: `AI Analysis Failed: ${errorMessage}. Continuing...` 
      });
    }
  } catch (error) {
    console.error("❌ Error sending frame to backend:", error);
    
    chrome.runtime.sendMessage({ 
      action: 'videoAnalysisError', 
      message: `Communication error: ${error.message}. Continuing...` 
    });
  }
}

// --- Main Listener for Side Panel Commands ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'toggle':
      readBuddy.toggle();
      sendResponse({ enabled: readBuddy.enabled });
      break;
    case 'updateRate':
      readBuddy.speechRate = request.rate;
      sendResponse({ success: true });
      break;
    case 'startVideoAnalysis':
      console.log("🎬 Received startVideoAnalysis command");
      startVideoAnalysisLoop();
      sendResponse({ success: true });
      break;
    case 'stopVideoAnalysis':
      console.log("🛑 Received stopVideoAnalysis command");
      stopVideoAnalysisLoop();
      sendResponse({ success: true });
      break;
    case 'continueVideoPlayback':
      if (currentVideoElement && isVideoElementValid(currentVideoElement)) {
        currentVideoElement.play();
        console.log("▶️ Video resumed after analysis.");
      }
      sendResponse({ success: true });
      break;
  }
  return true;
});

// --- ReadBuddy Screen Reader Implementation ---
function ReadBuddyScreenReader() {
  var self = this;
  self.enabled = false;
  self.currentElement = null;
  self.elementIndex = 0;
  self.navigableElements = [];
  self.speechRate = 1.0;
  self.speaking = false;
  self.initKeyboardShortcuts();
  self.createBubbleButton();
}

ReadBuddyScreenReader.prototype.createBubbleButton = function() {
  const bubble = document.createElement('div');
  bubble.id = 'readbuddy-bubble';
  bubble.innerHTML = `
    <div class="rb-bubble-main" id="rb-bubble-toggle">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    </div>
    <div class="rb-bubble-menu" id="rb-bubble-menu" style="display: none;">
      <button class="rb-menu-item" id="rb-analyze">
        <span>🤖</span>
        <span>Analyze Page</span>
      </button>
      <button class="rb-menu-item" id="rb-stop-speech">
        <span>⏹️</span>
        <span>Stop Speech</span>
      </button>
      <button class="rb-menu-item" id="rb-settings">
        <span>⚙️</span>
        <span>Settings</span>
      </button>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #readbuddy-bubble {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .rb-bubble-main {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: all 0.3s ease;
      color: white;
    }
    .rb-bubble-main:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }
    .rb-bubble-main.active {
      background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
      transform: rotate(45deg);
    }
    .rb-bubble-menu {
      position: absolute;
      bottom: 70px;
      right: 0;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      padding: 8px;
      min-width: 200px;
      animation: slideUp 0.3s ease;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .rb-menu-item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      color: #374151;
      transition: background 0.2s ease;
      text-align: left;
    }
    .rb-menu-item:hover {
      background: #f3f4f6;
    }
    .rb-menu-item span:first-child {
      font-size: 18px;
    }
    .rb-status-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 16px;
      height: 16px;
      background: #10b981;
      border: 2px solid white;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .rb-dragging {
      cursor: move !important;
      opacity: 0.8;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(bubble);

  this.makeDraggable(bubble.querySelector('.rb-bubble-main'));

  const bubbleToggle = document.getElementById('rb-bubble-toggle');
  const bubbleMenu = document.getElementById('rb-bubble-menu');
  let menuOpen = false;

  bubbleToggle.addEventListener('click', (e) => {
    if (e.target.closest('.rb-bubble-main').classList.contains('rb-dragging')) {
      return;
    }
    menuOpen = !menuOpen;
    bubbleMenu.style.display = menuOpen ? 'block' : 'none';
    bubbleToggle.classList.toggle('active', menuOpen);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#readbuddy-bubble')) {
      menuOpen = false;
      bubbleMenu.style.display = 'none';
      bubbleToggle.classList.remove('active');
    }
  });

  var self = this;
  
  document.getElementById('rb-analyze').addEventListener('click', function() {
    self.analyzePage();
    menuOpen = false;
    bubbleMenu.style.display = 'none';
    bubbleToggle.classList.remove('active');
  });

  document.getElementById('rb-stop-speech').addEventListener('click', function() {
    self.stopSpeaking();
    menuOpen = false;
    bubbleMenu.style.display = 'none';
    bubbleToggle.classList.remove('active');
  });

  document.getElementById('rb-settings').addEventListener('click', function() {
    chrome.runtime.sendMessage({ action: 'openSidePanel' });
    menuOpen = false;
    bubbleMenu.style.display = 'none';
    bubbleToggle.classList.remove('active');
  });
};

ReadBuddyScreenReader.prototype.makeDraggable = function(element) {
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  element.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const bubble = document.getElementById('readbuddy-bubble');
    const rect = bubble.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    element.classList.add('rb-dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const bubble = document.getElementById('readbuddy-bubble');
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    bubble.style.left = (startLeft + deltaX) + 'px';
    bubble.style.top = (startTop + deltaY) + 'px';
    bubble.style.right = 'auto';
    bubble.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      setTimeout(() => {
        element.classList.remove('rb-dragging');
      }, 100);
    }
    isDragging = false;
  });
};

ReadBuddyScreenReader.prototype.updateBubbleStatus = function() {
  const bubble = document.getElementById('rb-bubble-toggle');
  const existingBadge = bubble.querySelector('.rb-status-badge');
  if (this.enabled) {
    if (!existingBadge) {
      const badge = document.createElement('div');
      badge.className = 'rb-status-badge';
      bubble.appendChild(badge);
    }
  } else {
    if (existingBadge) {
      existingBadge.remove();
    }
  }
};

ReadBuddyScreenReader.prototype.analyzePage = function() {
  var self = this;
  self.speak("Analyzing page content, please wait...");
  try {
    var text = document.body.innerText.slice(0, 4000);
    var images = Array.prototype.slice.call(document.images)
      .filter(function(img) {
        var src = img.src || "";
        var isValidSize = img.width > 100 && img.height > 100;
        var isHttp = src.indexOf("http") === 0;
        return isValidSize && isHttp;
      })
      .map(function(img) { return img.src; })
      .slice(0, 10);
    var videos = [];
    Array.prototype.forEach.call(document.querySelectorAll('video'), function(v) {
      if (v.src || v.currentSrc) {
        videos.push(v.src || v.currentSrc);
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function(iframe) {
      var src = iframe.src || '';
      if (src.indexOf('youtube.com') !== -1 || src.indexOf('youtu.be') !== -1 || src.indexOf('vimeo.com') !== -1) {
        videos.push(src);
      }
    });
    fetch("http://127.0.0.1:8000/analyze-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, images: images, videos: videos.slice(0, 5) })
    })
    .then(function(response) { return response.json(); })
    .then(function(data) { self.speakAnalysisResults(data); })
    .catch(function(error) {
      self.speak("Error analyzing page: " + error.message);
      console.error("Analysis error:", error);
    });
  } catch (error) {
    self.speak("Error analyzing page: " + error.message);
    console.error("Analysis error:", error);
  }
};

ReadBuddyScreenReader.prototype.speakAnalysisResults = function(data) {
  let textToSpeak = "";
  if (data.summaries && data.summaries.length > 0) {
    textToSpeak += "Page summary: " + data.summaries.join(". ") + ". ";
  }
  if (data.image_descriptions && data.image_descriptions.length > 0) {
    const imageCount = data.image_descriptions.filter(item => 
      (typeof item === 'object' && item.caption && !item.caption.includes("No valid"))
    ).length;
    if (imageCount > 0) {
      textToSpeak += `Found ${imageCount} images. `;
      data.image_descriptions.forEach((item, i) => {
        if (item.caption && !item.caption.includes("No valid")) {
          textToSpeak += `Image ${i + 1}: ${item.caption}. `;
        }
      });
    }
  }
  if (data.video_descriptions && data.video_descriptions.length > 0) {
    const validVideos = data.video_descriptions.filter(v => v.type !== 'none');
    if (validVideos.length > 0) {
      textToSpeak += `Found ${validVideos.length} videos. `;
      validVideos.forEach((item, i) => {
        if (item.description) {
          textToSpeak += `Video ${i + 1}: ${item.description}. `;
        }
      });
    }
  }
  if (textToSpeak) {
    this.speak(textToSpeak);
  } else {
    this.speak("Analysis complete, but no content was found.");
  }
};

ReadBuddyScreenReader.prototype.initKeyboardShortcuts = function() {
  document.addEventListener('keydown', (e) => {
    if (!this.enabled) {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        this.toggle();
      }
      return;
    }
    const handled = this.handleKeyPress(e);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
};

ReadBuddyScreenReader.prototype.handleKeyPress = function(e) {
  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey;
  const alt = e.altKey;
  if (ctrl && alt && key === 'r') {
    this.toggle();
    return true;
  }
  switch (key) {
    case 'j': this.navigateNext(); return true;
    case 'k': this.navigatePrevious(); return true;
    case 'h': this.navigateToNext('h1, h2, h3, h4, h5, h6'); return true;
    case 'l': this.navigateToNext('a[href]'); return true;
    case 'b': this.navigateToNext('button, input[type="button"], input[type="submit"]'); return true;
    case 'g': this.navigateToNext('img'); return true;
    case 'f': this.navigateToNext('input:not([type="button"]):not([type="submit"]), select, textarea'); return true;
    case 's': this.stopSpeaking(); return true;
    case 'r': this.announceCurrentElement(); return true;
    case 'escape': this.stopSpeaking(); return true;
    case 'enter':
      if (this.currentElement && !this.currentElement.matches('input, textarea, select')) {
        this.currentElement.click();
      }
      return false;
  }
  return false;
};

ReadBuddyScreenReader.prototype.toggle = function() {
  this.enabled = !this.enabled;
  if (this.enabled) {
    this.speak("ReadBuddy screen reader enabled. Press J to navigate forward, K to navigate backward, H for headings, L for links, B for buttons, G for images. Press Control Alt R to disable.");
    this.updateNavigableElements();
    const startElement = document.querySelector('h1, h2, main, article') || document.body;
    this.currentElement = startElement;
    this.highlightElement(startElement);
  } else {
    this.speak("ReadBuddy screen reader disabled");
    this.clearHighlight();
    this.stopSpeaking();
  }
  this.updateBubbleStatus();
};

ReadBuddyScreenReader.prototype.updateNavigableElements = function() {
  this.navigableElements = Array.from(
    document.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, p, a, button, input, select, textarea, img[alt], [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])'
    )
  ).filter(el => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0;
  });
  this.elementIndex = 0;
};

ReadBuddyScreenReader.prototype.navigateNext = function() {
  if (this.navigableElements.length === 0) this.updateNavigableElements();
  this.elementIndex = (this.elementIndex + 1) % this.navigableElements.length;
  this.currentElement = this.navigableElements[this.elementIndex];
  this.announceCurrentElement();
};

ReadBuddyScreenReader.prototype.navigatePrevious = function() {
  if (this.navigableElements.length === 0) this.updateNavigableElements();
  this.elementIndex = (this.elementIndex - 1 + this.navigableElements.length) % this.navigableElements.length;
  this.currentElement = this.navigableElements[this.elementIndex];
  this.announceCurrentElement();
};

ReadBuddyScreenReader.prototype.navigateToNext = function(selector) {
  const elements = Array.from(document.querySelectorAll(selector)).filter(el => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  });
  const currentIndex = this.currentElement ? elements.indexOf(this.currentElement) : -1;
  const nextElement = elements[currentIndex + 1] || elements[0];
  if (nextElement) {
    this.currentElement = nextElement;
    this.elementIndex = this.navigableElements.indexOf(nextElement);
    this.announceCurrentElement();
  } else {
    const elementType = selector.includes('h') ? 'heading' : selector.includes('a') ? 'link' : selector.includes('button') ? 'button' : selector.includes('img') ? 'image' : 'element';
    this.speak(`No more ${elementType}s found`);
  }
};

ReadBuddyScreenReader.prototype.announceCurrentElement = function() {
  if (!this.currentElement) return;
  this.highlightElement(this.currentElement);
  this.scrollIntoView(this.currentElement);
  const announcement = this.getElementDescription(this.currentElement);
  this.speak(announcement);
};

ReadBuddyScreenReader.prototype.getElementDescription = function(element) {
  const tag = element.tagName.toLowerCase();
  let description = '';
  if (tag.match(/h[1-6]/)) {
    description = `Heading level ${tag.charAt(1)}, `;
  } else if (tag === 'a') {
    description = 'Link, ';
  } else if (tag === 'button' || element.role === 'button') {
    description = 'Button, ';
  } else if (tag === 'input') {
    description = `${element.type || 'text'} input, `;
  } else if (tag === 'select') {
    description = 'Dropdown menu, ';
  } else if (tag === 'textarea') {
    description = 'Text area, ';
  } else if (tag === 'img') {
    description = 'Image, ';
  }
  if (tag === 'img') {
    description += element.alt || element.title || 'no description available';
  } else if (element.ariaLabel) {
    description += element.ariaLabel;
  } else if (element.title) {
    description += element.title;
  } else if (tag === 'input' && element.placeholder) {
    description += element.placeholder;
  } else {
    const text = (element.innerText || element.textContent || '').trim();
    if (text) {
      description += text.substring(0, 200);
    } else {
      description += 'empty';
    }
  }
  if (element.disabled) description += ', disabled';
  if (element.required) description += ', required';
  if (element.checked !== undefined) {
    description += element.checked ? ', checked' : ', not checked';
  }
  return description;
};

ReadBuddyScreenReader.prototype.highlightElement = function(element) {
  this.clearHighlight();
  if (!element) return;
  element.style.outline = '3px solid #ff6b35';
  element.style.outlineOffset = '2px';
  element.setAttribute('data-readbuddy-highlight', 'true');
};

ReadBuddyScreenReader.prototype.clearHighlight = function() {
  const highlighted = document.querySelector('[data-readbuddy-highlight]');
  if (highlighted) {
    highlighted.style.outline = '';
    highlighted.style.outlineOffset = '';
    highlighted.removeAttribute('data-readbuddy-highlight');
  }
};

ReadBuddyScreenReader.prototype.scrollIntoView = function(element) {
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest'
  });
};

ReadBuddyScreenReader.prototype.speak = function(text, interrupt) {
  if (typeof interrupt === 'undefined') interrupt = true;
  if (interrupt) {
    this.stopSpeaking();
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = this.speechRate;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  utterance.onstart = () => {
    this.speaking = true;
  };
  utterance.onend = () => {
    this.speaking = false;
  };
  window.speechSynthesis.speak(utterance);
};

ReadBuddyScreenReader.prototype.stopSpeaking = function() {
  window.speechSynthesis.cancel();
  this.speaking = false;
};

var readBuddy = new ReadBuddyScreenReader();

console.log('✅ ReadBuddy loaded! Press Ctrl+Alt+R or click the bubble button.');