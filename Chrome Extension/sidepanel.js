// sidepanel.js - FIXED: Button debouncing and better state management

let speechRate = 1.0;
let autoSpeak = true;
let lastResults = null;
let isVideoAnalyzing = false;
let isProcessing = false; // NEW: Prevent double-clicks

// Load saved settings
chrome.storage.sync.get(['speechRate', 'autoSpeak'], (result) => {
  speechRate = result.speechRate || 1.0;
  autoSpeak = result.autoSpeak !== false;
  
  document.getElementById('speedSlider').value = speechRate;
  document.getElementById('speedValue').textContent = speechRate.toFixed(1) + 'x';
  document.getElementById('autoSpeak').checked = autoSpeak;
});

// Update page info
async function updatePageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      document.getElementById('pageInfo').textContent = url.hostname;
    }
  } catch (err) {
    console.error('Error getting page info:', err);
  }
}

updatePageInfo();

// Listen for tab changes
chrome.tabs.onActivated.addListener(() => {
  updatePageInfo();
  // Reset video analysis state when tab changes
  if (isVideoAnalyzing) {
    resetVideoAnalysisButton();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updatePageInfo();
    // Reset video analysis state when page reloads
    if (isVideoAnalyzing) {
      resetVideoAnalysisButton();
    }
  }
});

// NEW: Helper function to reset video analysis button
function resetVideoAnalysisButton() {
  isVideoAnalyzing = false;
  isProcessing = false;
  const btn = document.getElementById('analyzeVideoBtn');
  btn.querySelector('span:last-child').textContent = 'Video Visuals Analysis (30s)';
  btn.classList.remove('btn-danger');
  btn.classList.add('btn-special');
  btn.disabled = false;
}

// Analyze button (Text/Image/Video Metadata Summary)
document.getElementById('analyzeBtn').addEventListener('click', async () => {
  // NEW: Prevent double-clicks
  if (isProcessing) {
    console.log('⚠️ Already processing, ignoring click');
    return;
  }
  
  isProcessing = true;
  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  
  try {
    showLoading(true, "Analyzing page content...");
    clearOutput();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showError('No active tab found');
      return;
    }

    // Extract content from page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent
    });

    if (!results || !results[0] || !results[0].result) {
      showError('Could not extract page content');
      return;
    }

    const { text, images, videos } = results[0].result;
    
    console.log('📊 Extracted:', {
      textLength: text.length,
      images: images.length,
      videos: videos.length
    });

    // Send to backend
    const response = await fetch('http://127.0.0.1:8000/analyze-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, images, videos })
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();
    lastResults = data;
    
    showLoading(false);
    displayResults(data);

    if (autoSpeak) {
      speakResults(data);
    }

  } catch (err) {
    showLoading(false);
    showError(err.message);
    console.error('Analysis error:', err);
  } finally {
    // NEW: Re-enable button after operation completes
    isProcessing = false;
    btn.disabled = false;
  }
});

// --- Video Visuals Analysis Button (FIXED) ---
document.getElementById('analyzeVideoBtn').addEventListener('click', async () => {
  // NEW: Prevent double-clicks
  if (isProcessing) {
    console.log('⚠️ Already processing video command, ignoring click');
    return;
  }
  
  isProcessing = true;
  const btn = document.getElementById('analyzeVideoBtn');
  btn.disabled = true;
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    showError('No active tab found');
    isProcessing = false;
    btn.disabled = false;
    return;
  }
  
  // Toggle state logic
  isVideoAnalyzing = !isVideoAnalyzing;
  
  if (isVideoAnalyzing) {
    // Start Analysis
    btn.querySelector('span:last-child').textContent = 'STOP Video Analysis';
    btn.classList.remove('btn-special');
    btn.classList.add('btn-danger');
    clearOutput();
    showLoading(true, "Searching for video and starting loop...");

    console.log('🎬 Starting video analysis...');
    
    // Send message to content script to START the video analysis loop
    chrome.tabs.sendMessage(tab.id, { action: 'startVideoAnalysis' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error starting video analysis:', chrome.runtime.lastError);
        showError('Could not start video analysis. Please refresh the page.');
        // Reset button
        resetVideoAnalysisButton();
      } else {
        console.log('✅ Video analysis started');
      }
      // Re-enable button after command sent
      isProcessing = false;
      btn.disabled = false;
    });
    
  } else {
    // Stop Analysis
    console.log('🛑 Stopping video analysis...');
    btn.querySelector('span:last-child').textContent = 'Video Visuals Analysis (30s)';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-special');
    showLoading(false);
    
    // Send message to content script to STOP the video analysis loop
    chrome.tabs.sendMessage(tab.id, { action: 'stopVideoAnalysis' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error stopping video analysis:', chrome.runtime.lastError);
      } else {
        console.log('✅ Video analysis stopped');
      }
      // Re-enable button after command sent
      isProcessing = false;
      btn.disabled = false;
    });
    
    speak('Video analysis stopped.');
  }
});

// Handle messages from background script (video analysis updates)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Sidepanel received message:', message.action);
  
  if (message.action === 'videoAnalysisUpdate') {
    console.log('📹 Video update:', message.description);
    showLoading(false);
    displayVideoDescription(message.description, message.timestamp);
    if (autoSpeak) {
      const timeStr = Math.floor(message.timestamp);
      speak(`At ${timeStr} seconds, the video shows: ${message.description}`);
    }
    sendResponse({ success: true });
  } else if (message.action === 'videoAnalysisError') {
    console.error('❌ Video error:', message.message);
    
    // NEW: Only stop the loop if it's a critical error
    const criticalErrors = [
      'Could not find a visible video element',
      'Video element was removed from page'
    ];
    
    const isCritical = criticalErrors.some(err => message.message.includes(err));
    
    if (isCritical && isVideoAnalyzing) {
      console.log('⚠️ Critical error detected, stopping analysis');
      resetVideoAnalysisButton();
    }
    
    showError(`Video Analysis: ${message.message}`);
    sendResponse({ success: true });
  } else if (message.action === 'videoAnalysisLoading') {
    console.log('⏳ Video loading:', message.message);
    showLoading(true, message.message);
    sendResponse({ success: true });
  }
  
  return false;
});

// Extract page content function (runs in page context)
function extractPageContent() {
  const text = document.body.innerText.slice(0, 4000);
  
  // Get images
  const images = Array.from(document.images)
    .filter(img => {
      const src = img.src || '';
      const isValidSize = img.width > 100 && img.height > 100;
      const isHttp = src.startsWith('http');
      return isValidSize && isHttp;
    })
    .map(img => img.src)
    .slice(0, 10);
  
  // Get videos
  const videos = [];
  
  document.querySelectorAll('video').forEach(v => {
    if (v.src || v.currentSrc) {
      videos.push(v.src || v.currentSrc);
    }
  });
  
  document.querySelectorAll('iframe').forEach(iframe => {
    const src = iframe.src || '';
    if (src.includes('youtube.com') || src.includes('youtu.be') || src.includes('vimeo.com')) {
      videos.push(src);
    }
  });
  
  return { text, images, videos: videos.slice(0, 5) };
}

// Stop speaking
document.getElementById('stopBtn').addEventListener('click', () => {
  window.speechSynthesis.cancel();
});

// Read again
document.getElementById('readAgainBtn').addEventListener('click', () => {
  if (lastResults) {
    speakResults(lastResults);
  } else {
    speak('No content to read. Please analyze a page first.');
  }
});

// Speed control
document.getElementById('speedSlider').addEventListener('input', (e) => {
  speechRate = parseFloat(e.target.value);
  document.getElementById('speedValue').textContent = speechRate.toFixed(1) + 'x';
  chrome.storage.sync.set({ speechRate });
});

// Auto-speak toggle
document.getElementById('autoSpeak').addEventListener('change', (e) => {
  autoSpeak = e.target.checked;
  chrome.storage.sync.set({ autoSpeak });
});

// Display results (for standard page analysis)
function displayResults(data) {
  let html = '';
  
  // Text Summary
  html += '<div style="margin-bottom: 20px;">';
  html += '<h3 style="color: #2563eb; margin-bottom: 10px;">📝 Text Summary</h3>';
  
  if (data.summaries && data.summaries.length > 0) {
    data.summaries.forEach((summary) => {
      html += `<p style="margin-bottom: 12px; padding: 10px; background: #f3f4f6; border-radius: 6px;">${summary}</p>`;
    });
  } else {
    html += '<p style="color: #dc2626;">No summary generated</p>';
  }
  html += '</div>';
  
  // Images
  if (data.image_descriptions && data.image_descriptions.length > 0) {
    html += '<div style="margin-bottom: 20px;">';
    html += '<h3 style="color: #2563eb; margin-bottom: 10px;">🖼️ Image Descriptions</h3>';
    
    data.image_descriptions.forEach((item, i) => {
      if (item.caption && !item.caption.includes('No valid')) {
        html += `<div style="margin-bottom: 15px; padding: 10px; background: #f9fafb; border-left: 3px solid #10b981; border-radius: 4px;">`;
        html += `<p style="margin-bottom: 4px;"><strong>Image ${i + 1}:</strong> ${item.caption}</p>`;
        if (item.size) {
          html += `<p style="font-size: 11px; color: #6b7280;">Size: ${item.size}</p>`;
        }
        html += `</div>`;
      }
    });
    html += '</div>';
  }
  
  // Videos
  if (data.video_descriptions && data.video_descriptions.length > 0 && 
      data.video_descriptions[0].type !== 'none') {
    html += '<div style="margin-bottom: 20px;">';
    html += '<h3 style="color: #2563eb; margin-bottom: 10px;">🎬 Video Descriptions</h3>';
    
    data.video_descriptions.forEach((item, i) => {
      if (item.description && item.type !== 'none') {
        html += `<div style="margin-bottom: 15px; padding: 10px; background: #fef3c7; border-left: 3px solid #f59e0b; border-radius: 4px;">`;
        html += `<p style="margin-bottom: 4px;"><strong>Video ${i + 1}:</strong> ${item.description}</p>`;
        if (item.method) {
          const methodLabel = item.method === 'transcript' ? '📝 From transcript' : 
                              item.method === 'metadata' ? '📊 Basic info' : 
                              '🔍 Detected';
          html += `<p style="font-size: 11px; color: #92400e;">${methodLabel}</p>`;
        }
        html += `</div>`;
      }
    });
    html += '</div>';
  }
  
  // Stats
  if (data.count) {
    html += `<p style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">`;
    html += `📊 Processed: ${data.count.images_processed} images`;
    if (data.count.videos_processed > 0) {
      html += `, ${data.count.videos_processed} videos`;
    }
    html += `</p>`;
  }
  
  document.getElementById('output').innerHTML = html;
}

// Display live video analysis descriptions
function displayVideoDescription(text, timestamp) {
  const timeFormatted = Math.floor(timestamp);
  let html = `
    <div style="margin-bottom: 15px; padding: 10px; background: #e6fffa; border-left: 3px solid #38b2ac; border-radius: 4px;">
      <p style="margin-bottom: 4px;"><strong>[${timeFormatted}s] Live Visuals:</strong></p>
      <p style="font-size: 14px; line-height: 1.5; color: #047857;">${text}</p>
    </div>
  `;
  
  // Append to the output div
  const outputDiv = document.getElementById('output');
  outputDiv.insertAdjacentHTML('afterbegin', html);
  outputDiv.scrollTop = 0; // Scroll to show the newest result
}

// Speak results
function speakResults(data) {
  let textToSpeak = '';
  
  if (data.summaries && data.summaries.length > 0) {
    textToSpeak += 'Page summary: ' + data.summaries.join('. ') + '. ';
  }

  if (data.image_descriptions && data.image_descriptions.length > 0) {
    const imageCount = data.image_descriptions.filter(item => 
      item.caption && !item.caption.includes('No valid')
    ).length;
  
    if (imageCount > 0) {
      textToSpeak += `Found ${imageCount} images. `;
      data.image_descriptions.forEach((item, i) => {
        if (item.caption && !item.caption.includes('No valid')) {
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
    speak(textToSpeak);
  }
}

// Speak function
function speak(text) {
  window.speechSynthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = speechRate;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  
  window.speechSynthesis.speak(utterance);
}

// UI helpers
function showLoading(show, message = "Analyzing...") {
  document.getElementById('loading').classList.toggle('active', show);
  document.querySelector('#loading p').textContent = message;
}

function clearOutput() {
  document.getElementById('output').innerHTML = '';
}

function showError(message) {
  document.getElementById('output').innerHTML = 
    `<p style="color: #dc2626; padding: 16px; background: #fee2e2; border-radius: 8px;">
      ❌ Error: ${message}
    </p>`;
}

console.log('✅ ReadBuddy side panel loaded!');