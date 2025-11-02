// background.js - Service worker for side panel

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set up side panel on installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('✅ ReadBuddy installed! Click the extension icon to open the side panel.');
    
    // Set default settings
    chrome.storage.sync.set({
      speechRate: 1.0,
      autoSpeak: true
    });
  } else if (details.reason === 'update') {
    console.log('✅ ReadBuddy updated to version', chrome.runtime.getManifest().version);
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openSidePanel') {
    chrome.sidePanel.open({ windowId: sender.tab.windowId });
    sendResponse({ success: true });
  }
  return true;
});

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