// background.js - Service worker for side panel

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
      autoSpeak: true
    });
  } else if (details.reason === 'update') {
    console.log('✅ ReadBuddy updated to version', chrome.runtime.getManifest().version);
  }
});

// Enhanced message handler for content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Background received message:', message.action);
  
  // --- Video Frame Analysis ---
  if (message.action === 'analyzeVideoFrame') {
    console.log('📤 Forwarding frame to backend...');
    analyzeFrame(message.imageData)
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
  if (message.action === 'videoAnalysisUpdate') {
    console.log('📹 Video analysis update:', message.description?.substring(0, 50) + '...');
    // Broadcast to all side panels
    broadcastToSidePanels(message);
    sendResponse({ received: true });
    return false;
  }
  
  if (message.action === 'videoAnalysisError') {
    console.error('❌ Video analysis error:', message.message);
    // Broadcast to all side panels
    broadcastToSidePanels(message);
    sendResponse({ received: true });
    return false;
  }
  
  if (message.action === 'videoAnalysisLoading') {
    console.log('⏳ Video analysis loading:', message.message);
    // Broadcast to all side panels
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
 * Forwards the base64 image data to the FastAPI backend for visual analysis.
 * @param {string} base64Image - The Base64 representation of the video frame.
 * @returns {Promise<object>} The analysis result from the backend.
 */
async function analyzeFrame(base64Image) {
  try {
    console.log("📤 Sending frame to backend (size: " + Math.round(base64Image.length / 1024) + " KB)");
    
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
    console.log("✅ Frame analysis successful:", data.description?.substring(0, 50) + '...');
    
    return { success: true, result: data };
    
  } catch (error) {
    console.error("❌ Background Script Error during Frame Analysis:", error);
    return { 
      success: false, 
      error: error.message || "Failed to analyze frame." 
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

console.log('🔊 ReadBuddy background service loaded');