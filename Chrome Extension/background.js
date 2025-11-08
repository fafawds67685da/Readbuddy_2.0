// background.js - Service worker with multi-frame video analysis support

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Keyboard command handler for shortcuts
let lastCommandTime = {};
let commandInProgress = {}; // Flag to prevent overlapping executions
const COMMAND_COOLDOWN = 300; // 300ms cooldown between commands

chrome.commands.onCommand.addListener(async (command) => {
  console.log('⌨️ COMMAND RECEIVED:', command);
  
  // Aggressive debounce - check both time AND in-progress flag
  const now = Date.now();
  const lastTime = lastCommandTime[command] || 0;
  
  if (commandInProgress[command]) {
    console.log(`⏳ Command "${command}" already in progress, ignoring...`);
    return;
  }
  
  if (now - lastTime < COMMAND_COOLDOWN) {
    console.log(`⏳ Command "${command}" on cooldown (${now - lastTime}ms ago), ignoring...`);
    return;
  }
  
  // Set flags
  lastCommandTime[command] = now;
  commandInProgress[command] = true;
  
  // Clear the in-progress flag after cooldown
  setTimeout(() => {
    commandInProgress[command] = false;
  }, COMMAND_COOLDOWN);
  
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tabs.length === 0) {
    console.log('❌ No active tabs found');
    commandInProgress[command] = false;
    return;
  }
  
  const tab = tabs[0];
  console.log('✅ Active tab:', tab.id, tab.url);
  
  // Skip chrome:// and extension pages (content scripts can't run there)
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    console.log('⚠️ Cannot run on chrome:// pages');
    commandInProgress[command] = false;
    return;
  }
  
  // Try to send message to content script
  try {
    await chrome.tabs.sendMessage(tab.id, { action: command });
    console.log('✅ Message sent successfully');
  } catch (error) {
    // Content script not loaded - inject it first
    console.log('⚠️ Content script not responding, attempting injection...');
    
    try {
      // Check if already injected by trying to ping first
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        console.log('✅ Content script is actually loaded, retrying command...');
        await chrome.tabs.sendMessage(tab.id, { action: command });
        return;
      } catch (pingError) {
        // Really not loaded, inject it
        console.log('🔧 Injecting content script...');
      }
      
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js', 'screenreader.js']
      });
      
      console.log('✅ Content script injected, sending command...');
      
      // Wait a moment for the script to initialize
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: command });
          console.log('✅ Command sent after injection');
        } catch (err) {
          console.log('❌ Still failed:', err.message);
          commandInProgress[command] = false;
        }
      }, 200);
      
    } catch (injectError) {
      console.log('❌ Failed to inject content script:', injectError.message);
      commandInProgress[command] = false;
    }
  }
});

// AUTO-OPEN SIDE PANEL WHEN CHROME STARTS (onStartup works!)
chrome.runtime.onStartup.addListener(() => {
  console.log('🚀 Chrome started - checking auto-open setting...');
  
  // Check if user enabled auto-open
  chrome.storage.sync.get(['autoOpenOnStartup'], (result) => {
    const shouldAutoOpen = result.autoOpenOnStartup !== false; // Default to true
    
    if (shouldAutoOpen) {
      console.log('✅ Auto-open enabled - opening ReadBuddy side panel...');
      
      // Get ALL windows and open side panel in each
      chrome.windows.getAll({ windowTypes: ['normal'] }, (windows) => {
        windows.forEach(window => {
          chrome.sidePanel.open({ windowId: window.id })
            .then(() => console.log(`✅ Side panel opened in window ${window.id}`))
            .catch((error) => console.error('❌ Failed to open:', error.message));
        });
      });
    } else {
      console.log('⏸️ Auto-open disabled by user');
    }
  });
});

// AUTO-OPEN SIDE PANEL WHEN NEW WINDOW IS CREATED
// Unfortunately, Chrome's strict Manifest V3 policies prevent programmatic opening
// without a direct user gesture. We'll show a subtle reminder instead.
chrome.windows.onCreated.addListener((window) => {
  console.log('🪟 New window created:', window.id);
  
  // Only handle normal browser windows
  if (window.type && window.type !== 'normal') {
    return;
  }
  
  // Check if user enabled auto-open
  chrome.storage.sync.get(['autoOpenOnStartup'], (result) => {
    if (result.autoOpenOnStartup !== false) {
      console.log('💡 Tip: Click the ReadBuddy icon to open the side panel');
      // Note: We cannot programmatically open due to Chrome's user gesture requirement
      // The user will need to click the extension icon manually for new windows
    }
  });
});

// AUTO-OPEN SIDE PANEL ON INSTALLATION/UPDATE
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('✅ ReadBuddy installed! Opening side panel...');
    chrome.storage.sync.set({
      speechRate: 1.0,
      autoSpeak: true,
      captureMode: 'multi',  // New: 'single' or 'multi'
      frameInterval: 5,       // New: 3, 5, or 10 seconds
      autoOpenOnStartup: true // NEW: Auto-open setting
    });
    
    // Open side panel immediately after installation
    chrome.windows.getCurrent((window) => {
      if (window && window.id) {
        chrome.sidePanel.open({ windowId: window.id })
          .then(() => console.log('✅ Side panel opened on installation'))
          .catch((error) => console.error('❌ Failed to open side panel:', error));
      }
    });
    
  } else if (details.reason === 'update') {
    console.log('✅ ReadBuddy updated to version', chrome.runtime.getManifest().version);
    // Ensure new settings exist
    chrome.storage.sync.get(['captureMode', 'frameInterval', 'autoOpenOnStartup'], (result) => {
      if (!result.captureMode) {
        chrome.storage.sync.set({ captureMode: 'multi', frameInterval: 5 });
      }
      if (result.autoOpenOnStartup === undefined) {
        chrome.storage.sync.set({ autoOpenOnStartup: true });
      }
    });
  }
});

// Enhanced message handler for content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Background received message:', message.action);
  
  // --- Auto-open side panel (triggered from content script) ---
  if (message.action === 'autoOpenSidePanel') {
    console.log('🚀 Auto-open request received from content script');
    if (sender.tab && sender.tab.windowId) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId })
        .then(() => {
          console.log('✅ Side panel auto-opened successfully');
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error('❌ Failed to auto-open side panel:', error.message);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep channel open for async response
    }
  }
  
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
  
  // --- NEW: Analyze Page (from keyboard shortcut) ---
  if (message.action === 'analyzePage') {
    console.log('📄 Analyzing page content...');
    analyzePageContent(message.text)
      .then(result => {
        console.log('✅ Page analysis complete');
        sendResponse({ success: true, result: result });
      })
      .catch(error => {
        console.error('❌ Page analysis error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
  
  // --- NEW: Analyze FULL page (text + images + videos) - Same as sidepanel button ---
  if (message.action === 'analyzeFullPage') {
    console.log('📊 Analyzing FULL page (text + images + videos)...');
    analyzeFullPage(message.text, message.images, message.videos)
      .then(result => {
        console.log('✅ Full page analysis complete');
        sendResponse({ success: true, result: result });
      })
      .catch(error => {
        console.error('❌ Full page analysis error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
  
  // --- NEW: Analyze Images (from keyboard shortcut) ---
  if (message.action === 'analyzeImages') {
    console.log('🖼️ Analyzing images...');
    analyzePageImages(message.images)
      .then(result => {
        console.log('✅ Image analysis complete');
        sendResponse({ success: true, result: result });
      })
      .catch(error => {
        console.error('❌ Image analysis error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
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

/**
 * NEW: Analyze page text content (for keyboard shortcut)
 * @param {string} text - The page text content
 * @returns {Promise<object>} The analysis result from the backend
 */
async function analyzePageContent(text) {
  try {
    console.log(`📤 Sending page content to backend (${text.length} characters)`);
    
    const response = await fetch("http://127.0.0.1:8000/analyze-page", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        text: text,
        images: [],
        videos: []
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Backend error:", response.status, errorText);
      throw new Error(`Backend page analysis failed: ${response.status}`);
    }
    
    // Handle streaming response (Server-Sent Events)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let result = {
      summaries: [],
      image_descriptions: [],
      video_descriptions: [],
      count: { images_processed: 0, videos_processed: 0, text_chunks: 0 }
    };
    
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || '';
      
      for (const message of messages) {
        if (!message.trim() || !message.startsWith('data: ')) continue;
        
        try {
          const jsonStr = message.substring(6);
          const data = JSON.parse(jsonStr);
          
          switch (data.type) {
            case 'text_summaries':
              result.summaries = data.data;
              break;
            case 'complete':
              result.count = data.data;
              break;
          }
        } catch (e) {
          console.error('❌ Error parsing stream message:', e);
        }
      }
    }
    
    console.log("✅ Page content analyzed successfully");
    return result;
    
  } catch (error) {
    console.error("❌ Background Script Error during page analysis:", error);
    throw error;
  }
}

/**
 * NEW: Analyze page images (for keyboard shortcut)
 * @param {Array<string>} imageUrls - Array of image URLs
 * @returns {Promise<object>} The analysis result from the backend
 */
async function analyzePageImages(imageUrls) {
  try {
    console.log(`📤 Sending ${imageUrls.length} images to backend`);
    
    const response = await fetch("http://127.0.0.1:8000/analyze-page", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        text: "",
        images: imageUrls,
        videos: []
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Backend error:", response.status, errorText);
      throw new Error(`Backend image analysis failed: ${response.status}`);
    }
    
    // Handle streaming response (Server-Sent Events)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let result = {
      summaries: [],
      image_descriptions: [],
      video_descriptions: [],
      count: { images_processed: 0, videos_processed: 0, text_chunks: 0 }
    };
    
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || '';
      
      for (const message of messages) {
        if (!message.trim() || !message.startsWith('data: ')) continue;
        
        try {
          const jsonStr = message.substring(6);
          const data = JSON.parse(jsonStr);
          
          switch (data.type) {
            case 'image_caption':
              result.image_descriptions.push(data.data);
              console.log(`🖼️ Image caption ${data.data.index}/${data.data.total}: ${data.data.caption?.substring(0, 50)}...`);
              
              // Notify content script about new caption (real-time)
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'newImageCaption',
                    caption: data.data
                  });
                }
              });
              break;
            case 'complete':
              result.count = data.data;
              break;
          }
        } catch (e) {
          console.error('❌ Error parsing stream message:', e);
        }
      }
    }
    
    console.log("✅ Images analyzed successfully");
    return result;
    
  } catch (error) {
    console.error("❌ Background Script Error during image analysis:", error);
    throw error;
  }
}

/**
 * NEW: Analyze FULL page (text + images + videos) - Same as sidepanel button
 * @param {string} text - Page text content
 * @param {Array<string>} imageUrls - Array of image URLs
 * @param {Array<string>} videoUrls - Array of video URLs
 * @returns {Promise<object>} The analysis result from the backend
 */
async function analyzeFullPage(text, imageUrls, videoUrls) {
  try {
    console.log(`📤 Sending FULL page to backend: ${text.length} chars, ${imageUrls.length} images, ${videoUrls.length} videos`);
    
    const response = await fetch("http://127.0.0.1:8000/analyze-page", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        text: text,
        images: imageUrls,
        videos: videoUrls
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Backend error:", response.status, errorText);
      throw new Error(`Backend full page analysis failed: ${response.status}`);
    }
    
    // Handle streaming response (Server-Sent Events)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let result = {
      summaries: [],
      image_descriptions: [],
      video_descriptions: [],
      count: {
        images_processed: 0,
        videos_processed: 0,
        text_chunks: 0
      }
    };
    
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log("✅ Full page stream completed");
        break;
      }
      
      // Decode and add to buffer
      buffer += decoder.decode(value, { stream: true });
      
      // Process complete messages (ending with \n\n)
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || ''; // Keep incomplete message in buffer
      
      for (const message of messages) {
        if (!message.trim() || !message.startsWith('data: ')) continue;
        
        try {
          const jsonStr = message.substring(6); // Remove 'data: ' prefix
          const data = JSON.parse(jsonStr);
          
          console.log(`📨 Received stream event:`, data.type);
          
          switch (data.type) {
            case 'text_summaries':
              result.summaries = data.data;
              console.log(`📝 Text summaries received: ${data.data.length} chunks`);
              break;
              
            case 'image_caption':
              result.image_descriptions.push(data.data);
              console.log(`🖼️ Image caption ${data.data.index}/${data.data.total}: ${data.data.caption?.substring(0, 50)}...`);
              
              // Notify content script about new caption (real-time)
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'newImageCaption',
                    caption: data.data
                  });
                }
              });
              break;
              
            case 'video_description':
              result.video_descriptions.push(data.data);
              console.log(`🎥 Video description received`);
              break;
              
            case 'complete':
              result.count = data.data;
              console.log(`✅ Processing complete: ${data.data.images_processed} images`);
              break;
          }
        } catch (e) {
          console.error('❌ Error parsing stream message:', e, message);
        }
      }
    }
    
    console.log("✅ Full page analyzed successfully");
    
    return result;
    
  } catch (error) {
    console.error("❌ Background Script Error during full page analysis:", error);
    throw error;
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