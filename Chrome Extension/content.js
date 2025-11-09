// content.js - MULTI-FRAME VIDEO ANALYSIS WITH PAUSE/RESUME

// Prevent multiple injections
if (window.__READBUDDY_LOADED__) {
  console.log('⚠️ ReadBuddy already loaded, skipping re-injection');
  // Don't throw error, just exit silently
} else {
  window.__READBUDDY_LOADED__ = true;

// --- Speech Queue for Image Captions ---
let speechQueue = [];
let isSpeaking = false;

// --- Video Analysis State ---
let analysisInterval = null;
let currentVideoElement = null;
let videoCheckInterval = null;

// Multi-frame capture state
let frameBuffer = [];
let captionBuffer = []; // NEW: Store captions as they arrive
let expectedFrameCount = 0; // NEW: Track how many frames we expect
let receivedFrameCount = 0; // NEW: Track how many captions received
let capturedFrameCount = 0; // NEW: Track how many frames actually captured
let captureIntervalSeconds = 5; // Default: capture every 5 seconds
let analysisWindowSeconds = 30; // Default: analyze every 30 seconds
let lastCaptureTime = 0;
let analysisStartTime = 0;
let isCapturingSequence = false;
let isVideoPaused = false; // Track if we paused the video
let wasPlayingBeforePause = false; // Track if video was playing before we paused it
let shouldContinueAnalysis = true; // Flag to control whether to continue after TTS

// SEGMENTED ANALYSIS: Track multi-segment videos
let totalVideoDuration = 0; // Total video length in seconds
let totalSegments = 0; // How many 30s segments (e.g., 4min14s = 9 segments)
let currentSegment = 0; // Which segment we're currently analyzing (1, 2, 3...)
let segmentStartTime = 0; // Video timestamp when current segment started

// Backpressure and summarization control
let inFlightCaptions = 0; // How many caption requests are in progress
const maxConcurrentCaptions = 1; // Limit to 1 to avoid backlog on slow CPUs
let summaryTriggered = false; // Ensure we only summarize once per window
let windowEndTimestamp = 0; // When 30s window ended
const postWindowGraceSeconds = 15; // Wait up to 15s for late captions (increased for slow backend)

// --- Settings (loaded from storage) ---
let captureMode = 'multi'; // 'single' or 'multi'
let frameInterval = 5; // 3, 5, or 10 seconds

// Load settings from chrome.storage
chrome.storage.sync.get(['captureMode', 'frameInterval'], (result) => {
  if (result.captureMode) captureMode = result.captureMode;
  if (result.frameInterval) {
    frameInterval = parseInt(result.frameInterval);
    captureIntervalSeconds = frameInterval;
  }
  console.log(`📋 Settings loaded: mode=${captureMode}, interval=${frameInterval}s`);
});

// --- Video Analysis Functions ---
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

function isVideoElementValid(video) {
  if (!video) return false;
  if (!document.body.contains(video)) return false;
  
  const rect = video.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (video.readyState === 0) return false;
  
  return true;
}

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

// NEW: Pause video for TTS narration
function pauseVideoForNarration(video) {
  if (!video || isVideoPaused) return;
  
  // Track if video was playing before we pause it
  wasPlayingBeforePause = !video.paused;
  
  if (wasPlayingBeforePause) {
    console.log("⏸️ Pausing video for TTS narration...");
    video.pause();
    isVideoPaused = true;
    
    // CRITICAL: Set window end timestamp when pausing (for grace period check)
    if (!windowEndTimestamp) {
      windowEndTimestamp = Date.now();
      console.log(`⏱️ Window end timestamp set: ${windowEndTimestamp}`);
    }
    
    // STOP countdown timer when video pauses for narration
    chrome.runtime.sendMessage({ 
      action: 'stopCountdown'
    });
  } else {
    console.log("ℹ️ Video was already paused, not changing state");
  }
}

// NEW: Resume video after TTS narration
function resumeVideoAfterNarration(video) {
  console.log(`🔍 resumeVideoAfterNarration called: video=${!!video}, isVideoPaused=${isVideoPaused}, currentSegment=${currentSegment}/${totalSegments}`);
  
  if (!video) {
    console.error("❌ No video element provided to resumeVideoAfterNarration");
    return;
  }
  
  if (!isVideoPaused) {
    console.warn("⚠️ Video is not paused, skipping resume");
    return;
  }
  
  // Check if there are more segments to analyze
  const hasMoreSegments = currentSegment < totalSegments;
  
  if (hasMoreSegments) {
    console.log(`🔄 Moving to next segment ${currentSegment + 1}/${totalSegments}...`);
    
    // Start next segment
    currentSegment++;
    segmentStartTime += analysisWindowSeconds; // Move forward by previous segment duration
    
    // Calculate next segment duration
    const remainingDuration = totalVideoDuration - segmentStartTime;
    analysisWindowSeconds = Math.min(remainingDuration, 30);
    expectedFrameCount = Math.floor(analysisWindowSeconds / captureIntervalSeconds);
    
    // CRITICAL: Reset ALL segment state flags to allow analysis loop to continue
    frameBuffer = [];
    captionBuffer = [];
    receivedFrameCount = 0;
    capturedFrameCount = 0;
    lastCaptureTime = 0;
    analysisStartTime = Date.now(); // Reset countdown timer
    summaryTriggered = false; // Allow next segment to trigger summarization
    windowEndTimestamp = 0; // Clear pause timestamp
    inFlightCaptions = 0; // Reset in-flight caption counter
    
    console.log(`📍 Segment ${currentSegment}/${totalSegments}: ${analysisWindowSeconds}s window, ${expectedFrameCount} frames`);
    console.log(`🔄 State reset: capturedFrameCount=${capturedFrameCount}, receivedFrameCount=${receivedFrameCount}, windowEndTimestamp=${windowEndTimestamp}, summaryTriggered=${summaryTriggered}`);
    
    // Notify sidepanel of new segment
    chrome.runtime.sendMessage({ 
      action: 'videoAnalysisStarted',
      duration: analysisWindowSeconds,
      frameCount: expectedFrameCount,
      segment: currentSegment,
      totalSegments: totalSegments,
      totalDuration: totalVideoDuration,
      message: `Segment ${currentSegment}/${totalSegments}: ${analysisWindowSeconds}s window` 
    });
    
    chrome.runtime.sendMessage({ 
      action: 'videoAnalysisLoading', 
      message: `Segment ${currentSegment}/${totalSegments}: Capturing ${expectedFrameCount} frames...` 
    });
  }
  
  // Only resume if video was playing before we paused it
  if (wasPlayingBeforePause) {
    console.log("▶️ Resuming video playback...");
    video.play().catch(e => 
      console.log("❌ Could not resume video:", e)
    );
  } else {
    console.log("ℹ️ Video was not playing before pause, not resuming playback");
  }
  
  isVideoPaused = false;
  wasPlayingBeforePause = false;
  console.log(`✅ Resume complete: isVideoPaused=${isVideoPaused}, hasMoreSegments=${hasMoreSegments}`);
  
  if (!hasMoreSegments) {
    // All segments complete
    console.log("✅ All segments analyzed. Video analysis complete!");
  }
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
  console.log(`🎬 Starting ${captureMode} mode analysis (interval: ${captureIntervalSeconds}s)`);
  
  // SEGMENTED ANALYSIS: Break video into 30s chunks
  const videoDuration = currentVideoElement.duration;
  
  // CRITICAL FIX: Assign to GLOBAL variables, don't declare new local ones!
  if (videoDuration && !isNaN(videoDuration) && videoDuration > 0) {
    totalVideoDuration = Math.floor(videoDuration);
    totalSegments = Math.ceil(totalVideoDuration / 30); // How many 30s segments (including partial)
    currentSegment = 1;
    segmentStartTime = 0;
    
    // Calculate first segment duration
    const remainingDuration = totalVideoDuration - (segmentStartTime);
    analysisWindowSeconds = Math.min(remainingDuration, 30);
    
    console.log(`📏 Video: ${totalVideoDuration}s total, ${totalSegments} segments (30s each + remainder)`);
    console.log(`📍 Segment 1/${totalSegments}: ${analysisWindowSeconds}s window`);
  } else {
    // Fallback: single 30s segment
    totalVideoDuration = 30;
    totalSegments = 1;
    currentSegment = 1;
    segmentStartTime = 0;
    analysisWindowSeconds = 30;
    console.log(`⚠️ Video duration unknown, using single 30s segment`);
  }
  
  // Reset state
  frameBuffer = [];
  captionBuffer = [];
  receivedFrameCount = 0;
  capturedFrameCount = 0;
  expectedFrameCount = Math.floor(analysisWindowSeconds / captureIntervalSeconds);
  lastCaptureTime = 0;
  analysisStartTime = Date.now(); // CHANGED: Use wall clock time (countdown timer), not video time
  isCapturingSequence = true;
  isVideoPaused = false;
  wasPlayingBeforePause = false;
  inFlightCaptions = 0;
  summaryTriggered = false;
  windowEndTimestamp = 0;
  
  console.log(`📊 Expecting ${expectedFrameCount} frames over ${analysisWindowSeconds}s (interval: ${captureIntervalSeconds}s)`); // NEW: Log expected frame count
  
  // FIXED: Send message to start countdown timer in sidepanel
  chrome.runtime.sendMessage({ 
    action: 'videoAnalysisStarted',
    duration: analysisWindowSeconds, // Send current segment duration
    frameCount: expectedFrameCount,
    segment: currentSegment,
    totalSegments: totalSegments,
    totalDuration: totalVideoDuration,
    message: `Segment ${currentSegment}/${totalSegments}: Analyzing ${analysisWindowSeconds}s window` 
  });
  
  chrome.runtime.sendMessage({ 
    action: 'videoAnalysisLoading', 
    message: `Video ${totalVideoDuration}s - Segment ${currentSegment}/${totalSegments}: Capturing ${expectedFrameCount} frames over ${analysisWindowSeconds}s` 
  });
  
  // Try to play video if paused
  if (currentVideoElement.paused) {
    currentVideoElement.play().catch(e => 
      console.log("Could not auto-play video:", e)
    );
  }
  
  // Periodic video element validation (every 5 seconds)
  videoCheckInterval = setInterval(() => {
    ensureVideoElement();
  }, 5000);
  
  // Main analysis loop
  analysisInterval = setInterval(() => {
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
    const countdownElapsed = (Date.now() - analysisStartTime) / 1000; // Elapsed time since countdown started (in seconds)
    
    // CRITICAL: Check grace period EVEN WHEN PAUSED (to trigger summarization)
    if (isVideoPaused && windowEndTimestamp && !summaryTriggered) {
      const waitedSec = (Date.now() - windowEndTimestamp) / 1000;
      const haveAll = receivedFrameCount >= expectedFrameCount;
      const graceElapsed = waitedSec >= postWindowGraceSeconds;
      
      console.log(`⏳ Grace check: paused=${isVideoPaused}, window=${!!windowEndTimestamp}, triggered=${summaryTriggered}, waited=${waitedSec.toFixed(1)}s/${postWindowGraceSeconds}s, received=${receivedFrameCount}/${expectedFrameCount}, haveAll=${haveAll}, graceElapsed=${graceElapsed}, bufferSize=${captionBuffer.length}`);
      
      if (haveAll || graceElapsed) {
        console.log(`✅ Segment ${currentSegment}/${totalSegments} complete. Received: ${receivedFrameCount}/${expectedFrameCount}. Waited: ${waitedSec.toFixed(1)}s`);
        summaryTriggered = true;
        
        chrome.runtime.sendMessage({ 
          action: 'videoAnalysisLoading', 
          message: `Segment ${currentSegment}/${totalSegments}: Summarizing ${captionBuffer.length} frames...` 
        });
        
        // Send captions for summarization (use whatever we have)
        sendCaptionsForSummarization(captionBuffer);
        
        // Check if there are more segments to analyze
        if (currentSegment < totalSegments) {
          console.log(`🔄 Next segment will start after TTS completes...`);
        } else {
          console.log("🛑 All segments analyzed. Will stop after TTS completes...");
        }
      }
      return; // Don't continue - video is paused
    }
    
    // Skip frame capture if video is paused (but grace period check above still runs)
    if (isVideoPaused) {
      return;
    }
    
    // MULTI-FRAME MODE: Capture frames at intervals
    if (captureMode === 'multi') {
      const timeSinceLastCapture = countdownElapsed - lastCaptureTime; // Based on countdown, not video time
      
      // FIXED: Capture frame at interval - REMOVED BACKPRESSURE
      // Let all frames queue up, backend processes them sequentially
      if (timeSinceLastCapture >= captureIntervalSeconds && capturedFrameCount < expectedFrameCount) {
        capturedFrameCount++; // Increment captured frame count
        console.log(`📸 Capturing frame ${capturedFrameCount}/${expectedFrameCount} at countdown ${Math.floor(countdownElapsed)}s (video: ${Math.floor(currentTime)}s)`);
        
        chrome.runtime.sendMessage({ 
          action: 'videoAnalysisLoading', 
          message: `Capturing and analyzing frame ${capturedFrameCount}/${expectedFrameCount} at ${Math.floor(countdownElapsed)}s...` 
        });
        
        // Send frame immediately for captioning (parallel processing)
        captureAndSendFrameImmediately(video, currentTime, capturedFrameCount - 1); // Pass 0-indexed frameIndex
        
        // FIXED: Use target time instead of actual time to prevent drift
        // e.g., frame 1 at 5s, frame 2 at 10s, frame 3 at 15s (not 5.2s, 10.3s, 15.1s)
        lastCaptureTime = capturedFrameCount * captureIntervalSeconds;
      }
    
      // FIXED: Increased timeout to 60s to allow all frames to be captured
      // Pause video when ALL frames captured OR 60s countdown elapsed (safety timeout)
      const safetyTimeout = 60; // 60s safety buffer for slow processing
      if (capturedFrameCount >= expectedFrameCount || countdownElapsed >= safetyTimeout) {
        // PAUSE VIDEO when all frames captured OR safety timeout
        // windowEndTimestamp is set inside pauseVideoForNarration()
        pauseVideoForNarration(video);
        
        console.log(`🎬 Analysis complete: ${capturedFrameCount}/${expectedFrameCount} frames at ${Math.floor(countdownElapsed)}s countdown. Waiting up to ${postWindowGraceSeconds}s for pending captions...`);
      }
    } 
    // SINGLE-FRAME MODE: Capture one frame at 30s countdown mark
    else {
      if (countdownElapsed >= analysisWindowSeconds) {
        console.log(`📹 Capturing single frame at countdown ${Math.floor(countdownElapsed)}s (video: ${Math.floor(currentTime)}s)`);
        
        // PAUSE VIDEO BEFORE ANALYSIS
        pauseVideoForNarration(video);
        
        chrome.runtime.sendMessage({ 
          action: 'videoAnalysisLoading', 
          message: `Capturing frame at ${Math.floor(countdownElapsed)}s...` 
        });
        
        captureFrameNonDisruptive(video, currentTime, true); // true = single mode
        // Note: Don't reset analysisStartTime here - wait for TTS completion
      }
    }
  }, 1000);
  
  console.log("✅ Video analysis loop started (pause/resume enabled)");
}

function stopVideoAnalysisLoop() {
  if (analysisInterval) {
    clearInterval(analysisInterval);
    analysisInterval = null;
    console.log("🛑 Video analysis loop stopped.");
  }
  
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
    videoCheckInterval = null;
  }
  
  // Resume video if it was paused by us
  if (isVideoPaused && currentVideoElement) {
    resumeVideoAfterNarration(currentVideoElement);
  }
  
  // Reset state
  frameBuffer = [];
  captionBuffer = []; // NEW: Reset caption buffer
  receivedFrameCount = 0; // NEW: Reset
  expectedFrameCount = 0; // NEW: Reset
  isCapturingSequence = false;
  lastCaptureTime = 0;
  analysisStartTime = 0;
  isVideoPaused = false;
  wasPlayingBeforePause = false;
}

// NON-DISRUPTIVE FRAME CAPTURE (no pausing!)
function captureFrameNonDisruptive(video, timestamp, isSingleMode = false) {
  try {
    if (!isVideoElementValid(video)) {
      throw new Error("Video element is no longer valid");
    }
    
    const rect = video.getBoundingClientRect();
    
    // Use screenshot API to capture while video plays
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
            .then(croppedFrame => {
              if (isSingleMode) {
                // Send single frame immediately to old endpoint
                sendSingleFrameToBackend(croppedFrame, timestamp);
              } else {
                // Add to buffer for batch processing
                frameBuffer.push(croppedFrame);
                console.log(`✅ Frame ${frameBuffer.length} captured and buffered`);
              }
            })
            .catch(error => {
              console.error("❌ Error cropping frame:", error);
            });
        } else {
          console.error("❌ Screenshot capture failed:", response?.error || "Unknown error");
        }
      }
    );
  } catch (error) {
    console.error("❌ Error in captureFrameNonDisruptive:", error);
  }
}

// NEW: Capture frame and send immediately for parallel processing
async function captureAndSendFrameImmediately(video, timestamp, frameIndex) {
  try {
    const rect = video.getBoundingClientRect();
    
    // Request background to capture visible tab
    chrome.runtime.sendMessage({ action: 'captureVisibleTab' }, 
      async (response) => {
        if (response && response.imageData) {
          // Crop to video area
          cropImageToVideo(response.imageData, rect)
            .then((croppedFrame) => {
              console.log(`🚀 Frame ${frameIndex + 1} captured, sending immediately for caption...`);
              
              // Send frame to backend for caption generation
              inFlightCaptions++;
              
              chrome.runtime.sendMessage({
                action: 'analyzeFrameForCaption',
                imageData: croppedFrame,
                frameIndex: frameIndex
              }, (captionResult) => {
                // Check for errors first
                if (chrome.runtime.lastError) {
                  console.error(`❌ Chrome runtime error for frame ${frameIndex + 1}:`, chrome.runtime.lastError);
                  inFlightCaptions = Math.max(0, inFlightCaptions - 1);
                  return;
                }
                
                if (captionResult && captionResult.success) {
                  const caption = captionResult.caption;
                  console.log(`✅ Caption ${frameIndex + 1} received: "${caption?.substring(0, 60)}..."`);
                  
                  // Store caption in buffer
                  captionBuffer.push(caption);
                  receivedFrameCount++;
                  
                  // FIXED: Don't send for summarization here - let analysis loop handle it
                  // This prevents double TTS narration
                  if (receivedFrameCount >= expectedFrameCount) {
                    console.log(`🎉 All ${expectedFrameCount} captions received! Waiting for analysis loop to trigger summarization...`);
                  }
                } else {
                  console.error(`❌ Failed to get caption for frame ${frameIndex + 1}:`, captionResult?.error || "No result");
                }
                inFlightCaptions = Math.max(0, inFlightCaptions - 1);
              });
            })
            .catch(error => {
              console.error(`❌ Error cropping frame ${frameIndex + 1}:`, error);
            });
        } else {
          console.error(`❌ Screenshot capture failed for frame ${frameIndex + 1}:`, response?.error || "Unknown error");
        }
      }
    );
  } catch (error) {
    console.error(`❌ Error capturing frame ${frameIndex + 1}:`, error);
  }
}

// NEW: Send all collected captions to backend for summarization
async function sendCaptionsForSummarization(captions) {
  try {
    console.log(`📤 Sending ${captions.length} captions for summarization...`);
    
    chrome.runtime.sendMessage({
      action: 'summarizeCaptions',
      captions: captions
    }, (summaryResult) => {
      if (summaryResult && summaryResult.success) {
        const summary = summaryResult.summary;
        
        console.log("✅ Video sequence summary complete");
        console.log(`📝 Summary: ${summary}`);
      
      // Speak the summary immediately (for keyboard shortcut users)
      console.log("🔊 Speaking video summary via TTS");
      
      // Create utterance with proper event handlers
      const utterance = new SpeechSynthesisUtterance(summary);
      utterance.rate = 1.1;
      utterance.lang = 'en-US';
      
      utterance.onstart = () => {
        console.log("✅ Video summary TTS started");
      };
      
      utterance.onend = () => {
        console.log("✅ Video summary TTS finished, resuming video...");
        if (currentVideoElement) {
          resumeVideoAfterNarration(currentVideoElement);
        }
      };
      
      utterance.onerror = (e) => {
        console.error("❌ TTS error during video summary:", e);
        // Resume video even if TTS fails
        if (currentVideoElement) {
          resumeVideoAfterNarration(currentVideoElement);
        }
      };
      
      speechSynthesis.speak(utterance);
      
      // Send to side panel
        chrome.runtime.sendMessage({ 
          action: 'videoSequenceAnalyzed', 
          summary: summary,
          captions: captions,
          frameCount: captions.length
        });
      
      } else {
        const errorMessage = summaryResult ? (summaryResult.error || "Unknown summarization error.") : "No response from background service.";
        
        console.error("❌ Summarization Failed:", errorMessage);
        
        // Speak error and resume video
        speak(`Analysis error: ${errorMessage}`);
        setTimeout(() => {
          if (currentVideoElement) {
            resumeVideoAfterNarration(currentVideoElement);
          }
        }, 3000);
        
        // Send error summary to sidepanel - let sidepanel handle TTS and resume
        chrome.runtime.sendMessage({ 
          action: 'videoSequenceAnalyzed', 
          summary: `Analysis error: ${errorMessage}. Moving to next segment.`,
          captions: [],
          frameCount: 0,
          isError: true
        });
      }
    });
  } catch (error) {
    console.error("❌ Error in summarization:", error);
    
    // Speak error and resume video
    speak(`Summarization error: ${error.message}`);
    setTimeout(() => {
      if (currentVideoElement) {
        resumeVideoAfterNarration(currentVideoElement);
      }
    }, 3000);
    
    // Send error summary to sidepanel - let sidepanel handle TTS and resume
    chrome.runtime.sendMessage({ 
      action: 'videoSequenceAnalyzed', 
      summary: `Summarization error: ${error.message}. Moving to next segment.`,
      captions: [],
      frameCount: 0,
      isError: true
    });
  }
}

// Crop screenshot to video area
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

// Send single frame to backend (original behavior)
async function sendSingleFrameToBackend(imageData, timestamp) {
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
        timestamp: timestamp,
        mode: 'single'
      });
      
    } else {
      const errorMessage = analysisResult ? (analysisResult.error || "Unknown AI analysis error.") : "No response from background service.";
      
      console.error("❌ AI Analysis Failed:", errorMessage);
      
      chrome.runtime.sendMessage({ 
        action: 'videoAnalysisError', 
        message: `AI Analysis Failed: ${errorMessage}` 
      });
      
      // Resume video even on error
      if (currentVideoElement) {
        resumeVideoAfterNarration(currentVideoElement);
      }
    }
  } catch (error) {
    console.error("❌ Error sending single frame:", error);
    chrome.runtime.sendMessage({ 
      action: 'videoAnalysisError', 
      message: `Communication error: ${error.message}` 
    });
    
    // Resume video even on error
    if (currentVideoElement) {
      resumeVideoAfterNarration(currentVideoElement);
    }
  }
}

// Send frame sequence to backend for batch analysis
async function sendFrameSequenceToBackend(frames) {
  try {
    console.log(`📤 Sending ${frames.length} frames to backend for analysis...`);
    
    const analysisResult = await chrome.runtime.sendMessage({
      action: 'analyzeVideoSequence', 
      frames: frames
    });
    
    if (analysisResult && analysisResult.success) {
      const { summary, individual_captions } = analysisResult.result;
      
      console.log("✅ Video sequence analysis complete");
      console.log("Summary:", summary);
      
      chrome.runtime.sendMessage({ 
        action: 'videoSequenceAnalyzed', 
        summary: summary,
        captions: individual_captions,
        frameCount: frames.length
      });
      
      // Note: Video will resume after TTS completes in sidepanel
      
    } else {
      const errorMessage = analysisResult ? (analysisResult.error || "Unknown error") : "No response from backend";
      
      console.error("❌ Video sequence analysis failed:", errorMessage);
      
      chrome.runtime.sendMessage({ 
        action: 'videoAnalysisError', 
        message: `Sequence analysis failed: ${errorMessage}` 
      });
      
      // Resume video even on error
      if (currentVideoElement) {
        resumeVideoAfterNarration(currentVideoElement);
      }
    }
  } catch (error) {
    console.error("❌ Error sending frame sequence:", error);
    chrome.runtime.sendMessage({ 
      action: 'videoAnalysisError', 
      message: `Communication error: ${error.message}` 
    });
    
    // Resume video even on error
    if (currentVideoElement) {
      resumeVideoAfterNarration(currentVideoElement);
    }
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
    case 'updateVideoSettings':
      // Update settings from side panel
      if (request.captureMode) {
        captureMode = request.captureMode;
      }
      if (request.frameInterval) {
        frameInterval = parseInt(request.frameInterval);
        captureIntervalSeconds = frameInterval;
      }
      console.log(`⚙️ Settings updated: mode=${captureMode}, interval=${frameInterval}s`);
      sendResponse({ success: true });
      break;
    case 'resumeVideo':
      // NEW: Resume video after TTS completes
      console.log("▶️ Received resumeVideo command from sidepanel");
      if (currentVideoElement) {
        resumeVideoAfterNarration(currentVideoElement);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "No video element found" });
      }
      break;
    
    // KEYBOARD SHORTCUTS
    case 'summarize_page':
      console.log("📄 Summarize page command received");
      speak("Summarizing page. Please wait.");
      summarizePage();
      sendResponse({ success: true });
      break;
    
    case 'describe_images':
      console.log("🖼️ Describe images command received");
      speak("Describing images on this page.");
      describeImages();
      sendResponse({ success: true });
      break;
    
    case 'summarize_video':
      console.log("🎬 Summarize video command received");
      speak("Summarizing video content.");
      summarizeVideo();
      sendResponse({ success: true });
      break;
    
    case 'stop_speaking':
      console.log("🔇 Stop speaking command received");
      stopSpeaking();
      sendResponse({ success: true });
      break;
    
    case 'read_all_content':
      console.log("📖 Read all content command received");
      // Trigger the screen reader's readAllContent function
      if (window.screenReader && window.screenReader.isActive) {
        window.screenReader.readAllContent();
      } else {
        speak("Please activate the screen reader first by pressing Alt A.");
      }
      sendResponse({ success: true });
      break;
    
    case 'newImageCaption':
      // Real-time image caption from streaming backend
      console.log(`🖼️ Real-time caption ${request.caption.index}/${request.caption.total}: ${request.caption.caption?.substring(0, 50)}...`);
      
      // Add caption to queue instead of speaking immediately
      const captionText = `Image ${request.caption.index}: ${request.caption.caption}`;
      addToSpeechQueue(captionText);
      
      sendResponse({ success: true });
      break;
  }
  return true;
});

// --- Keyboard Command Helper Functions ---

// Debounce mechanism to prevent multiple rapid executions
let lastCommandTime = {};
const COMMAND_COOLDOWN = 1000; // 1 second cooldown between commands

/**
 * Check if command can be executed (debounce check)
 */
function canExecuteCommand(commandName) {
  const now = Date.now();
  const lastTime = lastCommandTime[commandName] || 0;
  
  if (now - lastTime < COMMAND_COOLDOWN) {
    console.log(`⏳ Command "${commandName}" on cooldown, ignoring...`);
    return false;
  }
  
  lastCommandTime[commandName] = now;
  return true;
}

/**
 * Text-to-speech helper for keyboard commands
 */
function speak(text) {
  console.log("🔊 TTS speak() called with:", text?.substring(0, 100) + "...");
  console.log("🔊 speechSynthesis available:", typeof speechSynthesis !== 'undefined');
  console.log("🔊 speechSynthesis.speaking:", speechSynthesis.speaking);
  
  if (!text || text.trim().length === 0) {
    console.error("❌ No text to speak!");
    return;
  }
  
  // Cancel any ongoing speech first
  speechSynthesis.cancel();
  
  // Small delay to ensure cancel completes
  setTimeout(() => {
    const msg = new SpeechSynthesisUtterance(text);
    msg.rate = 1.1;
    msg.lang = 'en-US';
    msg.volume = 1.0;
    
    msg.onstart = () => console.log("✅ TTS started speaking");
    msg.onend = () => console.log("✅ TTS finished speaking");
    msg.onerror = (e) => {
      console.error("❌ TTS error:", e);
      if (e.error === 'not-allowed') {
        console.error("⚠️ TTS blocked: User interaction required. Please click on the page first, then try again.");
        // Try to show a notification as fallback
        showNotification("Please click on the page first, then press the shortcut again to enable text-to-speech.");
      }
    };
    
    speechSynthesis.speak(msg);
    console.log("🔊 TTS speak() command issued");
  }, 10);
}

/**
 * Add text to speech queue (for image captions)
 * Ensures captions are spoken sequentially without interruption
 */
function addToSpeechQueue(text) {
  console.log(`📋 Adding to speech queue: "${text.substring(0, 50)}..."`);
  speechQueue.push(text);
  
  // Start processing queue if not already speaking
  if (!isSpeaking) {
    processNextInQueue();
  }
}

/**
 * Process the next item in the speech queue
 */
function processNextInQueue() {
  if (speechQueue.length === 0) {
    isSpeaking = false;
    console.log("✅ Speech queue empty");
    return;
  }
  
  isSpeaking = true;
  const text = speechQueue.shift(); // Get first item from queue
  
  console.log(`🔊 Speaking from queue: "${text.substring(0, 50)}..." (${speechQueue.length} remaining)`);
  
  if (!text || text.trim().length === 0) {
    processNextInQueue(); // Skip empty and continue
    return;
  }
  
  // Cancel any ongoing speech first
  speechSynthesis.cancel();
  
  // Small delay to ensure cancel completes
  setTimeout(() => {
    const msg = new SpeechSynthesisUtterance(text);
    msg.rate = 1.1;
    msg.lang = 'en-US';
    msg.volume = 1.0;
    
    msg.onstart = () => console.log("✅ Queue TTS started");
    
    msg.onend = () => {
      console.log("✅ Queue TTS finished");
      // Process next item in queue after current one finishes
      setTimeout(() => {
        processNextInQueue();
      }, 100); // Small delay between captions
    };
    
    msg.onerror = (e) => {
      console.error("❌ Queue TTS error:", e);
      // Continue with next item even if there's an error
      setTimeout(() => {
        processNextInQueue();
      }, 100);
    };
    
    speechSynthesis.speak(msg);
    console.log("🔊 Queue TTS command issued");
  }, 10);
}

/**
 * Clear the speech queue (for stopping all captions)
 */
function clearSpeechQueue() {
  console.log("🛑 Clearing speech queue");
  speechQueue = [];
  isSpeaking = false;
  speechSynthesis.cancel();
}

/**
 * Show a visual notification when TTS is blocked
 */
function showNotification(message) {
  // Create a simple notification div
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #ff6b6b;
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 999999;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    max-width: 300px;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Remove after 5 seconds
  setTimeout(() => {
    notification.style.transition = 'opacity 0.5s';
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 500);
  }, 5000);
}

/**
 * Stop all text-to-speech
 */
function stopSpeaking() {
  console.log("🔇 Stopping all speech...");
  speechSynthesis.cancel(); // Stop all ongoing speech
  console.log("✅ Speech stopped");
}

/**
 * Summarize the current page content
 */
async function summarizePage() {
  // Extract main content from page
  const pageText = document.body.innerText || document.body.textContent;
  const truncatedText = pageText.substring(0, 5000); // Limit to first 5000 chars
  
  console.log("📄 Extracting page content:", truncatedText.length, "characters");
  
  if (!truncatedText.trim()) {
    speak("No text found on this page.");
    return;
  }
  
  try {
    speak("Analyzing page content. Please wait.");
    
    // Send to background.js instead of direct fetch (to avoid CORS)
    chrome.runtime.sendMessage({
      action: 'analyzePage',
      text: truncatedText
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("❌ Message error:", chrome.runtime.lastError);
        speak("Failed to communicate with extension.");
        return;
      }
      
      if (!response || !response.success) {
        console.error("❌ Backend error:", response?.error);
        speak("Failed to summarize page. Make sure the backend server is running.");
        return;
      }
      
      console.log("✅ Page summarization result:", response.result);
      
      // Speak the summary - backend returns 'summaries' array, not 'text_summary'
      if (response.result.summaries && response.result.summaries.length > 0) {
        const summary = response.result.summaries.join(" ");
        console.log("📢 Speaking summary:", summary);
        speak(summary);
      } else {
        speak("Could not generate summary.");
      }
    });
    
  } catch (error) {
    console.error("❌ Page summarization error:", error);
    speak("Failed to summarize page.");
  }
}

/**
 * Describe all images on the current page
 * Uses the EXACT same logic as the "Analyze Page" button in sidepanel
 */
async function describeImages() {
  console.log("🖼️ Starting image analysis using EXACT sidepanel button logic...");
  
  // EXACT SAME extraction as sidepanel's analyzeBtn (lines 518-544)
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
  
  console.log(`� Extracted: ${text.length} chars text, ${images.length} images, ${videos.length} videos`);
  
  if (images.length === 0) {
    speak("No valid images found to describe. Images must be larger than 100 by 100 pixels.");
    return;
  }
  
  try {
    speak(`Analyzing ${images.length} images. Captions will be spoken as they are generated.`);
    
    // Send to background.js to call /analyze-page (EXACT SAME as sidepanel button)
    chrome.runtime.sendMessage({
      action: 'analyzeFullPage',  // Use the FULL page analysis endpoint
      text: text,
      images: images,
      videos: videos.slice(0, 5)
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("❌ Message error:", chrome.runtime.lastError);
        speak("Failed to communicate with extension.");
        return;
      }
      
      if (!response || !response.success) {
        console.error("❌ Backend error:", response?.error);
        speak("Failed to describe images. Make sure the backend server is running.");
        return;
      }
      
      console.log("✅ Full page analysis result:", response.result);
      
      // Don't speak all captions at once - they're already being spoken in real-time
      // Just announce completion
      const imageCount = response.result.count?.images_processed || 0;
      if (imageCount > 0) {
        speak(`Analysis complete. Described ${imageCount} images.`);
      } else {
        speak("Could not describe any images.");
      }
    });
    
  } catch (error) {
    console.error("❌ Image description error:", error);
    speak("Failed to describe images.");
  }
}

/**
 * Summarize video content on the page
 */
function summarizeVideo() {
  if (!canExecuteCommand('summarize_video')) return;
  
  const video = findViableVideo();
  
  if (!video) {
    speak("No video found on this page.");
    return;
  }
  
  console.log("🎬 Video found, starting analysis...");
  
  // Use existing video analysis functionality
  startVideoAnalysisLoop();
  
  setTimeout(() => {
    speak("Video analysis started. The video will be analyzed and summarized automatically.");
  }, 1000);
}

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
    
    // Use background.js to handle streaming response
    chrome.runtime.sendMessage({
      action: 'analyzeFullPage',
      text: text,
      images: images,
      videos: videos.slice(0, 5)
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.error("❌ Message error:", chrome.runtime.lastError);
        self.speak("Failed to communicate with extension.");
        return;
      }
      
      if (!response || !response.success) {
        console.error("❌ Backend error:", response?.error);
        self.speak("Error analyzing page. Make sure the backend server is running.");
        return;
      }
      
      self.speakAnalysisResults(response.result);
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

console.log('✅ ReadBuddy loaded! Press Ctrl+Alt+R or click the bubble button (v1.3.0 - Pause/Resume)');

// Initialize TTS on first user interaction to get permission
let ttsInitialized = false;
function initializeTTS() {
  if (ttsInitialized) return;
  
  console.log('🎤 Initializing TTS permissions...');
  const utterance = new SpeechSynthesisUtterance('');
  utterance.volume = 0; // Silent
  speechSynthesis.speak(utterance);
  ttsInitialized = true;
  console.log('✅ TTS initialized');
  
  // Remove listeners after first initialization
  document.removeEventListener('click', initializeTTS);
  document.removeEventListener('keydown', initializeTTS);
}

// Listen for ANY user interaction to initialize TTS
document.addEventListener('click', initializeTTS, { once: true });
document.addEventListener('keydown', initializeTTS, { once: true });

} // End of __READBUDDY_LOADED__ guard