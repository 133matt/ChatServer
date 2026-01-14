// ===== background.js - DEBUGGED SERVICE WORKER =====

const API_URL = 'https://chatserver-numj.onrender.com';
let lastMessageCount = 0;

// Start checking immediately
checkForNewMessages();

// Then check every 2 seconds
setInterval(checkForNewMessages, 2000);

async function checkForNewMessages() {
  try {
    const response = await fetch(`${API_URL}/messages`);
    if (!response.ok) return;

    const messages = await response.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      // No messages, clear badge
      chrome.action.setBadgeText({ text: '' });
      lastMessageCount = 0;
      return;
    }

    // ✅ FIX: Compare against lastMessageCount instead of stored value
    if (messages.length > lastMessageCount) {
      const unreadCount = messages.length - lastMessageCount;
      chrome.action.setBadgeText({ text: String(unreadCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#667eea' }); // Purple
      console.log(`📬 ${unreadCount} unread messages`);
      lastMessageCount = messages.length;
    }

    // Save the current message count for persistence
    await chrome.storage.local.set({ lastSeenCount: messages.length });
  } catch (error) {
    console.error('❌ Check error:', error.message);
  }
}

// When popup opens, clear the badge and mark messages as seen
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'popupOpened') {
    // Clear badge immediately
    chrome.action.setBadgeText({ text: '' });
    console.log('📱 Popup opened - badge cleared');

    // Update lastMessageCount
    fetch(`${API_URL}/messages`)
      .then(r => r.json())
      .then(messages => {
        if (Array.isArray(messages)) {
          lastMessageCount = messages.length;
          chrome.storage.local.set({ lastSeenCount: messages.length });
        }
      })
      .catch(() => {});
  }
});
