// sidepanel.js - Side Panel Logic

let speechRate = 1.0;
let autoSpeak = true;
let lastResults = null;

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
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updatePageInfo();
  }
});

// Analyze button
document.getElementById('analyzeBtn').addEventListener('click', async () => {
  try {
    showLoading(true);
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
  }
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

// Toggle screen reader
document.getElementById('toggleReaderBtn').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) return;

    await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
    
  } catch (err) {
    console.error('Error toggling screen reader:', err);
  }
});

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

// Display results
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
function showLoading(show) {
  document.getElementById('loading').classList.toggle('active', show);
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