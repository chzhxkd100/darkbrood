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
    // 2. Real-time Chat Polling (Sidebar Widget)
    // ==========================================================================
    const chatBox = document.getElementById('chatBox');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    
    let lastMessageCount = 0;

    async function loadChatMessages() {
        if (!chatBox) return;
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

    if (chatBox) {
        loadChatMessages();
        // Poll every 3 seconds
        setInterval(loadChatMessages, 3000);
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
