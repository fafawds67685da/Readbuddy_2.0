// screenreader.js - Comprehensive Screen Reader Mode for ReadBuddy
// Provides voice-guided navigation and announces browser actions

console.log('🚀 SCREENREADER.JS LOADED!');

// Check if we're on a chrome:// page (but NOT our own extension pages)
const isRestrictedPage = window.location.href.startsWith('chrome://') && !window.location.href.includes('newtab.html');

if (isRestrictedPage) {
  console.log('⚠️ Screen reader cannot run on chrome:// pages due to Chrome security restrictions');
  console.log('📝 Please navigate to a regular webpage (like google.com) to use the screen reader');
  // Don't set up the screen reader on restricted chrome:// pages
} else {
  
// Set up keyboard listener IMMEDIATELY (before class definition)
console.log('🎯 Setting up Alt+A keyboard listener...');

// Track AltGraph state (for keyboards that use Ctrl+AltGraph instead of Alt)
let altGraphPressed = false;
let lastAltGraphTime = 0;

// Helper function to detect Alt+Key combinations on different keyboard layouts
// Make it global so the class can use it too
window.detectAltKey = function(event, keyCode, possibleChars = []) {
  const key = event.key.toLowerCase();
  const code = event.code;
  const now = Date.now();
  
  // Standard Alt key detection
  if (event.altKey && !event.ctrlKey && !event.shiftKey && key === keyCode.toLowerCase()) {
    return true;
  }
  
  // AltGraph detection (European keyboards) - check code and special characters
  if (code === `Key${keyCode.toUpperCase()}` && !event.shiftKey) {
    // Check if key matches any of the special characters produced by AltGraph
    if (possibleChars.includes(key)) {
      return true;
    }
    
    // Also check if AltGraph was pressed recently (within 100ms)
    if (altGraphPressed && (now - lastAltGraphTime) < 100) {
      return true;
    }
  }
  
  return false;
};

// Track AltGraph key presses
document.addEventListener('keydown', (event) => {
  if (event.code === 'AltRight' || event.key === 'AltGraph') {
    altGraphPressed = true;
    lastAltGraphTime = Date.now();
  }
}, true);

document.addEventListener('keyup', (event) => {
  if (event.code === 'AltRight' || event.key === 'AltGraph') {
    // Keep altGraphPressed true for a short time
    setTimeout(() => {
      altGraphPressed = false;
    }, 50);
  }
}, true);

document.addEventListener('keydown', (event) => {
  console.log('🔍 Key pressed:', {
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey
  });
  
  // Check for Alt+A (toggle screen reader)
  if (window.detectAltKey(event, 'a', ['ā', 'á', 'à', 'â', 'ã', 'ä', 'å'])) {
    event.preventDefault();
    event.stopPropagation();
    console.log('⌨️ Alt+A detected - Toggling screen reader');
    if (window.screenReader) {
      window.screenReader.toggle();
    } else {
      console.error('❌ screenReader not initialized yet!');
    }
  }
  
  // Check for Alt+W (focus search box - works globally)
  if (window.detectAltKey(event, 'w', ['ẉ', 'ŵ', 'ẃ', 'ẁ'])) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    console.log('⌨️ Alt+W detected - Focusing search box');
    
    // Try multiple selectors to find the search box (priority order)
    // IMPORTANT: Skip hidden inputs!
    const searchBox = document.querySelector('#searchBox') || // Our custom page
                     document.querySelector('textarea[name="q"]') || // Google (uses textarea!)
                     document.querySelector('#APjFqb') || // Google's search textarea ID
                     document.querySelector('textarea.gLFyf') || // Google's textarea class
                     document.querySelector('input[name="q"]:not([type="hidden"])') || // YouTube, other sites
                     document.querySelector('input[aria-label*="Search" i]:not([type="hidden"])') || // Accessibility label
                     document.querySelector('input[aria-label*="search" i]:not([type="hidden"])') ||
                     document.querySelector('input[placeholder*="Search" i]:not([type="hidden"])') || // Placeholder text
                     document.querySelector('input[placeholder*="search" i]:not([type="hidden"])') ||
                     document.querySelector('input[type="search"]') || // Search type inputs
                     document.querySelector('.search-box') ||
                     document.querySelector('input[type="text"]:not([type="hidden"])') || // Any text input
                     document.querySelector('input[role="combobox"]:not([type="hidden"])') || // Search dropdowns
                     document.querySelector('textarea'); // Any textarea (last resort)
    
    console.log('🔍 Search box found:', searchBox);
    
    if (searchBox) {
      // Check if input is actually hidden (only check type and display, skip visibility)
      const isHidden = searchBox.type === 'hidden';
      const computedStyle = window.getComputedStyle(searchBox);
      const isDisplayNone = computedStyle.display === 'none';
      
      if (isHidden || isDisplayNone) {
        console.log('⚠️ Found input is hidden, trying next selector...', {
          type: searchBox.type,
          display: computedStyle.display
        });
        // Don't return yet - this might be a hidden input, try to find another one
      }
      
      // Try to focus anyway (Google might show it on focus)
      try {
        searchBox.focus();
        
        // Move cursor to end of text (so user can continue typing)
        const textLength = searchBox.value.length;
        searchBox.setSelectionRange(textLength, textLength);
        
        console.log('✅ Search box focused, cursor at end');
        
        if (window.screenReader && window.screenReader.isActive) {
          window.screenReader.speak('Search box focused. Ready to type.');
        }
      } catch (error) {
        console.log('❌ Failed to focus search box:', error.message);
        if (window.screenReader && window.screenReader.isActive) {
          window.screenReader.speak('Cannot focus search box on this page.');
        }
      }
    } else {
      console.log('❌ No search box found on this page');
      if (window.screenReader && window.screenReader.isActive) {
        window.screenReader.speak('No search box found on this page.');
      }
    }
    return;
  }
}, true);
console.log('✅ Keyboard listener attached to document');

class ScreenReader {
  constructor() {
    this.isActive = false;
    this.isSpeaking = false;
    this.currentUtterance = null;
    this.speechRate = 1.0;
    this.volume = 1.0;
    
    // Link navigation state
    this.currentLinkIndex = -1;
    this.pageLinks = [];
    this.currentHighlight = null;
    
    // Initialize on first user interaction
    this.initialized = false;
    
    console.log('🎤 ScreenReader initialized');
  }
  
  // Initialize TTS permissions (requires user gesture)
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Silent utterance to get permission
      const utterance = new SpeechSynthesisUtterance('');
      utterance.volume = 0;
      window.speechSynthesis.speak(utterance);
      
      this.initialized = true;
      console.log('✅ ScreenReader TTS initialized');
    } catch (error) {
      console.error('❌ TTS initialization failed:', error);
    }
  }
  
  // Activate screen reader mode
  async activate() {
    if (this.isActive) {
      this.speak('Screen reader already active.');
      return;
    }
    
    this.isActive = true;
    await this.initialize();
    
    // Store state in chrome.storage
    chrome.storage.local.set({ screenReaderActive: true });
    
    // Welcome message with options
    const welcomeMessage = `Welcome to ReadBuddy Screen Reader. 
      You are on ${this.getPageTitle()}. 
      Press Alt 1 to summarize the text on this page.
      Press Down Arrow to navigate to links on this page.
      Press Alt H for help to hear all available keyboard shortcuts.`;
    
    this.speak(welcomeMessage);
    
    // Collect all links on the page
    this.collectPageLinks();
    
    // Add visual indicator
    this.showVisualIndicator(true);
    
    // Set up keyboard listeners
    this.attachKeyboardListeners();
    
    console.log('✅ Screen reader activated');
  }
  
  // Deactivate screen reader mode
  deactivate() {
    if (!this.isActive) {
      this.speak('Screen reader already inactive.');
      return;
    }
    
    this.isActive = false;
    chrome.storage.local.set({ screenReaderActive: false });
    
    this.speak('Screen reader deactivated. Goodbye!');
    this.stopSpeaking();
    
    // Remove visual indicator
    this.showVisualIndicator(false);
    
    // Remove highlight if any
    if (this.currentHighlight) {
      this.currentHighlight.remove();
      this.currentHighlight = null;
    }
    
    // Reset link navigation state
    this.currentLinkIndex = -1;
    this.pageLinks = [];
    
    // Remove keyboard listeners
    this.removeKeyboardListeners();
    
    console.log('🔇 Screen reader deactivated');
  }
  
  // Toggle screen reader on/off
  toggle() {
    if (this.isActive) {
      this.deactivate();
    } else {
      this.activate();
    }
  }
  
  // Get page title
  getPageTitle() {
    return document.title || 'Untitled page';
  }
  
  // Get page URL domain
  getPageDomain() {
    try {
      const url = new URL(window.location.href);
      return url.hostname;
    } catch (error) {
      return 'unknown domain';
    }
  }
  
  // Speak text using TTS
  speak(text, options = {}) {
    // Stop current speech
    window.speechSynthesis.cancel();
    
    if (!text || text.trim().length === 0) {
      console.log('⚠️ No text to speak');
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate || this.speechRate;
    utterance.volume = options.volume || this.volume;
    utterance.lang = options.lang || 'en-US';
    
    utterance.onstart = () => {
      this.isSpeaking = true;
      console.log('🔊 Speaking:', text.substring(0, 50) + '...');
    };
    
    utterance.onend = () => {
      this.isSpeaking = false;
      this.currentUtterance = null;
      console.log('✅ Finished speaking');
    };
    
    utterance.onerror = (event) => {
      this.isSpeaking = false;
      if (event.error === 'not-allowed') {
        console.error('❌ TTS not allowed - user interaction required');
        this.showNotification('Please click anywhere on the page first');
      } else {
        console.error('❌ TTS error:', event.error);
      }
    };
    
    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }
  
  // Stop speaking
  stopSpeaking() {
    window.speechSynthesis.cancel();
    this.isSpeaking = false;
    this.currentUtterance = null;
    console.log('🔇 Speech stopped');
  }
  
  // Show help menu
  showHelp() {
    const helpMessage = `ReadBuddy Screen Reader Help. 
      Available keyboard shortcuts: 
      Press Alt H for this help menu.
      Press Alt W to focus the search box.
      Press Alt A to toggle screen reader on or off.
      Press Down Arrow to navigate to the next link.
      Press Up Arrow to navigate to the previous link.
      Press Enter on a link to open it.
      Press Alt 1 to summarize the page.
      Press Alt 2 to describe all images on the page.
      Press Alt 3 to analyze and summarize video content.
      Press Alt 4 to stop all speech.`;
    
    this.speak(helpMessage, { rate: 0.9 });
  }

  // Collect all links on the page
  collectPageLinks() {
    const links = [];
    const allLinks = document.querySelectorAll('a[href]');
    
    allLinks.forEach((link) => {
      // Skip hidden links
      const style = window.getComputedStyle(link);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return;
      }
      
      // Skip links with no visible area
      const rect = link.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return;
      }
      
      // Skip very small links (likely decorative)
      if (rect.width < 10 && rect.height < 10) {
        return;
      }
      
      // Get link text and URL
      const linkText = link.textContent.trim() || link.getAttribute('aria-label') || 'Unnamed link';
      const href = link.href;
      
      // Skip empty links
      if (!linkText || linkText.length === 0) {
        return;
      }
      
      // Get destination info
      let destination = '';
      try {
        const url = new URL(href);
        destination = url.hostname;
        
        // Add path info if meaningful
        if (url.pathname && url.pathname !== '/' && url.pathname.length > 1) {
          const pathParts = url.pathname.split('/').filter(p => p.length > 0);
          if (pathParts.length > 0) {
            destination += ', ' + pathParts[pathParts.length - 1].replace(/-|_/g, ' ');
          }
        }
      } catch (e) {
        destination = 'unknown destination';
      }
      
      links.push({
        element: link,
        text: linkText,
        destination: destination,
        href: href
      });
    });
    
    this.pageLinks = links;
    console.log(`🔗 Collected ${links.length} links on this page`);
    return links;
  }

  // Navigate to next link
  navigateToNextLink() {
    if (this.pageLinks.length === 0) {
      this.collectPageLinks();
    }
    
    if (this.pageLinks.length === 0) {
      this.speak('No links found on this page.');
      return;
    }
    
    this.currentLinkIndex++;
    if (this.currentLinkIndex >= this.pageLinks.length) {
      this.currentLinkIndex = 0;
      this.speak('Reached end of links. Wrapping to first link.');
    }
    
    this.announceCurrentLink();
  }

  // Navigate to previous link
  navigateToPreviousLink() {
    if (this.pageLinks.length === 0) {
      this.collectPageLinks();
    }
    
    if (this.pageLinks.length === 0) {
      this.speak('No links found on this page.');
      return;
    }
    
    this.currentLinkIndex--;
    if (this.currentLinkIndex < 0) {
      this.currentLinkIndex = this.pageLinks.length - 1;
      this.speak('Reached beginning of links. Wrapping to last link.');
    }
    
    this.announceCurrentLink();
  }

  // Announce current link
  announceCurrentLink() {
    if (this.currentLinkIndex < 0 || this.currentLinkIndex >= this.pageLinks.length) {
      return;
    }
    
    const link = this.pageLinks[this.currentLinkIndex];
    
    // Create announcement
    const announcement = `Link ${this.currentLinkIndex + 1} of ${this.pageLinks.length}. ${link.text}. Directs to ${link.destination}`;
    
    // Highlight the link
    this.highlightLink(link.element);
    
    // Scroll link into view
    link.element.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center' 
    });
    
    // Speak the announcement
    this.speak(announcement);
    
    console.log(`📍 ${announcement}`);
  }

  // Highlight current link
  highlightLink(element) {
    // Remove previous highlight
    if (this.currentHighlight) {
      this.currentHighlight.remove();
    }
    
    // Create highlight overlay
    const rect = element.getBoundingClientRect();
    const highlight = document.createElement('div');
    highlight.id = 'readbuddy-link-highlight';
    highlight.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 3px solid #ff6600;
      background-color: rgba(255, 102, 0, 0.15);
      pointer-events: none;
      z-index: 999999;
      box-sizing: border-box;
      border-radius: 4px;
      transition: all 0.2s ease;
      box-shadow: 0 0 10px rgba(255, 102, 0, 0.5);
    `;
    
    document.body.appendChild(highlight);
    this.currentHighlight = highlight;
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (this.currentHighlight === highlight) {
        highlight.remove();
        this.currentHighlight = null;
      }
    }, 5000);
  }

  // Activate current link
  activateCurrentLink() {
    if (this.currentLinkIndex < 0 || this.currentLinkIndex >= this.pageLinks.length) {
      this.speak('No link selected. Please use arrow keys to navigate to a link first.');
      return;
    }
    
    const link = this.pageLinks[this.currentLinkIndex];
    this.speak(`Opening link: ${link.text}`);
    
    // Small delay to let the announcement play
    setTimeout(() => {
      link.element.click();
    }, 800);
  }
  
  // Announce browser action
  announceBrowserAction(action) {
    const messages = {
      'new-tab': 'Opening new tab',
      'close-tab': 'Closing current tab',
      'refresh': 'Refreshing page',
      'back': 'Navigating back',
      'forward': 'Navigating forward',
      'bookmark': 'Bookmarking page',
      'find': 'Opening find dialog',
      'print': 'Opening print dialog',
      'save': 'Saving page',
      'zoom-in': 'Zooming in',
      'zoom-out': 'Zooming out',
      'zoom-reset': 'Resetting zoom',
      'fullscreen': 'Entering fullscreen',
      'exit-fullscreen': 'Exiting fullscreen'
    };
    
    const message = messages[action] || `Action: ${action}`;
    this.speak(message, { rate: 1.2 }); // Faster for quick feedback
  }
  
  // Find all navigable elements on page
  findNavigableElements() {
    this.navigableElements = [];
    
    // Headings
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(el => {
      this.navigableElements.push({
        element: el,
        type: 'heading',
        level: el.tagName,
        text: el.textContent.trim()
      });
    });
    
    // Links
    const links = document.querySelectorAll('a[href]');
    links.forEach(el => {
      this.navigableElements.push({
        element: el,
        type: 'link',
        text: el.textContent.trim() || el.href
      });
    });
    
    // Buttons
    const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
    buttons.forEach(el => {
      this.navigableElements.push({
        element: el,
        type: 'button',
        text: el.textContent.trim() || el.value || 'Button'
      });
    });
    
    // Form inputs
    const inputs = document.querySelectorAll('input:not([type="button"]):not([type="submit"]), textarea, select');
    inputs.forEach(el => {
      const label = this.getInputLabel(el);
      this.navigableElements.push({
        element: el,
        type: 'input',
        inputType: el.type || 'text',
        text: label || el.placeholder || 'Input field'
      });
    });
    
    // Images
    const images = document.querySelectorAll('img');
    images.forEach(el => {
      this.navigableElements.push({
        element: el,
        type: 'image',
        text: el.alt || el.title || 'Image'
      });
    });
    
    console.log(`📋 Found ${this.navigableElements.length} navigable elements`);
    return this.navigableElements;
  }
  
  // Get label for input element
  getInputLabel(input) {
    // Try to find associated label
    const id = input.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent.trim();
    }
    
    // Check if input is inside a label
    const parentLabel = input.closest('label');
    if (parentLabel) return parentLabel.textContent.trim();
    
    // Check aria-label
    if (input.getAttribute('aria-label')) {
      return input.getAttribute('aria-label');
    }
    
    return null;
  }
  
  // Navigate to next element
  navigateNext() {
    if (this.navigableElements.length === 0) {
      this.findNavigableElements();
    }
    
    if (this.navigableElements.length === 0) {
      this.speak('No navigable elements found on this page.');
      return;
    }
    
    this.currentElementIndex = (this.currentElementIndex + 1) % this.navigableElements.length;
    this.announceCurrentElement();
  }
  
  // Navigate to previous element
  navigatePrevious() {
    if (this.navigableElements.length === 0) {
      this.findNavigableElements();
    }
    
    if (this.navigableElements.length === 0) {
      this.speak('No navigable elements found on this page.');
      return;
    }
    
    this.currentElementIndex = (this.currentElementIndex - 1 + this.navigableElements.length) % this.navigableElements.length;
    this.announceCurrentElement();
  }
  
  // Navigate to next element of specific type
  navigateToNextType(type) {
    if (this.navigableElements.length === 0) {
      this.findNavigableElements();
    }
    
    const filteredElements = this.navigableElements.filter(el => el.type === type);
    
    if (filteredElements.length === 0) {
      this.speak(`No ${type}s found on this page.`);
      return;
    }
    
    // Find next element of this type after current position
    let found = false;
    for (let i = this.currentElementIndex + 1; i < this.navigableElements.length; i++) {
      if (this.navigableElements[i].type === type) {
        this.currentElementIndex = i;
        found = true;
        break;
      }
    }
    
    // If not found, wrap to beginning
    if (!found) {
      for (let i = 0; i <= this.currentElementIndex; i++) {
        if (this.navigableElements[i].type === type) {
          this.currentElementIndex = i;
          found = true;
          break;
        }
      }
    }
    
    if (found) {
      this.announceCurrentElement();
    } else {
      this.speak(`No more ${type}s found.`);
    }
  }
  
  // Announce current element
  announceCurrentElement() {
    const current = this.navigableElements[this.currentElementIndex];
    if (!current) return;
    
    // Scroll element into view
    current.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Highlight element visually
    this.highlightElement(current.element);
    
    // Build announcement
    let announcement = '';
    
    switch (current.type) {
      case 'heading':
        announcement = `${current.level}, ${current.text}`;
        break;
      case 'link':
        announcement = `Link, ${current.text}`;
        break;
      case 'button':
        announcement = `Button, ${current.text}`;
        break;
      case 'input':
        announcement = `${current.inputType} input, ${current.text}`;
        break;
      case 'image':
        announcement = `Image, ${current.text}`;
        break;
      default:
        announcement = current.text;
    }
    
    this.speak(announcement);
  }
  
  // Highlight element visually
  highlightElement(element) {
    // Remove previous highlights
    const previousHighlights = document.querySelectorAll('.screenreader-highlight');
    previousHighlights.forEach(el => el.classList.remove('screenreader-highlight'));
    
    // Add highlight to current element
    element.classList.add('screenreader-highlight');
    
    // Remove highlight after 3 seconds
    setTimeout(() => {
      element.classList.remove('screenreader-highlight');
    }, 3000);
  }
  
  // Read page title
  readPageTitle() {
    const title = this.getPageTitle();
    this.speak(`Page title: ${title}`);
  }
  
  // Read current URL
  readURL() {
    const url = window.location.href;
    const domain = this.getPageDomain();
    this.speak(`Current URL: ${domain}, ${url}`);
  }
  
  // Show visual indicator that screen reader is active
  showVisualIndicator(show) {
    let indicator = document.getElementById('screenreader-indicator');
    
    if (show) {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'screenreader-indicator';
        indicator.textContent = '🎤 Screen Reader Active';
        indicator.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 10px 20px;
          border-radius: 25px;
          font-family: Arial, sans-serif;
          font-size: 14px;
          font-weight: bold;
          z-index: 999999;
          box-shadow: 0 4px 6px rgba(0,0,0,0.3);
          animation: pulse 2s infinite;
        `;
        document.body.appendChild(indicator);
        
        // Add CSS animation
        if (!document.getElementById('screenreader-styles')) {
          const style = document.createElement('style');
          style.id = 'screenreader-styles';
          style.textContent = `
            @keyframes pulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.05); }
            }
            
            .screenreader-highlight {
              outline: 4px solid #667eea !important;
              outline-offset: 4px !important;
              background-color: rgba(102, 126, 234, 0.1) !important;
              transition: all 0.3s ease !important;
            }
          `;
          document.head.appendChild(style);
        }
      }
    } else {
      if (indicator) {
        indicator.remove();
      }
    }
  }
  
  // Show notification
  showNotification(message) {
    // Create toast notification
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #333;
      color: white;
      padding: 15px 25px;
      border-radius: 8px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      z-index: 1000000;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
  
  // Attach keyboard event listeners
  attachKeyboardListeners() {
    this.keyboardHandler = (event) => {
      if (!this.isActive) return;
      
      const key = event.key.toLowerCase();
      const code = event.code;
      
      // Check for Alt+shortcuts FIRST (before input detection)
      // Alt+H for help menu
      if (window.detectAltKey && window.detectAltKey(event, 'h', ['ḥ', 'ħ', 'ĥ'])) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.showHelp();
        return;
      }
      
      // Don't intercept if user is typing in an input
      const activeElement = document.activeElement;
      const isTypingInInput = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
      );
      
      // Arrow keys for link navigation - DON'T interfere with input fields
      if (key === 'arrowdown' && !isTypingInInput) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.navigateToNextLink();
        return;
      }
      
      if (key === 'arrowup' && !isTypingInInput) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.navigateToPreviousLink();
        return;
      }
      
      // Enter key to activate current link - only when a link is selected
      if (key === 'enter' && !isTypingInInput && this.currentLinkIndex >= 0) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.activateCurrentLink();
        return;
      }
      
      if (isTypingInInput) {
        return; // Let user type normally (including "/" character)
      }
      
      // "/" key to focus search box - only works when NOT in an input field
      const isSlashKey = key === '/' && !event.ctrlKey && !event.altKey && !event.shiftKey;
      
      if (isSlashKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        
        // Try to find and focus the search box
        const searchBox = document.querySelector('#searchBox') ||
                         document.querySelector('.search-box') ||
                         document.querySelector('input[type="text"]') || 
                         document.querySelector('input[type="search"]') ||
                         document.querySelector('input[placeholder*="search" i]') ||
                         document.querySelector('input[aria-label*="search" i]');
        
        if (searchBox) {
          searchBox.focus();
          searchBox.click();
          searchBox.value = '';
          searchBox.focus();
          
          setTimeout(() => {
            searchBox.select();
          }, 50);
          
          this.speak('Search box focused. Type your search query and press Enter.');
        } else {
          this.speak('No search box found on this page.');
        }
        return;
      }
      
      
      // Stop speaking on Escape
      if (key === 'escape') {
        event.preventDefault();
        this.stopSpeaking();
        return;
      }
      
      // Announce common browser shortcuts (Ctrl+T, Ctrl+W, etc.)
      if (event.ctrlKey || event.metaKey) {
        switch (key) {
          case 't':
            this.announceBrowserAction('new-tab');
            break;
          case 'w':
            this.announceBrowserAction('close-tab');
            break;
          case 'r':
            if (!event.shiftKey) {
              this.announceBrowserAction('refresh');
            }
            break;
          case 'f':
            this.announceBrowserAction('find');
            break;
          case 'p':
            this.announceBrowserAction('print');
            break;
          case 's':
            if (!event.shiftKey) {
              this.announceBrowserAction('save');
            }
            break;
          case 'd':
            this.announceBrowserAction('bookmark');
            break;
          case '+':
          case '=':
            this.announceBrowserAction('zoom-in');
            break;
          case '-':
          case '_':
            this.announceBrowserAction('zoom-out');
            break;
          case '0':
            this.announceBrowserAction('zoom-reset');
            break;
        }
      }
      
      // Back/Forward
      if (event.altKey) {
        switch (key) {
          case 'arrowleft':
            this.announceBrowserAction('back');
            break;
          case 'arrowright':
            this.announceBrowserAction('forward');
            break;
        }
      }
      
      // F11 - Fullscreen
      if (key === 'f11') {
        const isFullscreen = document.fullscreenElement !== null;
        this.announceBrowserAction(isFullscreen ? 'exit-fullscreen' : 'fullscreen');
      }
    };
    
    document.addEventListener('keydown', this.keyboardHandler, true);
    console.log('⌨️ Keyboard listeners attached');
  }
  
  // Remove keyboard event listeners
  removeKeyboardListeners() {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler, true);
      this.keyboardHandler = null;
      console.log('⌨️ Keyboard listeners removed');
    }
  }
}

// Create global instance and make it globally accessible
const screenReader = new ScreenReader();
window.screenReader = screenReader;
console.log('🎤 Global screenReader instance created');

// Listen for messages from background script (for compatibility)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'activate_screen_reader') {
    console.log('📨 Received activate_screen_reader command');
    screenReader.toggle();
    sendResponse({ status: 'success' });
    return true;
  }
});

// Auto-activate on page load if it was previously active
chrome.storage.local.get(['screenReaderActive'], (result) => {
  if (result.screenReaderActive) {
    console.log('🔄 Auto-activating screen reader (was active before)');
    setTimeout(() => screenReader.activate(), 1000);
  }
});

console.log('✅ ScreenReader module loaded');

} // End of else block (only run on regular webpages, not chrome:// pages)
