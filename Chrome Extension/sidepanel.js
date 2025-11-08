// sidepanel.js - Multi-frame video analysis with pause/resume coordination

let speechRate = 1.0;
let autoSpeak = true;
let autoOpenOnStartup = true; // NEW: Auto-open on startup setting
let lastResults = null;
let isVideoAnalyzing = false;
let isProcessing = false;

// NEW: Video analysis settings
let captureMode = 'multi'; // 'single' or 'multi'
let frameInterval = 5; // 3, 5, or 10 seconds

// NEW: Countdown timer state
let countdownInterval = null;
let remainingSeconds = 30;
let isTTSSpeaking = false; // Flag to prevent duplicate resume commands

// Load saved settings
chrome.storage.sync.get(['speechRate', 'autoSpeak', 'autoOpenOnStartup', 'captureMode', 'frameInterval'], (result) => {
  speechRate = result.speechRate || 1.0;
  autoSpeak = result.autoSpeak !== false;
  autoOpenOnStartup = result.autoOpenOnStartup !== false; // NEW
  captureMode = result.captureMode || 'multi';
  frameInterval = result.frameInterval || 5;
  
  document.getElementById('speedSlider').value = speechRate;
  document.getElementById('speedValue').textContent = speechRate.toFixed(1) + 'x';
  document.getElementById('autoSpeak').checked = autoSpeak;
  document.getElementById('autoOpenOnStartup').checked = autoOpenOnStartup; // NEW
  document.getElementById('captureMode').value = captureMode;
  document.getElementById('frameInterval').value = frameInterval;
  
  updateVideoButtonText();
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
  if (isVideoAnalyzing) {
    resetVideoAnalysisButton();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updatePageInfo();
    if (isVideoAnalyzing) {
      resetVideoAnalysisButton();
    }
  }
});

  // NEW: Countdown timer functions
  function startCountdownTimer() {
    const countdownDisplay = document.getElementById('countdownDisplay');
    const countdownText = document.getElementById('countdownText');
    const countdownProgress = document.getElementById('countdownProgress');
  
    if (!countdownDisplay || !countdownText || !countdownProgress) {
      console.error('❌ Countdown elements not found in DOM!');
      return;
    }
    
    // Stop any existing countdown
    if (countdownInterval) {
      console.log('⏰ Clearing existing countdown interval');
      clearInterval(countdownInterval);
    }
  
    console.log(`⏰ Starting countdown timer - showing display for ${remainingSeconds}s...`);
    countdownDisplay.style.display = 'block';
    
    // Store initial duration for progress bar calculation
    const initialDuration = remainingSeconds;
  
    // Update immediately
    updateCountdownDisplay(initialDuration);
    console.log(`⏰ Countdown display should now be visible with ${remainingSeconds}s`);
  
    // Update every second
    countdownInterval = setInterval(() => {
      remainingSeconds--;
    
      if (remainingSeconds <= 0) {
        remainingSeconds = initialDuration; // Reset for next cycle
      }
    
      updateCountdownDisplay(initialDuration);
    }, 1000);
    
    console.log('✅ Countdown timer started successfully');
  }

  function updateCountdownDisplay(maxDuration = 30) {
    const countdownText = document.getElementById('countdownText');
    const countdownProgress = document.getElementById('countdownProgress');
  
    countdownText.textContent = `${remainingSeconds}s`;
  
    // DYNAMIC: Update progress bar based on actual duration
    const percentage = (remainingSeconds / maxDuration) * 100;
    countdownProgress.style.width = `${percentage}%`;
  
    // Change color when close to analysis (last 5s)
    if (remainingSeconds <= 5) {
      countdownProgress.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
      countdownText.style.color = '#ef4444';
    } else {
      countdownProgress.style.background = 'linear-gradient(90deg, #2563eb, #1d4ed8)';
      countdownText.style.color = '#2563eb';
    }
  }

  function stopCountdownTimer() {
    console.log('⏸️ Stopping countdown timer (video paused for TTS)');
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    // Keep countdown display visible but frozen
  }

  function resetCountdown() {
    console.log('▶️ Restarting countdown timer (video resumed after TTS)');
    remainingSeconds = 30;
    updateCountdownDisplay();
    
    // Restart the countdown interval for the next 30s cycle
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }
    
    countdownInterval = setInterval(() => {
      remainingSeconds--;
    
      if (remainingSeconds <= 0) {
        remainingSeconds = 30; // Reset for next cycle
      }
    
      updateCountdownDisplay();
    }, 1000);
  }

// Helper function to reset video analysis button
function resetVideoAnalysisButton() {
  isVideoAnalyzing = false;
  isProcessing = false;
  
  // Hide countdown when analysis stops completely
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  
  const countdownDisplay = document.getElementById('countdownDisplay');
  if (countdownDisplay) {
    countdownDisplay.style.display = 'none';
  }
  remainingSeconds = 30;
  
  updateVideoButtonText();
  const btn = document.getElementById('analyzeVideoBtn');
  btn.classList.remove('btn-danger');
  btn.classList.add('btn-special');
  btn.disabled = false;
}

// Update video button text based on settings
function updateVideoButtonText() {
  const btn = document.getElementById('analyzeVideoBtn');
  const mode = captureMode === 'multi' ? 'Multi-Frame' : 'Single-Frame';
  const interval = captureMode === 'multi' ? `(${frameInterval}s intervals)` : '(30s)';
  
  if (!isVideoAnalyzing) {
    btn.querySelector('span:last-child').textContent = `${mode} Video Analysis ${interval}`;
  }
}

// Analyze button (Text/Image/Video Metadata Summary)
document.getElementById('analyzeBtn').addEventListener('click', async () => {
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

    const response = await fetch('http://127.0.0.1:8000/analyze-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, images, videos })
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    // Handle streaming response (Server-Sent Events)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let data = {
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
          const eventData = JSON.parse(jsonStr);
          
          switch (eventData.type) {
            case 'text_summaries':
              data.summaries = eventData.data;
              console.log(`📝 Text summaries received: ${eventData.data.length} chunks`);
              break;
            case 'image_caption':
              data.image_descriptions.push(eventData.data);
              console.log(`🖼️ Image caption ${eventData.data.index}/${eventData.data.total}: ${eventData.data.caption?.substring(0, 50)}...`);
              break;
            case 'video_description':
              data.video_descriptions.push(eventData.data);
              console.log(`🎥 Video description received`);
              break;
            case 'complete':
              data.count = eventData.data;
              console.log(`✅ Processing complete: ${eventData.data.images_processed} images`);
              break;
          }
        } catch (e) {
          console.error('❌ Error parsing stream message:', e);
        }
      }
    }

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
    isProcessing = false;
    btn.disabled = false;
  }
});

// Video Visuals Analysis Button
document.getElementById('analyzeVideoBtn').addEventListener('click', async () => {
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
  
  isVideoAnalyzing = !isVideoAnalyzing;
  
  if (isVideoAnalyzing) {
    // Start Analysis
    console.log('🎬 Changing button to STOP state...');
    btn.querySelector('span:last-child').textContent = 'STOP Video Analysis';
    btn.classList.remove('btn-special');
    btn.classList.add('btn-danger');
    console.log('🔴 Button classes after change:', btn.className);
    clearOutput();
    
    // Start countdown timer IMMEDIATELY
    console.log('⏱️ Starting countdown timer NOW...');
    startCountdownTimer();
    
    const modeText = captureMode === 'multi' ? `multi-frame (${frameInterval}s intervals)` : 'single-frame';
    showLoading(true, `Starting ${modeText} analysis...`);

  console.log('🎬 Starting video analysis...');
    
    // Send current settings to content script
    chrome.tabs.sendMessage(tab.id, { 
      action: 'updateVideoSettings',
      captureMode: captureMode,
      frameInterval: frameInterval
    });
    
    // Start the video analysis loop
    chrome.tabs.sendMessage(tab.id, { action: 'startVideoAnalysis' }, (response) => {
      isProcessing = false;
      
      if (chrome.runtime.lastError) {
        console.error('Error starting video analysis:', chrome.runtime.lastError);
        showError('Could not start video analysis. Please refresh the page.');
        resetVideoAnalysisButton();
        stopCountdownTimer();
        btn.disabled = false;
      } else {
        console.log('✅ Video analysis started - button should stay RED');
        // CRITICAL: Keep button enabled in "STOP" state, don't reset text
        btn.disabled = false;
        // Verify countdown is still visible
        const countdownDisplay = document.getElementById('countdownDisplay');
        if (countdownDisplay && countdownDisplay.style.display !== 'block') {
          console.warn('⚠️ Countdown was hidden, reshowing...');
          countdownDisplay.style.display = 'block';
        }
      }
    });
    
  } else {
    // Stop Analysis
    console.log('🛑 Stopping video analysis...');
    btn.querySelector('span:last-child').textContent = 'Video Visuals Analysis';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-special');
  showLoading(false);
  stopCountdownTimer();
    updateVideoButtonText();
    
    chrome.tabs.sendMessage(tab.id, { action: 'stopVideoAnalysis' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error stopping video analysis:', chrome.runtime.lastError);
      } else {
        console.log('✅ Video analysis stopped');
      }
      isProcessing = false;
      btn.disabled = false;
    });
    
    speak('Video analysis stopped.');
  }
});

// Handle messages from background script (video analysis updates)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Sidepanel received message:', message.action);
  
  // Ensure countdown is visible when analysis is loading (fallback if start hook was missed)
  // FIXED: Start countdown when video analysis begins
  if (message.action === 'videoAnalysisStarted') {
    console.log('⏰ Video analysis started - starting countdown timer');
    isVideoAnalyzing = true;
    
    // SEGMENTED DURATION: Use segment duration from message
    if (message.duration && message.duration > 0) {
      remainingSeconds = message.duration;
      const segInfo = message.segment && message.totalSegments 
        ? ` (Segment ${message.segment}/${message.totalSegments})` 
        : '';
      console.log(`📏 Setting countdown to ${message.duration}s${segInfo}`);
    } else {
      remainingSeconds = 30; // Fallback
    }
    
    startCountdownTimer();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'videoAnalysisLoading') {
    const countdownDisplay = document.getElementById('countdownDisplay');
    if (countdownDisplay && countdownDisplay.style.display !== 'block' && isVideoAnalyzing) {
      console.log('⏱️ Starting countdown (via loading message)');
      startCountdownTimer();
    }
  }

    if (message.action === 'resetCountdown' || message.action === 'restartCountdown') {
      // Restart countdown timer when video resumes after narration
      console.log('⏱️ Restarting countdown timer (for next 30s cycle)');
      resetCountdown();
      sendResponse({ success: true });
    }
    else if (message.action === 'stopCountdown') {
      // Stop countdown timer when video pauses for TTS
      console.log('⏱️ Stopping countdown timer (TTS speaking)');
      stopCountdownTimer();
      sendResponse({ success: true });
    }
    else if (message.action === 'videoAnalysisUpdate') {
    // Single frame result
    console.log('📹 Single frame update:', message.description);
    showLoading(false);
    displaySingleFrameResult(message.description, message.timestamp);
    
    if (autoSpeak) {
      const timeStr = Math.floor(message.timestamp);
      speakWithCallback(`At ${timeStr} seconds: ${message.description}`, () => {
        // After TTS completes, tell content script to resume video
        console.log('✅ TTS completed, sending resume command...');
        sendResumeVideoCommand();
      });
    } else {
      // If auto-speak is off, resume immediately
      sendResumeVideoCommand();
    }
    sendResponse({ success: true });
  } 
  else if (message.action === 'videoSequenceAnalyzed') {
    // Multi-frame sequence result
    console.log('🎬 Video sequence analyzed');
    showLoading(false);
    displayVideoSequence(message.summary, message.captions, message.frameCount);
    
    if (autoSpeak && !isTTSSpeaking) {
      isTTSSpeaking = true; // Prevent duplicate calls
      speakWithCallback(`Video analysis complete for ${message.frameCount} frames. ${message.summary}`, () => {
        // After TTS completes, tell content script to resume video
        console.log('✅ TTS completed, sending resume command...');
        isTTSSpeaking = false;
        sendResumeVideoCommand();
      });
    } else if (!autoSpeak) {
      // If auto-speak is off, resume immediately
      sendResumeVideoCommand();
    }
    // If already speaking, don't call resume at all
    sendResponse({ success: true });
  }
  else if (message.action === 'videoAnalysisError') {
    console.error('❌ Video error:', message.message);
    
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
  } 
  else if (message.action === 'videoAnalysisLoading') {
    console.log('⏳ Video loading:', message.message);
    showLoading(true, message.message);
    sendResponse({ success: true });
  }
  
  return false;
});

// NEW: Send resume command to content script
async function sendResumeVideoCommand() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'resumeVideo' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending resume command:', chrome.runtime.lastError);
        } else {
          console.log('✅ Resume command sent successfully');
        }
      });
    }
  } catch (error) {
    console.error('Error in sendResumeVideoCommand:', error);
  }
}

// NEW: Speak function with callback for when speech ends
function speakWithCallback(text, callback) {
  console.log('🎤 Starting TTS speech...');
  window.speechSynthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = speechRate;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  
  // Call callback when speech ends
  utterance.onend = () => {
    console.log('🔊 Speech finished, calling callback...');
    if (callback) callback();
  };
  
  // Also call callback on error to prevent hanging
  utterance.onerror = (event) => {
    console.error('❌ Speech error:', event);
    if (callback) callback();
  };
  
  console.log('🔊 Speaking text:', text.substring(0, 50) + '...');
  window.speechSynthesis.speak(utterance);
}

// Extract page content function (runs in page context)
function extractPageContent() {
  const text = document.body.innerText.slice(0, 4000);
  
  const images = Array.from(document.images)
    .filter(img => {
      const src = img.src || '';
      const isValidSize = img.width > 100 && img.height > 100;
      const isHttp = src.startsWith('http');
      return isValidSize && isHttp;
    })
    .map(img => img.src)
    .slice(0, 10);
  
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

// Auto-open on startup toggle
document.getElementById('autoOpenOnStartup').addEventListener('change', (e) => {
  autoOpenOnStartup = e.target.checked;
  chrome.storage.sync.set({ autoOpenOnStartup });
  console.log('⚙️ Auto-open on startup:', autoOpenOnStartup);
});

// NEW: Capture mode dropdown
document.getElementById('captureMode').addEventListener('change', (e) => {
  captureMode = e.target.value;
  chrome.storage.sync.set({ captureMode });
  updateVideoButtonText();
  console.log('⚙️ Capture mode changed to:', captureMode);
});

// NEW: Frame interval dropdown
document.getElementById('frameInterval').addEventListener('change', (e) => {
  frameInterval = parseInt(e.target.value);
  chrome.storage.sync.set({ frameInterval });
  updateVideoButtonText();
  console.log('⚙️ Frame interval changed to:', frameInterval + 's');
});

// Display results (for standard page analysis)
function displayResults(data) {
  let html = '';
  
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

// Display single video frame result (single-frame mode)
function displaySingleFrameResult(description, timestamp) {
  const timeFormatted = Math.floor(timestamp);
  let html = `
    <div style="margin-bottom: 15px; padding: 12px; background: #e6fffa; border-left: 3px solid #38b2ac; border-radius: 6px;">
      <p style="margin-bottom: 6px; font-weight: 600; color: #047857;">[${timeFormatted}s] Single Frame Analysis:</p>
      <p style="font-size: 14px; line-height: 1.6; color: #065f46;">${description}</p>
    </div>
  `;
  
  const outputDiv = document.getElementById('output');
  outputDiv.insertAdjacentHTML('afterbegin', html);
  outputDiv.scrollTop = 0;
}

// Display video sequence analysis (multi-frame mode)
function displayVideoSequence(summary, captions, frameCount) {
  let html = `
    <div style="margin-bottom: 20px; padding: 16px; background: linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%); border-left: 4px solid #3b82f6; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      <h3 style="color: #1e40af; margin-bottom: 12px; font-size: 16px;">🎬 Video Sequence Summary (${frameCount} frames)</h3>
      <p style="font-size: 15px; line-height: 1.7; color: #1e3a8a; font-weight: 500;">${summary}</p>
    </div>
  `;
  
  // Show individual frame captions in collapsible section
  html += `
    <details style="margin-bottom: 20px; padding: 12px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
      <summary style="cursor: pointer; font-weight: 600; color: #374151; font-size: 14px; padding: 4px;">
        📋 Individual Frame Details (${captions.length} frames)
      </summary>
      <div style="margin-top: 12px;">
  `;
  
  captions.forEach((caption, i) => {
    if (caption && !caption.startsWith('Frame') && !caption.startsWith('Error')) {
      const timestamp = i * frameInterval;
      html += `
        <div style="margin-bottom: 10px; padding: 10px; background: white; border-left: 2px solid #60a5fa; border-radius: 4px;">
          <p style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">[${timestamp}s] Frame ${i + 1}:</p>
          <p style="font-size: 13px; color: #374151; line-height: 1.5;">${caption}</p>
        </div>
      `;
    }
  });
  
  html += `
      </div>
    </details>
  `;
  
  const outputDiv = document.getElementById('output');
  outputDiv.insertAdjacentHTML('afterbegin', html);
  outputDiv.scrollTop = 0;
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

// Speak function (simple version without callback)
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

console.log('✅ ReadBuddy side panel loaded (v1.3.0 - Pause/Resume support)!');