document.addEventListener('DOMContentLoaded', () => {
    // Format dates client-side to handle local timezone correctly
    document.querySelectorAll('.post-date, .comment-date').forEach(el => {
        const timestamp = el.getAttribute('data-timestamp');
        if (timestamp) {
            const date = new Date(parseInt(timestamp, 10));
            if (el.tagName === 'STRONG') {
                el.textContent = date.toLocaleDateString('ko-KR');
            } else {
                el.textContent = date.toLocaleString('ko-KR');
            }
        }
    });

    // ==========================================================================
    // 1. Mobile Menu Toggle
    // ==========================================================================
    const navbarToggleButton = document.getElementById('navbarToggleButton');
    const asideMenu = document.querySelector('aside');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    if (navbarToggleButton && asideMenu) {
        navbarToggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = asideMenu.classList.toggle('open');
            if (sidebarOverlay) {
                if (isOpen) {
                    sidebarOverlay.classList.add('active');
                } else {
                    sidebarOverlay.classList.remove('active');
                }
            }
        });
        
        if (sidebarOverlay) {
            // Close menu when clicking the overlay
            sidebarOverlay.addEventListener('click', () => {
                asideMenu.classList.remove('open');
                sidebarOverlay.classList.remove('active');
            });
            // Support touchstart for fast response on mobile
            sidebarOverlay.addEventListener('touchstart', (e) => {
                e.preventDefault();
                asideMenu.classList.remove('open');
                sidebarOverlay.classList.remove('active');
            }, { passive: true });
        }
    }

    // ==========================================================================
    // 2. Real-time Chat Polling (Sidebar Widget) with Smart Cost-Saving
    // ==========================================================================
    const chatBox = document.getElementById('chatBox');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    
    let lastTimestamp = 0;
    let pollIntervalId = null;
    let idleTimerId = null;
    let isIdle = false;
    let isChatVisible = true; // Tracks if the chat widget is visible in viewport
    let isFetching = false;   // Prevents overlapping/duplicate requests
    
    const POLL_RATE = 6000; // Increased poll rate to 6 seconds to reduce read counts
    const IDLE_LIMIT = 3 * 60 * 1000; // 3 minutes idle timeout

    // Intersection Observer: stops polling when chat is out of view (e.g. scrolled down)
    const chatWidget = document.querySelector('.chat-widget');
    if (chatWidget && typeof IntersectionObserver !== 'undefined') {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isChatVisible = entry.isIntersecting;
                if (isChatVisible) {
                    resetIdleTimer();
                    startPolling();
                } else {
                    stopPolling();
                }
            });
        }, { threshold: 0.05 });
        observer.observe(chatWidget);
    }

    async function loadChatMessages() {
        // Skip fetching if hidden, idle, not in viewport, or another fetch is in progress
        if (!chatBox || isIdle || document.hidden || !isChatVisible || isFetching) return;
        
        isFetching = true;
        try {
            const url = lastTimestamp ? `/chat/messages?since=${lastTimestamp}` : '/chat/messages';
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch messages');
            const messages = await res.json();
            
            if (messages.length > 0) {
                const newHTML = messages.map(msg => {
                    const dateStr = new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const authorText = msg.authorNickname ? msg.authorNickname : `익명(${msg.authorIp})`;
                    const authorStyle = msg.authorNickname ? 'style="color: var(--accent-color); font-weight: bold;"' : '';
                    return `
                        <div class="chat-msg">
                            <div class="chat-msg-header">
                                <span class="chat-msg-author" ${authorStyle}>${authorText}</span>
                                <span class="chat-msg-time">${dateStr}</span>
                            </div>
                            <div class="chat-msg-content">${escapeHTML(msg.content)}</div>
                        </div>
                    `;
                }).join('');

                if (lastTimestamp === 0) {
                    // Initial load: render all 20 messages
                    chatBox.innerHTML = newHTML;
                } else {
                    // Incremental update: append new messages only (no DOM thrashing)
                    chatBox.insertAdjacentHTML('beforeend', newHTML);
                }
                
                // Track cursor timestamp
                lastTimestamp = messages[messages.length - 1].createdAt;
                chatBox.scrollTop = chatBox.scrollHeight;
            } else if (lastTimestamp === 0) {
                chatBox.innerHTML = '<div style="text-align: center; color: #666; padding-top: 50px; font-size: 11px;">침묵만이 흐르는 심연입니다.</div>';
            }
        } catch (err) {
            console.error('Chat load error:', err);
        } finally {
            isFetching = false;
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
            if (!content || isFetching) return;

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

    // ==========================================================================
    // 3. 4chan Style Image Expansion (Inline Toggle)
    // ==========================================================================
    document.body.addEventListener('click', (e) => {
        const trigger = e.target.closest('.lightbox-trigger');
        if (trigger) {
            e.preventDefault();
            const img = trigger.querySelector('.post-thumbnail');
            const container = trigger.closest('.post-image-container');
            const body = trigger.closest('.post-body');
            
            if (img) {
                img.classList.toggle('expanded');
            }
            if (container) {
                container.classList.toggle('expanded');
            }
            if (body) {
                body.classList.toggle('has-expanded-image');
            }
        }
    });
});

// Global Reply Form Toggle helper
window.toggleReplyForm = function(id) {
    const form = document.getElementById('reply-form-' + id);
    if (form) {
        const isHidden = form.style.display === 'none';
        form.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            const input = form.querySelector('.comment-input');
            if (input) input.focus();
        }
    }
};

