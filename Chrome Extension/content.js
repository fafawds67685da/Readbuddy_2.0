// content.js - Inject this into every webpage for screen reader functionality + Bubble Button

class ReadBuddyScreenReader {
  constructor() {
    this.enabled = false;
    this.currentElement = null;
    this.elementIndex = 0;
    this.navigableElements = [];
    this.speechRate = 1.0;
    this.speaking = false;
    
    this.initKeyboardShortcuts();
    this.createBubbleButton();
  }

  createBubbleButton() {
    // Create floating bubble button
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
        <button class="rb-menu-item" id="rb-toggle-reader">
          <span>⌨️</span>
          <span>Screen Reader</span>
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

    // Add styles
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
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
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

    // Make bubble draggable
    this.makeDraggable(bubble.querySelector('.rb-bubble-main'));

    // Toggle menu
    const bubbleToggle = document.getElementById('rb-bubble-toggle');
    const bubbleMenu = document.getElementById('rb-bubble-menu');
    let menuOpen = false;

    bubbleToggle.addEventListener('click', (e) => {
      if (e.target.closest('.rb-bubble-main').classList.contains('rb-dragging')) {
        return; // Don't toggle if dragging
      }
      menuOpen = !menuOpen;
      bubbleMenu.style.display = menuOpen ? 'block' : 'none';
      bubbleToggle.classList.toggle('active', menuOpen);
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#readbuddy-bubble')) {
        menuOpen = false;
        bubbleMenu.style.display = 'none';
        bubbleToggle.classList.remove('active');
      }
    });

    // Menu actions
    document.getElementById('rb-analyze').addEventListener('click', () => {
      this.analyzePage();
      menuOpen = false;
      bubbleMenu.style.display = 'none';
      bubbleToggle.classList.remove('active');
    });

    document.getElementById('rb-toggle-reader').addEventListener('click', () => {
      this.toggle();
      this.updateBubbleStatus();
      menuOpen = false;
      bubbleMenu.style.display = 'none';
      bubbleToggle.classList.remove('active');
    });

    document.getElementById('rb-stop-speech').addEventListener('click', () => {
      this.stopSpeaking();
      menuOpen = false;
      bubbleMenu.style.display = 'none';
      bubbleToggle.classList.remove('active');
    });

    document.getElementById('rb-settings').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openPopup' });
      menuOpen = false;
      bubbleMenu.style.display = 'none';
      bubbleToggle.classList.remove('active');
    });
  }

  makeDraggable(element) {
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
  }

  updateBubbleStatus() {
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
  }

  async analyzePage() {
    try {
      this.speak("Analyzing page content, please wait...");

      // Extract page content
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

      // Send to backend
      const response = await fetch("http://127.0.0.1:8000/analyze-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, images, videos: videos.slice(0, 5) }),
      });

      const data = await response.json();
      
      // Speak results
      this.speakAnalysisResults(data);
      
    } catch (error) {
      this.speak("Error analyzing page: " + error.message);
      console.error("Analysis error:", error);
    }
  }

  speakAnalysisResults(data) {
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
  }

  initKeyboardShortcuts() {
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
  }

  handleKeyPress(e) {
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey;
    const alt = e.altKey;

    if (ctrl && alt && key === 'r') {
      this.toggle();
      return true;
    }

    switch (key) {
      case 'j':
        this.navigateNext();
        return true;
      case 'k':
        this.navigatePrevious();
        return true;
      case 'h':
        this.navigateToNext('h1, h2, h3, h4, h5, h6');
        return true;
      case 'l':
        this.navigateToNext('a[href]');
        return true;
      case 'b':
        this.navigateToNext('button, input[type="button"], input[type="submit"]');
        return true;
      case 'g':
        this.navigateToNext('img');
        return true;
      case 'f':
        this.navigateToNext('input:not([type="button"]):not([type="submit"]), select, textarea');
        return true;
      case 's':
        this.stopSpeaking();
        return true;
      case 'r':
        this.announceCurrentElement();
        return true;
      case 'escape':
        this.stopSpeaking();
        return true;
      case 'enter':
        if (this.currentElement && !this.currentElement.matches('input, textarea, select')) {
          this.currentElement.click();
        }
        return false;
    }

    return false;
  }

  toggle() {
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
  }

  updateNavigableElements() {
    this.navigableElements = Array.from(
      document.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, p, a, button, input, select, textarea, img[alt], [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && 
             style.visibility !== 'hidden' && 
             el.offsetParent !== null &&
             el.offsetWidth > 0 &&
             el.offsetHeight > 0;
    });
    
    this.elementIndex = 0;
  }

  navigateNext() {
    if (this.navigableElements.length === 0) {
      this.updateNavigableElements();
    }

    this.elementIndex = (this.elementIndex + 1) % this.navigableElements.length;
    this.currentElement = this.navigableElements[this.elementIndex];
    this.announceCurrentElement();
  }

  navigatePrevious() {
    if (this.navigableElements.length === 0) {
      this.updateNavigableElements();
    }

    this.elementIndex = (this.elementIndex - 1 + this.navigableElements.length) % this.navigableElements.length;
    this.currentElement = this.navigableElements[this.elementIndex];
    this.announceCurrentElement();
  }

  navigateToNext(selector) {
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
      const elementType = selector.includes('h') ? 'heading' : 
                         selector.includes('a') ? 'link' :
                         selector.includes('button') ? 'button' :
                         selector.includes('img') ? 'image' : 'element';
      this.speak(`No more ${elementType}s found`);
    }
  }

  announceCurrentElement() {
    if (!this.currentElement) return;

    this.highlightElement(this.currentElement);
    this.scrollIntoView(this.currentElement);

    const announcement = this.getElementDescription(this.currentElement);
    this.speak(announcement);
  }

  getElementDescription(element) {
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
  }

  highlightElement(element) {
    this.clearHighlight();
    if (!element) return;

    element.style.outline = '3px solid #ff6b35';
    element.style.outlineOffset = '2px';
    element.setAttribute('data-readbuddy-highlight', 'true');
  }

  clearHighlight() {
    const highlighted = document.querySelector('[data-readbuddy-highlight]');
    if (highlighted) {
      highlighted.style.outline = '';
      highlighted.style.outlineOffset = '';
      highlighted.removeAttribute('data-readbuddy-highlight');
    }
  }

  scrollIntoView(element) {
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    });
  }

  speak(text, interrupt = true) {
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
  }

  stopSpeaking() {
    window.speechSynthesis.cancel();
    this.speaking = false;
  }
}

// Initialize screen reader
const readBuddy = new ReadBuddyScreenReader();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggle') {
    readBuddy.toggle();
    sendResponse({ enabled: readBuddy.enabled });
  } else if (request.action === 'updateRate') {
    readBuddy.speechRate = request.rate;
    sendResponse({ success: true });
  }
  return true;
});

console.log('✅ ReadBuddy loaded! Press Ctrl+Alt+R or click the bubble button.');