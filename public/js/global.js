document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================================
    // 1. Mobile Menu Toggle
    // ==========================================================================
    const navbarToggleButton = document.getElementById('navbarToggleButton');
    const asideMenu = document.querySelector('aside');
    
    if (navbarToggleButton && asideMenu) {
        navbarToggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            asideMenu.classList.toggle('open');
        });
        
        // Close menu if clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (asideMenu.classList.contains('open') && !asideMenu.contains(e.target)) {
                asideMenu.classList.remove('open');
            }
        });
    }

    // ==========================================================================
    // 2. Real-time Chat Polling (Sidebar Widget) with Smart Cost-Saving
    // ==========================================================================
    const chatBox = document.getElementById('chatBox');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    
    let lastMessageCount = 0;
    let pollIntervalId = null;
    let idleTimerId = null;
    let isIdle = false;
    
    const POLL_RATE = 4000; // 4 seconds polling rate to save database reads
    const IDLE_LIMIT = 3 * 60 * 1000; // 3 minutes idle timeout

    async function loadChatMessages() {
        if (!chatBox || isIdle || document.hidden) return;
        try {
            const res = await fetch('/chat/messages');
            if (!res.ok) throw new Error('Failed to fetch messages');
            const messages = await res.json();
            
            // Render messages
            chatBox.innerHTML = messages.map(msg => {
                const dateStr = new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return `
                    <div class="chat-msg">
                        <div class="chat-msg-header">
                            <span class="chat-msg-author">${msg.authorIp}</span>
                            <span class="chat-msg-time">${dateStr}</span>
                        </div>
                        <div class="chat-msg-content">${escapeHTML(msg.content)}</div>
                    </div>
                `;
            }).join('');

            // Scroll to bottom if new message arrived
            if (messages.length !== lastMessageCount) {
                chatBox.scrollTop = chatBox.scrollHeight;
                lastMessageCount = messages.length;
            }
        } catch (err) {
            console.error('Chat load error:', err);
        }
    }

    function escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function startPolling() {
        if (pollIntervalId) return;
        loadChatMessages();
        pollIntervalId = setInterval(loadChatMessages, POLL_RATE);
    }

    function stopPolling() {
        if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
        }
    }

    // Reset idle timer and resume polling if needed
    function resetIdleTimer() {
        clearTimeout(idleTimerId);
        
        if (isIdle) {
            isIdle = false;
            if (chatInput) chatInput.placeholder = "메아리 투척...";
            startPolling();
        }
        
        idleTimerId = setTimeout(goIdle, IDLE_LIMIT);
    }

    function goIdle() {
        isIdle = true;
        stopPolling();
        if (chatInput) chatInput.placeholder = "대기 모드 (움직여서 활성화)";
    }

    // Visibility API support (Tab switching / Minimizing)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPolling();
        } else {
            resetIdleTimer();
            startPolling();
        }
    });

    // Detect user interactions to reset idle timer
    const activityEvents = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    activityEvents.forEach(evt => {
        window.addEventListener(evt, resetIdleTimer, { passive: true });
    });

    if (chatBox) {
        startPolling();
        resetIdleTimer();
    }

    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const content = chatInput.value.trim();
            if (!content) return;

            chatInput.disabled = true;
            try {
                const res = await fetch('/chat/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ content })
                });
                if (res.ok) {
                    chatInput.value = '';
                    // Force refresh and reset idle timer on manual post
                    resetIdleTimer();
                    await loadChatMessages();
                } else {
                    console.error('Failed to send message');
                }
            } catch (err) {
                console.error('Chat send error:', err);
            } finally {
                chatInput.disabled = false;
                chatInput.focus();
            }
        });
    }
});
