# 🏗️ ReadBuddy Screen Reader - Complete Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USER INTERACTION                            │
│                                                                          │
│  User opens Chrome → Navigates to webpage → Presses Ctrl+Shift+S       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CHROME KEYBOARD API                              │
│                                                                          │
│  • Intercepts keyboard shortcut                                         │
│  • Looks up command in manifest.json                                    │
│  • Finds: "activate_screen_reader"                                      │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     BACKGROUND.JS (Service Worker)                       │
│                                                                          │
│  chrome.commands.onCommand.addListener((command) => {                   │
│    if (command === 'activate_screen_reader') {                          │
│      1. Check if content script loaded                                  │
│      2. Inject if needed: ['content.js', 'screenreader.js']            │
│      3. Send message: { action: 'activate_screen_reader' }             │
│    }                                                                     │
│  });                                                                     │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      SCREENREADER.JS (Content Script)                    │
│                                                                          │
│  chrome.runtime.onMessage.addListener((request) => {                    │
│    if (request.action === 'activate_screen_reader') {                   │
│      screenReader.toggle();  // Activate/deactivate                     │
│    }                                                                     │
│  });                                                                     │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    SCREENREADER CLASS INITIALIZATION                     │
│                                                                          │
│  activate() {                                                            │
│    1. Initialize TTS (silent utterance for permission)                  │
│    2. Set isActive = true                                               │
│    3. Save state: chrome.storage.local.set()                            │
│    4. Speak welcome message                                             │
│    5. Show visual indicator (purple badge)                              │
│    6. Attach keyboard event listeners                                   │
│    7. Find all navigable elements on page                               │
│  }                                                                       │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       ELEMENT DETECTION SYSTEM                           │
│                                                                          │
│  findNavigableElements() {                                               │
│    Searches DOM for:                                                     │
│    • Headings:  document.querySelectorAll('h1, h2, h3, h4, h5, h6')    │
│    • Links:     document.querySelectorAll('a[href]')                    │
│    • Buttons:   document.querySelectorAll('button, input[type=...]')   │
│    • Inputs:    document.querySelectorAll('input, textarea, select')   │
│    • Images:    document.querySelectorAll('img')                        │
│                                                                          │
│    Builds array: this.navigableElements[] = [                           │
│      { element: <h1>, type: 'heading', text: 'Welcome' },              │
│      { element: <a>, type: 'link', text: 'Learn More' },               │
│      { element: <button>, type: 'button', text: 'Submit' },            │
│      ...                                                                 │
│    ]                                                                     │
│  }                                                                       │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    KEYBOARD EVENT LISTENER SYSTEM                        │
│                                                                          │
│  document.addEventListener('keydown', (event) => {                       │
│                                                                          │
│    // Check if user is typing in input                                  │
│    if (activeElement === 'INPUT' || activeElement === 'TEXTAREA') {    │
│      return; // Don't intercept - let user type                         │
│    }                                                                     │
│                                                                          │
│    // Navigation shortcuts                                              │
│    switch (event.key) {                                                 │
│      case 'j': navigateNext(); break;                                   │
│      case 'k': navigatePrevious(); break;                               │
│      case 'n': navigateToNextType('heading'); break;                    │
│      case 'l': navigateToNextType('link'); break;                       │
│      case 'b': navigateToNextType('button'); break;                     │
│      case 'i': navigateToNextType('image'); break;                      │
│      case 'f': navigateToNextType('input'); break;                      │
│      case 'h': showHelp(); break;                                       │
│      case 't': readPageTitle(); break;                                  │
│      case 'u': readURL(); break;                                        │
│      case 'r': announceCurrentElement(); break;                         │
│      case 's': stopSpeaking(); break;                                   │
│    }                                                                     │
│                                                                          │
│    // Browser action announcements                                      │
│    if (event.ctrlKey) {                                                 │
│      switch (event.key) {                                               │
│        case 't': announceBrowserAction('new-tab'); break;               │
│        case 'w': announceBrowserAction('close-tab'); break;             │
│        case 'r': announceBrowserAction('refresh'); break;               │
│        case 'f': announceBrowserAction('find'); break;                  │
│        ...                                                               │
│      }                                                                   │
│    }                                                                     │
│  });                                                                     │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
┌─────────────────────────┐   ┌──────────────────────────┐
│   NAVIGATION ACTIONS    │   │  BROWSER ANNOUNCEMENTS   │
│                         │   │                          │
│  navigateNext() {       │   │  announceBrowserAction() │
│    1. Increment index   │   │    speak('Opening new    │
│    2. Get element       │   │          tab', {         │
│    3. Scroll into view  │   │          rate: 1.2       │
│    4. Highlight element │   │    });                   │
│    5. Build announcement│   │                          │
│    6. speak(text)       │   │  Fast speech for quick   │
│  }                      │   │  feedback                │
└───────────┬─────────────┘   └────────────┬─────────────┘
            │                              │
            └──────────┬───────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         TEXT-TO-SPEECH ENGINE                            │
│                                                                          │
│  speak(text, options = {}) {                                             │
│    // Stop any current speech                                           │
│    window.speechSynthesis.cancel();                                     │
│                                                                          │
│    // Create utterance                                                  │
│    const utterance = new SpeechSynthesisUtterance(text);                │
│    utterance.rate = options.rate || this.speechRate;  // 1.0 default   │
│    utterance.volume = options.volume || this.volume;  // 1.0 default   │
│    utterance.lang = 'en-US';                                            │
│                                                                          │
│    // Event handlers                                                    │
│    utterance.onstart = () => { this.isSpeaking = true; };              │
│    utterance.onend = () => { this.isSpeaking = false; };               │
│    utterance.onerror = (e) => {                                         │
│      if (e.error === 'not-allowed') {                                  │
│        showNotification('Click page first to enable TTS');              │
│      }                                                                   │
│    };                                                                    │
│                                                                          │
│    // Speak!                                                            │
│    window.speechSynthesis.speak(utterance);                             │
│  }                                                                       │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         VISUAL FEEDBACK SYSTEM                           │
│                                                                          │
│  1. Show Active Indicator                                               │
│     • Purple badge in top-right: "🎤 Screen Reader Active"             │
│     • Pulsing animation                                                 │
│     • Always visible when active                                        │
│                                                                          │
│  2. Highlight Current Element                                           │
│     • Add CSS class: .screenreader-highlight                            │
│     • Purple outline: 4px solid #667eea                                │
│     • Light purple background: rgba(102, 126, 234, 0.1)                │
│     • Smooth transition animation                                       │
│     • Auto-remove after 3 seconds                                       │
│                                                                          │
│  3. Scroll Element Into View                                            │
│     • element.scrollIntoView({ behavior: 'smooth', block: 'center' })  │
│     • Centers element in viewport                                       │
│     • Smooth animation                                                  │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  USER FEEDBACK │
                  │                │
                  │  👁️ Sees:      │
                  │  • Purple badge│
                  │  • Highlighted │
                  │    element     │
                  │  • Smooth      │
                  │    scrolling   │
                  │                │
                  │  👂 Hears:      │
                  │  • "Link,      │
                  │    Contact Us" │
                  └────────────────┘
```

## Component Interaction Flow

```
┌──────────────┐
│   manifest   │  Defines keyboard shortcuts
│   .json      │  Lists content_scripts
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ background   │  Routes commands
│   .js        │  Injects scripts
└──────┬───────┘
       │
       ▼
┌──────────────┐
│screenreader  │  Main screen reader logic
│   .js        │  TTS, navigation, detection
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   content    │  Page interaction
│   .js        │  Existing functionality
└──────────────┘
```

## Data Flow: User Presses 'J' (Next Element)

```
User: Press J
    │
    ▼
Keyboard Listener (screenreader.js)
    │
    ├─→ Check: Is user typing? → No
    │
    ├─→ event.preventDefault()
    │
    └─→ navigateNext()
            │
            ├─→ currentElementIndex++
            │
            ├─→ Get element from navigableElements[index]
            │       element = { type: 'link', text: 'Contact Us', element: <a> }
            │
            ├─→ element.scrollIntoView({ behavior: 'smooth' })
            │       (Page smoothly scrolls to link)
            │
            ├─→ highlightElement(element)
            │       (Adds purple outline CSS class)
            │
            ├─→ Build announcement:
            │       "Link, Contact Us"
            │
            └─→ speak("Link, Contact Us")
                    │
                    ├─→ Create SpeechSynthesisUtterance
                    │
                    ├─→ Set rate: 1.0, volume: 1.0, lang: 'en-US'
                    │
                    └─→ window.speechSynthesis.speak(utterance)
                            │
                            └─→ User hears: "Link, Contact Us"
```

## Storage Architecture

```
chrome.storage.local
    │
    └─→ { screenReaderActive: true/false }
            │
            ├─→ Set when: User activates/deactivates
            │
            ├─→ Read when: Page loads
            │
            └─→ Purpose: Auto-activate on page load if was active before
```

## TTS Permission Flow

```
Page Load
    │
    ▼
User clicks anywhere OR presses any key
    │
    ▼
initializeTTS() triggered (once)
    │
    ├─→ Create silent utterance: SpeechSynthesisUtterance('')
    │
    ├─→ Set volume: 0 (silent)
    │
    ├─→ window.speechSynthesis.speak(utterance)
    │       (Gets TTS permission without sound)
    │
    └─→ this.initialized = true
            │
            └─→ Future TTS calls work without permission errors
```

## Element Detection Hierarchy

```
findNavigableElements()
    │
    ├─→ Headings (Priority 1)
    │   └─→ querySelectorAll('h1, h2, h3, h4, h5, h6')
    │       └─→ { type: 'heading', level: 'H1', text: 'Welcome' }
    │
    ├─→ Links (Priority 2)
    │   └─→ querySelectorAll('a[href]')
    │       └─→ { type: 'link', text: 'Learn More' }
    │
    ├─→ Buttons (Priority 3)
    │   └─→ querySelectorAll('button, input[type="button"], input[type="submit"]')
    │       └─→ { type: 'button', text: 'Submit' }
    │
    ├─→ Form Inputs (Priority 4)
    │   └─→ querySelectorAll('input, textarea, select')
    │       └─→ { type: 'input', inputType: 'text', text: 'Email Address' }
    │       └─→ Label detection:
    │           1. <label for="id">
    │           2. Parent <label>
    │           3. aria-label
    │           4. placeholder
    │
    └─→ Images (Priority 5)
        └─→ querySelectorAll('img')
            └─→ { type: 'image', text: 'Company Logo' }
```

## Keyboard Handler Priority System

```
Keydown Event
    │
    ├─→ Check 1: Is user typing in input?
    │   ├─→ YES: Return immediately (don't intercept)
    │   └─→ NO: Continue
    │
    ├─→ Check 2: Is screen reader active?
    │   ├─→ NO: Return (don't handle)
    │   └─→ YES: Continue
    │
    ├─→ Check 3: What key pressed?
    │   ├─→ Navigation keys (j, k, n, l, b, i, f): Handle
    │   ├─→ Information keys (t, u, r, h): Handle
    │   ├─→ Control keys (s, escape): Handle
    │   └─→ Other keys: Pass through
    │
    └─→ Check 4: Modifier keys?
        ├─→ Ctrl+T/W/R/F/P/D: Announce browser action
        ├─→ Alt+Left/Right: Announce navigation
        └─→ Other combos: Pass through
```

## File Dependencies

```
manifest.json
    │
    ├─→ Defines: "activate_screen_reader" command
    │
    ├─→ Lists content_scripts: ['content.js', 'screenreader.js']
    │
    └─→ Requires permissions: ['storage', 'tts', 'scripting']

background.js
    │
    ├─→ Listens: chrome.commands.onCommand
    │
    ├─→ Injects: content.js + screenreader.js if needed
    │
    └─→ Sends: { action: 'activate_screen_reader' }

screenreader.js
    │
    ├─→ Listens: chrome.runtime.onMessage
    │
    ├─→ Creates: ScreenReader class instance
    │
    ├─→ Uses: chrome.storage.local (persist state)
    │
    ├─→ Uses: window.speechSynthesis (TTS)
    │
    └─→ Uses: document.addEventListener (keyboard)
```

---

**This architecture provides:**
- ✅ Modular design (separate screenreader.js)
- ✅ Robust error handling (TTS permissions, input detection)
- ✅ Persistent state (remembers active status)
- ✅ Visual + audio feedback (purple outline + TTS)
- ✅ Smart input protection (doesn't interfere with typing)
- ✅ Smooth UX (animations, scrolling, highlighting)
