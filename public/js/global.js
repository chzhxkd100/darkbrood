window.escapeHTML = function(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

window.formatLinksAndEmbeds = function(escapedText) {
    if (!escapedText) return '';
    
    // Regex for URLs
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    
    return escapedText.replace(urlRegex, (url) => {
        // Check if it's a YouTube link
        const ytMatch = url.match(/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
        
        if (ytMatch && ytMatch[1]) {
            const videoId = ytMatch[1];
            return `<div class="youtube-embed" style="position: relative; padding-bottom: 56.25%; height: 0; margin: 10px 0; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; max-width: 500px;"><iframe src="https://www.youtube.com/embed/${videoId}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" frameborder="0" allowfullscreen></iframe></div><a href="${url}" target="_blank" style="color: var(--accent-color); text-decoration: underline; font-size: 11px;">[YouTube 링크]</a>`;
        }
        
        // Check if it's an image link
        const isImage = /\.(jpeg|jpg|gif|png|webp|bmp)(?:\?.*)?$/i.test(url);
        if (isImage) {
            return `<div class="embedded-image" style="margin: 10px 0;"><a href="${url}" class="lightbox-trigger" title="클릭하여 확대"><img src="${url}" style="max-width: 100%; max-height: 300px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);" alt="Embedded Image" /></a></div><a href="${url}" target="_blank" style="color: var(--accent-color); text-decoration: underline; font-size: 11px;">[이미지 링크]</a>`;
        }

        // Check if it's a video link (mp4, webm)
        const isVideo = /\.(mp4|webm|ogg)(?:\?.*)?$/i.test(url);
        if (isVideo) {
            return `<div class="embedded-video" style="margin: 10px 0;"><video src="${url}" controls style="max-width: 100%; max-height: 300px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);"></video></div><a href="${url}" target="_blank" style="color: var(--accent-color); text-decoration: underline; font-size: 11px;">[비디오 링크]</a>`;
        }
        
        // General link
        return `<a href="${url}" target="_blank" style="color: var(--accent-color); text-decoration: underline;">${url}</a>`;
    });
};

document.addEventListener('DOMContentLoaded', () => {
    // Process initial server-rendered text contents
    document.querySelectorAll('.post-text-content, .comment-text, .chat-msg-content, .notice-brief-content, .diary-post-content').forEach(el => {
        if (!el.dataset.formatted) {
            el.innerHTML = window.formatLinksAndEmbeds(el.innerHTML);
            el.dataset.formatted = 'true';
        }
    });

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
            sidebarOverlay.addEventListener('click', (e) => {
                // Only close if click target is NOT inside the aside (extra safety)
                if (!asideMenu.contains(e.target)) {
                    asideMenu.classList.remove('open');
                    sidebarOverlay.classList.remove('active');
                }
            });
            // Support touchstart for fast response on mobile
            // Must NOT be passive so we can call preventDefault when needed
            sidebarOverlay.addEventListener('touchstart', (e) => {
                // Ignore touches that originate inside the sidebar itself
                if (asideMenu.contains(e.target)) return;
                e.preventDefault();
                asideMenu.classList.remove('open');
                sidebarOverlay.classList.remove('active');
            }, { passive: false });
        }
    }

    // ==========================================================================
    // 2. Real-time Chat Polling (Sidebar Widget) with Smart Cost-Saving
    // ==========================================================================
    const chatBox = document.getElementById('chatBox');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    
    let lastTimestamp = 0;
    let oldestTimestamp = 0;
    let hasMorePastChats = true;
    let isChatLoadingMore = false;
    let chatTimeoutId = null;
    let idleTimerId = null;
    let isIdle = false;
    let isChatVisible = true; // Tracks if the chat widget is visible in viewport
    let isFetching = false;   // Prevents overlapping/duplicate POLL requests
    let isSending = false;    // Separate flag for send requests (don't block with isFetching)
    
    const POLL_RATE = 6000; // Active poll rate: 6 seconds
    const IDLE_LIMIT = 3 * 60 * 1000; // 3 minutes idle timeout

    // Bind scroll event to load more past chat messages
    if (chatBox) {
        chatBox.addEventListener('scroll', () => {
            if (chatBox.scrollTop === 0) {
                loadMoreChatMessages();
            }
        });
    }

    // Intersection Observer: stops polling when chat is out of view.
    const chatWidget = document.querySelector('.chat-widget');
    const isMobileLayout = () => window.matchMedia('(max-width: 768px)').matches;

    if (chatWidget && typeof IntersectionObserver !== 'undefined' && !isMobileLayout()) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isChatVisible = entry.isIntersecting;
                if (isChatVisible) {
                    resetIdleTimer();
                    scheduleNextChatPoll();
                } else {
                    stopPolling();
                }
            });
        }, { threshold: 0.05 });
        observer.observe(chatWidget);
    }

    function getNextChatDelay() {
        if (document.hidden) {
            return 15000; // Background: 15 seconds
        }
        if (isIdle) {
            return 12000; // Idle: 12 seconds
        }
        return POLL_RATE; // Active: 6 seconds
    }

    async function loadChatMessages() {
        // Skip fetching if hidden, idle, not in viewport, or another fetch is in progress
        if (!chatBox || !isChatVisible || isFetching) return;
        
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
                            <div class="chat-msg-content">${window.formatLinksAndEmbeds(window.escapeHTML(msg.content))}</div>
                        </div>
                    `;
                }).join('');

                if (lastTimestamp === 0) {
                    // Initial load: render all 20 messages
                    chatBox.innerHTML = newHTML;
                    oldestTimestamp = messages[0].createdAt;
                } else {
                    // Incremental update: append new messages only
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

    async function loadMoreChatMessages() {
        if (!chatBox || !hasMorePastChats || isChatLoadingMore) return;
        
        isChatLoadingMore = true;
        
        // Show a brief loading indicator at the top
        const loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'chat-loading-more';
        loadingIndicator.style = 'text-align: center; color: #888; font-size: 11px; padding: 5px 0; font-family: inherit;';
        loadingIndicator.textContent = '이전 메아리 불러오는 중...';
        chatBox.insertBefore(loadingIndicator, chatBox.firstChild);
        
        try {
            const res = await fetch(`/chat/messages?before=${oldestTimestamp}`);
            if (!res.ok) throw new Error('Failed to fetch past messages');
            const messages = await res.json();
            
            // Remove indicator
            const indicatorEl = document.getElementById('chat-loading-more');
            if (indicatorEl) indicatorEl.remove();
            
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
                            <div class="chat-msg-content">${window.formatLinksAndEmbeds(window.escapeHTML(msg.content))}</div>
                        </div>
                    `;
                }).join('');
                
                const prevScrollHeight = chatBox.scrollHeight;
                
                // Prepend to chat container
                chatBox.insertAdjacentHTML('afterbegin', newHTML);
                
                // Update oldest timestamp to the first item of the new batch
                oldestTimestamp = messages[0].createdAt;
                
                // Keep scroll position relative to previous top position
                chatBox.scrollTop = chatBox.scrollHeight - prevScrollHeight;
            } else {
                hasMorePastChats = false;
                // Add a brief system notice that it's the end
                const endNotice = document.createElement('div');
                endNotice.style = 'text-align: center; color: #555; font-size: 10px; padding: 6px 0; font-style: italic;';
                endNotice.textContent = '메아리의 시작점에 도달했습니다.';
                chatBox.insertBefore(endNotice, chatBox.firstChild);
            }
        } catch (err) {
            console.error('Failed to load more chats:', err);
            const indicatorEl = document.getElementById('chat-loading-more');
            if (indicatorEl) indicatorEl.remove();
        } finally {
            isChatLoadingMore = false;
        }
    }



    function scheduleNextChatPoll() {
        if (chatTimeoutId) clearTimeout(chatTimeoutId);
        chatTimeoutId = setTimeout(async () => {
            await loadChatMessages();
            scheduleNextChatPoll();
        }, getNextChatDelay());
    }

    function startPolling() {
        loadChatMessages();
        scheduleNextChatPoll();
    }

    function stopPolling() {
        if (chatTimeoutId) {
            clearTimeout(chatTimeoutId);
            chatTimeoutId = null;
        }
    }

    // Reset idle timer and resume polling if needed
    function resetIdleTimer() {
        clearTimeout(idleTimerId);
        
        if (isIdle) {
            isIdle = false;
            if (chatInput) chatInput.placeholder = "메아리 투척...";
            scheduleNextChatPoll();
            scheduleNextPostPoll();
        }
        
        idleTimerId = setTimeout(goIdle, IDLE_LIMIT);
    }

    function goIdle() {
        isIdle = true;
        if (chatInput) chatInput.placeholder = "대기 모드 (메아리 지속 수신)";
        scheduleNextChatPoll();
        scheduleNextPostPoll();
    }

    // Visibility API support (Tab switching / Minimizing)
    document.addEventListener('visibilitychange', () => {
        scheduleNextChatPoll();
        scheduleNextPostPoll();
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

    // ==========================================================================
    // 2-2. Real-time Posts & Comments Polling Engine
    // ==========================================================================
    let postTimeoutId = null;
    let isPostFetching = false;
    let latestPostTimestamp = 0;
    let latestCommentTimestamp = 0;

    function getPostTypeFromPath() {
        const path = window.location.pathname;
        if (path === '/community') return 'community';
        if (path === '/diary') return 'diary';
        if (path === '/notice') return 'notice';
        return null;
    }

    function getNextPostDelay() {
        if (document.hidden) {
            return 30000; // Background: 30 seconds
        }
        if (isIdle) {
            return 20000; // Idle: 20 seconds
        }
        return 10000; // Active: 10 seconds
    }

    function getRenderedPostIds() {
        const postElements = document.querySelectorAll('[id^="post-"]');
        const ids = [];
        postElements.forEach(el => {
            const id = el.id.replace('post-', '');
            if (id) ids.push(id);
        });
        return ids;
    }

    function initializeTimestamps() {
        const dates = document.querySelectorAll('.post-date');
        let maxPostTime = 0;
        dates.forEach(el => {
            const ts = parseInt(el.getAttribute('data-timestamp'), 10);
            if (ts && ts > maxPostTime) maxPostTime = ts;
        });
        latestPostTimestamp = maxPostTime;

        const commentDates = document.querySelectorAll('.comment-date');
        let maxCommentTime = 0;
        commentDates.forEach(el => {
            const ts = parseInt(el.getAttribute('data-timestamp'), 10);
            if (ts && ts > maxCommentTime) maxCommentTime = ts;
        });
        latestCommentTimestamp = maxCommentTime;
    }

    async function loadPostUpdates() {
        const type = getPostTypeFromPath();
        const postIds = getRenderedPostIds();
        
        if (!type && postIds.length === 0) return;
        if (isPostFetching) return;

        isPostFetching = true;
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const page = parseInt(urlParams.get('page')) || 1;
            const isFirstPage = page === 1;

            const targetType = isFirstPage ? type : null;
            const postQuery = targetType ? `&type=${targetType}&since=${latestPostTimestamp}` : '';
            const commentQuery = postIds.length > 0 ? `&postIds=${JSON.stringify(postIds)}&commentsSince=${latestCommentTimestamp}` : '';

            if (!postQuery && !commentQuery) return;

            const res = await fetch(`/posts/updates?_${Date.now()}${postQuery}${commentQuery}`);
            if (!res.ok) throw new Error('Failed to fetch post updates');
            const data = await res.json();

            // 1. Process new posts
            if (data.newPosts && data.newPosts.length > 0) {
                data.newPosts.sort((a, b) => a.createdAt - b.createdAt);
                
                const container = document.querySelector('.community-list-container, .diary-list-container');
                if (container && typeof window.renderPostItem === 'function') {
                    // Remove empty message if exists
                    const emptyPlaceholder = container.querySelector('.styled-containers.aero-borders');
                    if (emptyPlaceholder && emptyPlaceholder.textContent.includes('비어 있습니다')) {
                        const parentPlaceholder = emptyPlaceholder.closest('.glass-borders');
                        if (parentPlaceholder) parentPlaceholder.remove();
                        else emptyPlaceholder.remove();
                    }

                    data.newPosts.forEach(post => {
                        if (document.getElementById(`post-${post.id}`)) return;

                        const postHTML = window.renderPostItem(post, data.usersMap);
                        if (postHTML) {
                            container.insertAdjacentHTML('afterbegin', postHTML);
                            
                            // Re-format timestamps for the newly prepended post
                            const newPostEl = document.getElementById(`post-${post.id}`);
                            if (newPostEl) {
                                newPostEl.querySelectorAll('.post-date, .comment-date').forEach(el => {
                                    const timestamp = el.getAttribute('data-timestamp');
                                    if (timestamp) {
                                        const date = new Date(parseInt(timestamp, 10));
                                        el.textContent = el.tagName === 'STRONG' ? date.toLocaleDateString('ko-KR') : date.toLocaleString('ko-KR');
                                    }
                                });
                            }
                        }

                        if (post.createdAt > latestPostTimestamp) {
                            latestPostTimestamp = post.createdAt;
                        }
                    });
                }
            }

            // 2. Process new comments
            if (data.newComments && data.newComments.length > 0) {
                data.newComments.sort((a, b) => a.createdAt - b.createdAt);

                data.newComments.forEach(comment => {
                    if (document.getElementById(`comment-${comment.id}`)) return;

                    const postEl = document.getElementById(`post-${comment.postId}`);
                    if (!postEl) return;

                    const commentsSection = postEl.querySelector('.comments-section');
                    if (!commentsSection) return;

                    const commentsList = commentsSection.querySelector('.comments-list');
                    if (commentsList) {
                        const noComments = commentsList.querySelector('.no-comments');
                        if (noComments) noComments.remove();

                        const usersMap = data.usersMap || {};
                        const avatarUrl = usersMap[comment.authorNickname] || null;
                        const avatarHTML = avatarUrl ? `<img src="${avatarUrl}" alt="Profile" style="width: ${comment.parentId ? '20px' : '24px'}; height: ${comment.parentId ? '20px' : '24px'}; border-radius: 50%; object-fit: cover; border: 1px solid var(--accent-color);" />` : '';
                        
                        let authorHTML = '';
                        if (comment.authorNickname && comment.authorId) {
                            authorHTML = `
                                ${avatarHTML}
                                <a href="/profile/${comment.authorId}" title="${comment.authorNickname} 님의 프로필 보기" style="color: var(--text-primary); font-weight: bold; text-decoration: underline;">
                                    ${comment.authorNickname}
                                </a>
                            `;
                        } else if (comment.authorNickname) {
                            authorHTML = comment.authorNickname;
                        } else {
                            authorHTML = `匿名 (${comment.authorIp})`;
                        }

                        const deleteFormHTML = comment.canDelete ? `
                            <form action="/comment/${comment.id}/delete" method="POST" style="display: inline; margin: 0;">
                                <input type="hidden" name="redirectType" value="${type || ''}" />
                                <button type="submit" class="comment-delete-btn" onclick="return confirm('이 댓글을 삭제하시겠습니까?')" style="background: transparent; border: 1px solid rgba(220, 53, 69, 0.3); color: #ff4d4d; font-size: 10.5px; padding: 2px 6px; border-radius: 3px; cursor: pointer; transition: all 0.2s;">
                                    삭제
                                </button>
                            </form>
                        ` : '';

                        const imageHTML = comment.imageUrl ? `
                            <div class="comment-image-container" style="margin-top: ${comment.parentId ? '4px' : '6px'}; margin-bottom: ${comment.parentId ? '4px' : '6px'}; ${comment.parentId ? 'padding-left: 14px;' : ''}">
                                <a href="${comment.imageUrl}" class="lightbox-trigger" title="클릭하여 확대">
                                    <img src="${comment.imageUrl}" alt="댓글 이미지" class="comment-thumbnail" />
                                </a>
                            </div>
                        ` : '';

                        let commentHTML = '';
                        if (comment.parentId) {
                            commentHTML = `
                                <div class="comment-item reply-item" id="comment-${comment.id}" style="margin-left: 20px; border-left: 2px dashed var(--accent-glow); background: rgba(255, 255, 255, 0.01); padding: 6px 10px; margin-top: 4px; border-radius: 0 4px 4px 0;">
                                    <div class="comment-header" style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; width: 100%;">
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <span class="reply-icon" style="color: var(--accent-color); font-weight: bold; font-size: 12px;">└</span>
                                            <span class="comment-author" style="display: inline-flex; align-items: center; gap: 4px;">
                                                ${authorHTML}
                                            </span>
                                            <span class="comment-date" data-timestamp="${comment.createdAt}"></span>
                                        </div>
                                        ${deleteFormHTML}
                                    </div>
                                    ${imageHTML}
                                    <div class="comment-text" style="padding-left: 14px; color: var(--text-primary); font-size: 12px;">${window.formatLinksAndEmbeds(window.escapeHTML(comment.content))}</div>
                                </div>
                            `;

                            const replyFormContainer = commentsList.querySelector(`#reply-form-${comment.parentId}`);
                            if (replyFormContainer) {
                                replyFormContainer.insertAdjacentHTML('beforebegin', commentHTML);
                            } else {
                                commentsList.insertAdjacentHTML('beforeend', commentHTML);
                            }
                        } else {
                            commentHTML = `
                                <div class="comment-item" id="comment-${comment.id}">
                                    <div class="comment-header" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                                        <div>
                                            <span class="comment-author" style="display: inline-flex; align-items: center; gap: 4px;">
                                                ${authorHTML}
                                            </span>
                                            <span class="comment-date" data-timestamp="${comment.createdAt}"></span>
                                        </div>
                                        <div style="display: flex; gap: 6px; align-items: center;">
                                            <button type="button" class="reply-toggle-btn" onclick="toggleReplyForm('${comment.id}')" style="background: transparent; border: 1px solid rgba(255,255,255,0.15); color: var(--text-secondary); font-size: 10.5px; padding: 2px 6px; border-radius: 3px; cursor: pointer; transition: all 0.2s;">
                                                답글
                                            </button>
                                            ${deleteFormHTML}
                                        </div>
                                    </div>
                                    ${imageHTML}
                                    <div class="comment-text" style="color: var(--text-primary); font-size: 12.5px;">${window.formatLinksAndEmbeds(window.escapeHTML(comment.content))}</div>
                                </div>
                                
                                <div id="reply-form-${comment.id}" class="reply-form-container" style="display: none; margin-left: 20px; margin-top: 6px; margin-bottom: 10px;">
                                    <form action="/post/${comment.postId}/comment" method="POST" enctype="multipart/form-data" class="comment-form" onsubmit="handleCommentSubmit(event, this)" style="display: flex; flex-direction: column; gap: 6px;">
                                        <input type="hidden" name="parentId" value="${comment.id}" />
                                        <input type="hidden" name="redirectType" value="${type || ''}" />
                                        <input type="hidden" name="commentImageUrl" class="comment-image-url-input" />
                                        
                                        <div style="display: flex; gap: 6px; width: 100%;">
                                            <div class="comment-input-wrapper" style="flex: 1; display: flex; align-items: center; background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; padding: 2px 8px; transition: border-color 0.2s;">
                                                <input type="text" name="content" placeholder="답글을 남기세요..." style="flex: 1; background: transparent; border: none; color: #fff; padding: 6px 0; font-size: 12px; outline: none; font-family: inherit;" onfocus="this.parentNode.style.borderColor='var(--accent-color)'" onblur="this.parentNode.style.borderColor='rgba(255, 255, 255, 0.1)'" />
                                                
                                                <div class="comment-preview-container" style="display: none; align-items: center; margin-right: 8px; position: relative;">
                                                    <img class="comment-preview-img" src="" style="width: 28px; height: 28px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2);" />
                                                    <button type="button" class="comment-preview-remove" style="position: absolute; top: -5px; right: -5px; background: rgba(10, 10, 10, 0.85); border: 1px solid rgba(255,255,255,0.2); border-radius: 50%; color: var(--accent-color); cursor: pointer; width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold; padding: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.5);" onclick="clearCommentImage(this)">✕</button>
                                                </div>
                                                
                                                <label style="font-size: 10px; color: var(--text-secondary); cursor: pointer; padding: 3px 5px; border-radius: 3px; display: inline-flex; align-items: center; transition: all 0.2s; white-space: nowrap; background: rgba(255,255,255,0.04);" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.04)'">
                                                    <span>이미지 첨부</span>
                                                    <input type="file" name="commentImage" accept="image/*" style="display: none;" onchange="updateCommentFileName(this)" />
                                                </label>
                                            </div>
                                            <button type="submit" class="comment-submit-btn" style="background: var(--button-gradient); border: 1px solid var(--button-border); border-radius: 4px; color: #fff; font-size: 11.5px; padding: 5px 10px; cursor: pointer; font-weight: bold; white-space: nowrap; height: 28px; display: inline-flex; align-items: center; justify-content: center;">답글</button>
                                        </div>
                                        <div class="comment-upload-progress-container" style="display: none; margin-top: 4px; width: 100%;">
                                            <div class="progress-bar-bg" style="background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 4px; padding: 2px; position: relative; overflow: hidden; height: 12px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);">
                                                <div class="comment-upload-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #aa0000, #ff3333); border-radius: 2px; transition: width 0.1s linear; box-shadow: 0 0 5px rgba(255, 51, 51, 0.6);"></div>
                                            </div>
                                            <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 10.5px; color: #ccc;">
                                                <span class="comment-upload-progress-text">업로드 준비 중... (0%)</span>
                                                <span class="comment-upload-progress-speed">0.00 MB/s</span>
                                            </div>
                                        </div>
                                    </form>
                                </div>
                            `;
                            
                            commentsList.insertAdjacentHTML('beforeend', commentHTML);
                        }

                        // Re-format timestamps for the newly prepended comment
                        const newCommentEl = document.getElementById(`comment-${comment.id}`);
                        if (newCommentEl) {
                            newCommentEl.querySelectorAll('.comment-date').forEach(el => {
                                const timestamp = el.getAttribute('data-timestamp');
                                if (timestamp) {
                                    const date = new Date(parseInt(timestamp, 10));
                                    el.textContent = date.toLocaleString('ko-KR');
                                }
                            });
                        }

                        if (comment.createdAt > latestCommentTimestamp) {
                            latestCommentTimestamp = comment.createdAt;
                        }
                    }
                });
            }

        } catch (err) {
            console.error('Post polling error:', err);
        } finally {
            isPostFetching = false;
        }
    }

    function scheduleNextPostPoll() {
        if (postTimeoutId) clearTimeout(postTimeoutId);
        postTimeoutId = setTimeout(async () => {
            await loadPostUpdates();
            scheduleNextPostPoll();
        }, getNextPostDelay());
    }

    function startPostPolling() {
        initializeTimestamps();
        loadPostUpdates();
        scheduleNextPostPoll();
    }

    const currentPostType = getPostTypeFromPath();
    if (currentPostType || getRenderedPostIds().length > 0) {
        startPostPolling();
    }

    if (chatForm) {
        const chatSendBtn = chatForm.querySelector('button');

        // Core send logic extracted so both submit and click can call it
        async function doSendMessage() {
            const content = chatInput.value.trim();
            if (!content || isSending) return;

            const isMobile = isMobileLayout();

            isSending = true;
            chatInput.disabled = true;
            if (chatSendBtn) chatSendBtn.disabled = true;

            try {
                const res = await fetch('/chat/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });
                if (res.ok) {
                    chatInput.value = '';
                    // On mobile: blur after successful send to dismiss keyboard cleanly
                    if (isMobile) chatInput.blur();
                    resetIdleTimer();
                    await loadChatMessages();
                } else {
                    console.error('Failed to send message:', res.status);
                }
            } catch (err) {
                console.error('Chat send error:', err);
            } finally {
                isSending = false;
                chatInput.disabled = false;
                if (chatSendBtn) chatSendBtn.disabled = false;
                // On desktop restore focus; on mobile avoid re-opening keyboard
                if (!isMobileLayout()) chatInput.focus();
            }
        }

        // Primary: form submit (Enter key / submit button)
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            doSendMessage();
        });

        // Fallback: direct button click — needed for Chrome Android where form submit
        // can silently fail inside position:absolute + overflow:hidden ancestors.
        if (chatSendBtn) {
            chatSendBtn.addEventListener('click', (e) => {
                // Only intercept if the form submit event won't fire (mobile Chrome fallback)
                if (isMobileLayout()) {
                    e.preventDefault();
                    doSendMessage();
                }
            });
        }
    }

    // ==========================================================================
    // 3. Carousel Lightbox & Multi-Image Pagination / View All Modal
    // ==========================================================================
    let currentImages = [];
    let currentImageIndex = 0;

    window.openLightbox = function(imagesArray, startIndex) {
        currentImages = imagesArray;
        currentImageIndex = startIndex;
        updateLightboxContent();
        
        const lightbox = document.getElementById('lightbox-carousel');
        if (lightbox) lightbox.style.display = 'flex';
    };

    window.closeLightbox = function() {
        const lightbox = document.getElementById('lightbox-carousel');
        if (lightbox) lightbox.style.display = 'none';
        currentImages = [];
    };

    window.navigateLightbox = function(dir) {
        if (currentImages.length <= 1) return;
        currentImageIndex = (currentImageIndex + dir + currentImages.length) % currentImages.length;
        updateLightboxContent();
    };

    function updateLightboxContent() {
        const imgEl = document.getElementById('lightbox-img');
        const indexEl = document.getElementById('lightbox-index');
        const totalEl = document.getElementById('lightbox-total');
        const prevArrow = document.querySelector('.lightbox-arrow.prev');
        const nextArrow = document.querySelector('.lightbox-arrow.next');

        if (imgEl && currentImages[currentImageIndex]) {
            imgEl.src = currentImages[currentImageIndex];
        }
        if (indexEl) {
            indexEl.textContent = (currentImageIndex + 1).toString();
        }
        if (totalEl) {
            totalEl.textContent = currentImages.length.toString();
        }

        // Hide navigation arrows if only 1 image
        if (prevArrow && nextArrow) {
            const displayStyle = currentImages.length > 1 ? 'flex' : 'none';
            prevArrow.style.display = displayStyle;
            nextArrow.style.display = displayStyle;
        }
    }

    // View All Modal handlers
    window.openViewAllModal = function(imagesArray) {
        const modal = document.getElementById('view-all-modal');
        const grid = modal ? modal.querySelector('.modal-images-grid') : null;
        if (!modal || !grid) return;

        grid.innerHTML = '';
        imagesArray.forEach((url, index) => {
            const container = document.createElement('div');
            container.className = 'grid-thumbnail-container';
            container.innerHTML = `<img src="${url}" alt="Thumbnail ${index + 1}" />`;
            container.onclick = () => {
                window.openLightbox(imagesArray, index);
            };
            grid.appendChild(container);
        });

        modal.style.display = 'flex';
    };

    window.closeViewAllModal = function() {
        const modal = document.getElementById('view-all-modal');
        if (modal) modal.style.display = 'none';
    };

    // Keyboard support for Lightbox
    document.addEventListener('keydown', (e) => {
        const lightbox = document.getElementById('lightbox-carousel');
        const viewAllModal = document.getElementById('view-all-modal');

        if (lightbox && lightbox.style.display === 'flex') {
            if (e.key === 'Escape') {
                window.closeLightbox();
            } else if (e.key === 'ArrowRight') {
                window.navigateLightbox(1);
            } else if (e.key === 'ArrowLeft') {
                window.navigateLightbox(-1);
            }
        } else if (viewAllModal && viewAllModal.style.display === 'flex') {
            if (e.key === 'Escape') {
                window.closeViewAllModal();
            }
        }
    });

    document.body.addEventListener('click', (e) => {
        // 1. Multi-image unfold (click on collapsed group or first image inside it)
        const collapsedGroup = e.target.closest('.post-images-group.collapsed');
        if (collapsedGroup) {
            e.preventDefault();
            collapsedGroup.classList.remove('collapsed');
            return;
        }

        // 2. Show More images click
        const showMoreBtn = e.target.closest('.show-more-images-btn');
        if (showMoreBtn) {
            e.preventDefault();
            const group = showMoreBtn.closest('.post-images-group');
            if (group) {
                const total = parseInt(group.dataset.totalImages, 10);
                let visible = parseInt(showMoreBtn.dataset.visibleCount, 10) || 5;
                visible += 5;
                showMoreBtn.dataset.visibleCount = visible;

                // Show containers up to visible count
                group.querySelectorAll('.post-image-container').forEach(container => {
                    const idx = parseInt(container.dataset.index, 10);
                    if (idx < visible) {
                        container.style.setProperty('display', 'block', 'important');
                    }
                });

                if (visible >= total) {
                    showMoreBtn.style.display = 'none';
                }
            }
            return;
        }

        // 3. View All images click
        const viewAllBtn = e.target.closest('.view-all-images-btn');
        if (viewAllBtn) {
            e.preventDefault();
            const group = viewAllBtn.closest('.post-images-group');
            if (group) {
                const urls = Array.from(group.querySelectorAll('.post-image-container a')).map(a => a.href);
                window.openViewAllModal(urls);
            }
            return;
        }

        // 4. Multi-image fold back
        const collapseBtn = e.target.closest('.collapse-images-btn');
        if (collapseBtn) {
            e.preventDefault();
            const group = collapseBtn.closest('.post-images-group');
            if (group) {
                group.classList.add('collapsed');
                
                // Clear any expanded thumbnails/containers inside this group
                group.querySelectorAll('.expanded').forEach(el => el.classList.remove('expanded'));
                
                // Clear expanded state on post body
                const postBody = group.closest('.post-body');
                if (postBody) {
                    postBody.classList.remove('has-expanded-image');
                }

                // Reset visible count and hide images >= 5
                const showMore = group.querySelector('.show-more-images-btn');
                if (showMore) {
                     showMore.dataset.visibleCount = '5';
                     showMore.style.display = 'inline-flex';
                }
                group.querySelectorAll('.post-image-container').forEach(container => {
                    const idx = parseInt(container.dataset.index, 10);
                    if (idx >= 5) {
                        container.style.setProperty('display', 'none', 'important');
                    } else {
                        // clear inline display property so collapsed rules apply
                        container.style.removeProperty('display');
                    }
                });

                const postItem = collapseBtn.closest('.community-post, .glass-borders');
                if (postItem) {
                    postItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
            return;
        }

        // 5. Image Click Handler (direct feed image click expands inline; grid modal opens lightbox)
        const trigger = e.target.closest('.lightbox-trigger');
        if (trigger) {
            e.preventDefault();
            const viewAllGrid = trigger.closest('.modal-images-grid');

            if (viewAllGrid) {
                // Clicking a thumbnail inside the View All Grid Modal opens the Lightbox Carousel
                const urls = Array.from(viewAllGrid.querySelectorAll('.grid-thumbnail-container img')).map(img => img.src);
                const index = parseInt(trigger.dataset.index, 10) || 0;
                window.openLightbox(urls, index);
            } else {
                // Direct clicks in the feed (single image, unfolded group, or comment image) toggle inline expansion (4chan style)
                const img = trigger.querySelector('.post-thumbnail, .comment-thumbnail');
                const container = trigger.closest('.post-image-container, .comment-image-container');
                const body = trigger.closest('.post-body, .comment-item');
                
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
            return;
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

