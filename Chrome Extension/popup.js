// Initialize TTS settings
let speechRate = 1.0;
let autoSpeak = true;

// Load saved settings
chrome.storage.sync.get(['speechRate', 'autoSpeak'], (result) => {
  speechRate = result.speechRate || 1.0;
  autoSpeak = result.autoSpeak !== false;
  
  if (document.getElementById('speedSlider')) {
    document.getElementById('speedSlider').value = speechRate;
    document.getElementById('speedValue').textContent = speechRate.toFixed(1) + 'x';
  }
  if (document.getElementById('autoSpeak')) {
    document.getElementById('autoSpeak').checked = autoSpeak;
  }
});

// Main summarize button
document.getElementById("summarizeBtn").addEventListener("click", async () => {
  try {
    // Show loading state
    const outputDiv = document.getElementById("output");
    outputDiv.innerHTML = "⏳ Analyzing page... Please wait...";
    
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Extract text + images + videos from the active webpage
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        func: () => {
          const text = document.body.innerText.slice(0, 4000);
          
          // Get images
          const images = Array.from(document.images)
            .filter(img => {
              const src = img.src || "";
              const isValidSize = img.width > 100 && img.height > 100;
              const isHttp = src.startsWith("http");
              return isValidSize && isHttp;
            })
            .map(img => img.src)
            .slice(0, 10);
          
          // Get videos (including YouTube embeds)
          const videos = [];
          
          // Get video elements
          document.querySelectorAll('video').forEach(v => {
            if (v.src || v.currentSrc) {
              videos.push(v.src || v.currentSrc);
            }
          });
          
          // Get YouTube and Vimeo iframes
          document.querySelectorAll('iframe').forEach(iframe => {
            const src = iframe.src || '';
            if (src.includes('youtube.com') || src.includes('youtu.be') || src.includes('vimeo.com')) {
              videos.push(src);
            }
          });
          
          return { text, images, videos: videos.slice(0, 5) };
        },
      },
      async (results) => {
        if (!results || !results[0] || !results[0].result) {
          outputDiv.innerText = "⚠️ Could not extract page content.";
          return;
        }
        
        const { text, images, videos } = results[0].result;
        console.log("🧩 Text length:", text.length);
        console.log("🖼️ Found images:", images.length);
        console.log("🎬 Found videos:", videos.length);
        
        // Send content to backend
        const response = await fetch("http://127.0.0.1:8000/analyze-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, images, videos }),
        });
        
        const data = await response.json();
        console.log("✅ Backend Response:", data);
        
        // Display results
        displayResults(data);
        
        // Auto-speak if enabled
        if (autoSpeak) {
          speakResults(data);
        }
      }
    );
  } catch (err) {
    document.getElementById("output").innerHTML = `<p style="color: #dc2626;">❌ Error: ${err.message}</p>`;
    console.error("❌ Extension Error:", err);
  }
});

function displayResults(data) {
  let output = '';
  
  // Text Summary
  output += '<div style="margin-bottom: 20px;">';
  output += '<h3 style="color: #2563eb; margin-bottom: 10px;">📝 Text Summary</h3>';
  
  if (data.summaries && data.summaries.length > 0) {
    data.summaries.forEach((summary, i) => {
      output += `<p style="margin-bottom: 12px; padding: 10px; background: #f3f4f6; border-radius: 6px;">${summary}</p>`;
    });
  } else {
    output += '<p style="color: #dc2626;">⚠️ No summary generated.</p>';
  }
  output += '</div>';
  
  // Images
  output += '<div style="margin-bottom: 20px;">';
  output += '<h3 style="color: #2563eb; margin-bottom: 10px;">🖼️ Image Descriptions</h3>';
  
  if (data.image_descriptions && data.image_descriptions.length > 0) {
    data.image_descriptions.forEach((item, i) => {
      if (typeof item === 'string') {
        output += `<p style="margin-bottom: 8px;">• ${item}</p>`;
      } else if (item.caption) {
        output += `<div style="margin-bottom: 15px; padding: 10px; background: #f9fafb; border-left: 3px solid #10b981; border-radius: 4px;">`;
        output += `<p style="margin-bottom: 4px;"><strong>Image ${i + 1}:</strong> ${item.caption}</p>`;
        if (item.size) {
          output += `<p style="font-size: 11px; color: #6b7280;">Size: ${item.size}</p>`;
        }
        output += `</div>`;
      }
    });
  } else {
    output += '<p style="color: #9ca3af;">No images found.</p>';
  }
  output += '</div>';
  
  // Videos
  if (data.video_descriptions && data.video_descriptions.length > 0 && 
      data.video_descriptions[0].type !== 'none') {
    output += '<div style="margin-bottom: 20px;">';
    output += '<h3 style="color: #2563eb; margin-bottom: 10px;">🎬 Video Descriptions</h3>';
    
    data.video_descriptions.forEach((item, i) => {
      if (item.description && item.type !== 'none') {
        output += `<div style="margin-bottom: 15px; padding: 10px; background: #fef3c7; border-left: 3px solid #f59e0b; border-radius: 4px;">`;
        output += `<p style="margin-bottom: 4px;"><strong>Video ${i + 1}:</strong> ${item.description}</p>`;
        if (item.method) {
          const methodLabel = item.method === 'transcript' ? '📝 From transcript' : 
                              item.method === 'metadata' ? '📊 Basic info' : 
                              '🔍 Detected';
          output += `<p style="font-size: 11px; color: #92400e;">${methodLabel}</p>`;
        }
        output += `</div>`;
      }
    });
    output += '</div>';
  }
  
  // Stats
  if (data.count) {
    output += `<p style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">`;
    output += `📊 Processed: ${data.count.images_processed} images`;
    if (data.count.videos_processed > 0) {
      output += `, ${data.count.videos_processed} videos`;
    }
    output += `</p>`;
  }
  
  const outputDiv = document.getElementById("output");
  outputDiv.innerHTML = output;
  outputDiv.style.whiteSpace = "normal";
  outputDiv.style.lineHeight = "1.6";
}

function speakResults(data) {
  let textToSpeak = "";
  
  // Speak summaries
  if (data.summaries && data.summaries.length > 0) {
    textToSpeak += "Page summary: " + data.summaries.join(". ") + ". ";
  }
  
  // Speak image descriptions
  if (data.image_descriptions && data.image_descriptions.length > 0) {
    const imageCount = data.image_descriptions.filter(item => 
      (typeof item === 'string' && !item.includes("No valid")) || 
      (typeof item === 'object' && item.caption)
    ).length;
    
    if (imageCount > 0) {
      textToSpeak += `Found ${imageCount} images. `;
      data.image_descriptions.forEach((item, i) => {
        const caption = typeof item === 'string' ? item : item.caption;
        if (caption && !caption.includes("No valid")) {
          textToSpeak += `Image ${i + 1}: ${caption}. `;
        }
      });
    }
  }
  
  // Speak video descriptions
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

function speak(text) {
  // Stop any ongoing speech
  window.speechSynthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = speechRate;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  
  window.speechSynthesis.speak(utterance);
}

// Speed control
if (document.getElementById('speedSlider')) {
  document.getElementById('speedSlider').addEventListener('input', (e) => {
    speechRate = parseFloat(e.target.value);
    document.getElementById('speedValue').textContent = speechRate.toFixed(1) + 'x';
    chrome.storage.sync.set({ speechRate });
  });
}

// Auto-speak toggle
if (document.getElementById('autoSpeak')) {
  document.getElementById('autoSpeak').addEventListener('change', (e) => {
    autoSpeak = e.target.checked;
    chrome.storage.sync.set({ autoSpeak });
  });
}

// Stop speaking button
if (document.getElementById('stopSpeaking')) {
  document.getElementById('stopSpeaking').addEventListener('click', () => {
    window.speechSynthesis.cancel();
  });
}

// Read aloud button (manual trigger)
if (document.getElementById('readAloud')) {
  document.getElementById('readAloud').addEventListener('click', () => {
    const outputDiv = document.getElementById("output");
    const text = outputDiv.innerText || "No content to read.";
    speak(text);
  });
}