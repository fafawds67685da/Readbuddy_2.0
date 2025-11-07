// background.js - Service worker with multi-frame video analysis support

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set up side panel on installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('✅ ReadBuddy installed! Click the extension icon to open the side panel.');
    chrome.storage.sync.set({
      speechRate: 1.0,
      autoSpeak: true,
      captureMode: 'multi',  // New: 'single' or 'multi'
      frameInterval: 5        // New: 3, 5, or 10 seconds
    });
  } else if (details.reason === 'update') {
    console.log('✅ ReadBuddy updated to version', chrome.runtime.getManifest().version);
    // Ensure new settings exist
    chrome.storage.sync.get(['captureMode', 'frameInterval'], (result) => {
      if (!result.captureMode) {
        chrome.storage.sync.set({ captureMode: 'multi', frameInterval: 5 });
      }
    });
  }
});

// Enhanced message handler for content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Background received message:', message.action);
  
  // --- Single Video Frame Analysis (original) ---
  if (message.action === 'analyzeVideoFrame') {
    console.log('📤 Forwarding single frame to backend...');
    analyzeSingleFrame(message.imageData)
      .then(result => {
        console.log('✅ Backend analysis complete:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('❌ Backend analysis error:', error);
        sendResponse({ 
          success: false, 
          error: error.message || "Failed to analyze frame" 
        });
      });
    return true; // Keep channel open for async response
  }
  
  // --- Multi-Frame Video Sequence Analysis (batch mode - legacy) ---
  if (message.action === 'analyzeVideoSequence') {
    console.log(`📤 Forwarding ${message.frames.length} frames to backend for batch analysis...`);
    analyzeFrameSequence(message.frames)
      .then(result => {
        console.log('✅ Backend sequence analysis complete');
        sendResponse(result);
      })
      .catch(error => {
        console.error('❌ Backend sequence analysis error:', error);
        sendResponse({ 
          success: false, 
          error: error.message || "Failed to analyze frame sequence" 
        });
      });
    return true; // Keep channel open for async response
  }
  
  // --- NEW: Analyze Single Frame for Caption (parallel processing) ---
  if (message.action === 'analyzeFrameForCaption') {
    console.log(`📤 Forwarding frame ${message.frameIndex + 1} to backend for caption...`);
    analyzeSingleFrameForCaption(message.imageData, message.frameIndex)
      .then(result => {
        console.log(`✅ Caption ${message.frameIndex + 1} generated`);
        sendResponse(result);
      })
      .catch(error => {
        console.error(`❌ Caption generation error for frame ${message.frameIndex + 1}:`, error);
        sendResponse({ 
          success: false, 
          error: error.message || "Failed to generate caption" 
        });
      });
    return true; // Keep channel open for async response
  }
  
  // --- NEW: Summarize Captions (parallel processing) ---
  if (message.action === 'summarizeCaptions') {
    console.log(`📤 Forwarding ${message.captions.length} captions to backend for summarization...`);
    summarizeCaptionsOnly(message.captions)
      .then(result => {
        console.log('✅ Captions summarized successfully');
        sendResponse(result);
      })
      .catch(error => {
        console.error('❌ Caption summarization error:', error);
        sendResponse({ 
          success: false, 
          error: error.message || "Failed to summarize captions" 
        });
      });
    return true; // Keep channel open for async response
  }
  
  // --- Screenshot Capture for CORS Videos ---
  if (message.action === 'captureVisibleTab') {
    console.log('📸 Capturing visible tab...');
    chrome.tabs.captureVisibleTab(
      null,
      { format: 'png' },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error("❌ Screenshot error:", chrome.runtime.lastError);
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          console.log("✅ Screenshot captured successfully");
          sendResponse({ imageData: dataUrl });
        }
      }
    );
    return true; // Keep channel open for async response
  }
  
  // --- Open Side Panel ---
  if (message.action === 'openSidePanel') {
    if (sender.tab && sender.tab.windowId) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId })
        .then(() => {
          sendResponse({ success: true });
        })
        .catch(error => {
          console.error("❌ Error opening side panel:", error);
          sendResponse({ success: false, error: error.message });
        });
    } else {
      sendResponse({ success: false, error: "No tab context available" });
    }
    return true; // Keep channel open for async response
  }
  
  // --- Forward status messages to ALL side panels ---
  if (message.action === 'videoAnalysisStarted') {
    console.log('🎬 Video analysis started - forwarding to sidepanel');
    broadcastToSidePanels(message);
    sendResponse({ received: true });
    return false;
  }
  
  if (message.action === 'videoAnalysisUpdate') {
    console.log('📹 Video analysis update:', message.description?.substring(0, 50) + '...');
    broadcastToSidePanels(message);
    sendResponse({ received: true });
    return false;
  }
  
  if (message.action === 'videoSequenceAnalyzed') {
    console.log('🎬 Video sequence analyzed:', message.summary?.substring(0, 50) + '...');
    broadcastToSidePanels(message);
    sendResponse({ received: true });
    return false;
  }
  
  if (message.action === 'videoAnalysisError') {
    console.error('❌ Video analysis error:', message.message);
    broadcastToSidePanels(message);
    sendResponse({ received: true });
    return false;
  }
  
  if (message.action === 'videoAnalysisLoading') {
    console.log('⏳ Video analysis loading:', message.message);
    broadcastToSidePanels(message);
    sendResponse({ received: true });
    return false;
  }
  
  // Default: no async response needed
  return false;
});

/**
 * Broadcast a message to all open side panels
 */
function broadcastToSidePanels(message) {
  chrome.runtime.sendMessage(message).catch(err => {
    // Side panel might not be open, ignore error
    console.log('Side panel not listening:', err.message);
  });
}

/**
 * Forwards a single base64 image to the FastAPI backend for visual analysis.
 * @param {string} base64Image - The Base64 representation of the video frame.
 * @returns {Promise<object>} The analysis result from the backend.
 */
async function analyzeSingleFrame(base64Image) {
  try {
    console.log("📤 Sending single frame to backend (size: " + Math.round(base64Image.length / 1024) + " KB)");
    
    const response = await fetch("http://127.0.0.1:8000/analyze-video-frame", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image_data: base64Image }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Backend error:", response.status, errorText);
      throw new Error(`Backend analysis failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("✅ Single frame analysis successful:", data.description?.substring(0, 50) + '...');
    
    return { success: true, result: data };
    
  } catch (error) {
    console.error("❌ Background Script Error during Single Frame Analysis:", error);
    return { 
      success: false, 
      error: error.message || "Failed to analyze frame." 
    };
  }
}

/**
 * Forwards multiple base64 images to the FastAPI backend for sequence analysis.
 * @param {Array<string>} frames - Array of Base64 image strings.
 * @returns {Promise<object>} The analysis result from the backend.
 */
async function analyzeFrameSequence(frames) {
  try {
    console.log(`📤 Sending ${frames.length} frames to backend (total size: ~${Math.round(frames.reduce((sum, f) => sum + f.length, 0) / 1024)} KB)`);
    
    const response = await fetch("http://127.0.0.1:8000/analyze-video-sequence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ frames: frames }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Backend error:", response.status, errorText);
      throw new Error(`Backend sequence analysis failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("✅ Frame sequence analysis successful");
    console.log(`   - Individual captions: ${data.individual_captions?.length || 0}`);
    console.log(`   - Summary: ${data.summary?.substring(0, 100)}...`);
    
    return { success: true, result: data };
    
  } catch (error) {
    console.error("❌ Background Script Error during Frame Sequence Analysis:", error);
    return { 
      success: false, 
      error: error.message || "Failed to analyze frame sequence." 
    };
  }
}

/**
 * NEW: Forwards a single frame to backend and returns only the caption (for parallel processing)
 * @param {string} base64Image - The Base64 representation of the video frame.
 * @param {number} frameIndex - The index of the frame in the sequence.
 * @returns {Promise<object>} The caption result from the backend.
 */
async function analyzeSingleFrameForCaption(base64Image, frameIndex) {
  try {
    console.log(`📤 Sending frame ${frameIndex + 1} to backend for caption (size: ${Math.round(base64Image.length / 1024)} KB)`);
    
    const response = await fetch("http://127.0.0.1:8000/analyze-video-frame", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      // Send fast=true to use CPU-friendly captioning settings on backend
      body: JSON.stringify({ image_data: base64Image, fast: true }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Backend error:", response.status, errorText);
      throw new Error(`Backend caption generation failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`✅ Caption ${frameIndex + 1} generated: "${data.description?.substring(0, 50)}..."`);
    
    return { success: true, caption: data.description };
    
  } catch (error) {
    console.error(`❌ Background Script Error generating caption for frame ${frameIndex + 1}:`, error);
    return { 
      success: false, 
      error: error.message || "Failed to generate caption." 
    };
  }
}

/**
 * NEW: Sends captions array to backend for T5 summarization (for parallel processing)
 * @param {Array<string>} captions - Array of caption strings.
 * @returns {Promise<object>} The summary result from the backend.
 */
async function summarizeCaptionsOnly(captions) {
  try {
    console.log(`📤 Sending ${captions.length} captions to backend for summarization`);
    
    const response = await fetch("http://127.0.0.1:8000/summarize-captions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ captions: captions }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Backend error:", response.status, errorText);
      throw new Error(`Backend summarization failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("✅ Captions summarized successfully");
    console.log(`   - Summary: ${data.summary?.substring(0, 100)}...`);
    
    return { success: true, summary: data.summary };
    
  } catch (error) {
    console.error("❌ Background Script Error during caption summarization:", error);
    return { 
      success: false, 
      error: error.message || "Failed to summarize captions." 
    };
  }
}

// Keep service worker alive
let keepAlive;
function startKeepAlive() {
  if (keepAlive) return;
  keepAlive = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // Ping to keep alive
    });
  }, 25000);
}

startKeepAlive();

console.log('🔊 ReadBuddy background service loaded (v1.3.0 - Pause/Resume support)');