// newtab.js - JavaScript for the custom new tab page

// Greeting based on time of day
function updateGreeting() {
    const hour = new Date().getHours();
    const greeting = document.getElementById('greeting');
    let message = '';
    
    if (hour < 12) {
        message = '☀️ Good Morning!';
    } else if (hour < 18) {
        message = '🌤️ Good Afternoon!';
    } else {
        message = '🌙 Good Evening!';
    }
    
    greeting.textContent = message;
}

// Search functionality
const searchBox = document.getElementById('searchBox');
searchBox.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const query = searchBox.value.trim();
        if (!query) return;
        
        // Check if it's a URL
        if (query.includes('.') && !query.includes(' ')) {
            // Add https:// if not present
            const url = query.startsWith('http') ? query : 'https://' + query;
            window.location.href = url;
        } else {
            // Search on Google
            window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(query);
        }
    }
});

// Focus search box on load
window.addEventListener('load', () => {
    updateGreeting();
    // Don't auto-focus if screen reader might be active
    setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) {
            searchBox.focus();
        }
    }, 500);
});

// Update greeting every minute
setInterval(updateGreeting, 60000);

// Listen for screen reader activation
chrome.storage.local.get(['screenReaderActive'], (result) => {
    if (result.screenReaderActive) {
        document.getElementById('screenReaderBadge').classList.add('active');
    }
});

// Watch for screen reader changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.screenReaderActive) {
        const badge = document.getElementById('screenReaderBadge');
        if (changes.screenReaderActive.newValue) {
            badge.classList.add('active');
        } else {
            badge.classList.remove('active');
        }
    }
});
