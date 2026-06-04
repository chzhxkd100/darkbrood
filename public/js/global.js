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
            playAeroSound('click');
        });
        
        // Close menu if clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (asideMenu.classList.contains('open') && !asideMenu.contains(e.target)) {
                asideMenu.classList.remove('open');
            }
        });
    }

    // ==========================================================================
    // 2. Web Audio API synthesized sound FX (Zero file downloads required!)
    // ==========================================================================
    let audioCtx = null;
    let soundEnabled = localStorage.getItem('soundEnabled') === 'true';
    const navSoundToggle = document.getElementById('navSoundToggle');
    
    // Update button label initially
    if (navSoundToggle) {
        navSoundToggle.textContent = soundEnabled ? '소리 끄기 (Sounds On)' : '소리 켜기 (Sounds Off)';
        
        navSoundToggle.addEventListener('click', () => {
            soundEnabled = !soundEnabled;
            localStorage.setItem('soundEnabled', soundEnabled);
            navSoundToggle.textContent = soundEnabled ? '소리 끄기 (Sounds On)' : '소리 켜기 (Sounds Off)';
            
            // Initialize AudioContext if it's the first time enabling sounds
            if (soundEnabled && !audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            showNotification(soundEnabled ? 'Aero 사운드가 활성화되었습니다.' : 'Aero 사운드가 음소거되었습니다.');
            playAeroSound('click');
        });
    }

    function initAudioContext() {
        if (!audioCtx && soundEnabled) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // Synthesize retro UI sounds using simple oscillators
    function playAeroSound(type) {
        return; // Disabled cute synthesized sounds as requested
        if (!soundEnabled) return;
        
        try {
            initAudioContext();
            if (!audioCtx) return;
            
            // Resume if suspended (browser security autoplay policies)
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            const now = audioCtx.currentTime;
            
            if (type === 'hover') {
                // Quick glossy light blip sound (Vista style hover)
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);
                
                gainNode.gain.setValueAtTime(0.04, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                
                osc.start(now);
                osc.stop(now + 0.08);
            } else if (type === 'click') {
                // Vista navigation drop/click sound
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);
                
                gainNode.gain.setValueAtTime(0.12, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                
                osc.start(now);
                osc.stop(now + 0.15);
            } else if (type === 'error') {
                // Windows error synthesized chord (double low pulse)
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(150, now);
                gainNode.gain.setValueAtTime(0.08, now);
                gainNode.gain.linearRampToValueAtTime(0.001, now + 0.2);
                
                osc.start(now);
                osc.stop(now + 0.2);
            }
        } catch (e) {
            console.error('Sound playback failed', e);
        }
    }

    // Attach sound triggers to all buttons, navigation items and links
    const interactiveElements = document.querySelectorAll('#navigationMenu a, .nav-sound-fx-container button, .submit-btn, .admin-del-btn, .comment-submit-btn, .wmp-btn');
    
    interactiveElements.forEach(el => {
        el.addEventListener('mouseenter', () => {
            playAeroSound('hover');
        });
        
        el.addEventListener('click', () => {
            playAeroSound('click');
        });
    });

    // Handle form failures to show error sound
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', (e) => {
            // Just general click feel on form submits
            playAeroSound('click');
        });
    });

    // ==========================================================================
    // 3. Theme Switcher (Cycle through the 4 solitude themes)
    // ==========================================================================
    const themes = [
        { class: '', name: '기본 다크 에어로 (Dark Aero)' },
        { class: 'theme-solitude', name: '고독의 회색 유리 (Solitude Glass)' },
        { class: 'theme-bloodred', name: '심연의 핏빛 그라데이션 (Blood Red Vista)' },
        { class: 'theme-deepocean', name: '심해의 아비살 블루 (Deep Ocean)' }
    ];
    
    let currentThemeIndex = 0;
    const savedThemeClass = localStorage.getItem('selectedTheme');
    
    // Apply saved theme on startup
    if (savedThemeClass) {
        const index = themes.findIndex(t => t.class === savedThemeClass);
        if (index > -1) {
            currentThemeIndex = index;
            document.body.className = savedThemeClass;
        }
    }
    
    const navThemeChanger = document.getElementById('navThemeChanger');
    if (navThemeChanger) {
        navThemeChanger.addEventListener('click', () => {
            // Cycle index
            currentThemeIndex = (currentThemeIndex + 1) % themes.length;
            const newTheme = themes[currentThemeIndex];
            
            // Apply
            document.body.className = newTheme.class;
            localStorage.setItem('selectedTheme', newTheme.class);
            
            // Visual notification
            showNotification(`테마가 변경되었습니다: ${newTheme.name}`);
            playAeroSound('click');
        });
    }

    // Toast Notification Banner Helper
    const themeSongCaption = document.getElementById('themeSongCaption');
    let notificationTimeout = null;
    
    function showNotification(message) {
        if (!themeSongCaption) return;
        
        themeSongCaption.textContent = message;
        themeSongCaption.classList.add('visible');
        
        clearTimeout(notificationTimeout);
        notificationTimeout = setTimeout(() => {
            themeSongCaption.classList.remove('visible');
        }, 3000);
    }

    // ==========================================================================
    // 4. Windows Media Player 11 Styled Music Player
    // ==========================================================================
    const bgmAudio = document.getElementById('bgmAudio');
    const wmpPlay = document.getElementById('wmpPlay');
    const wmpPrev = document.getElementById('wmpPrev');
    const wmpNext = document.getElementById('wmpNext');
    const wmpVolume = document.getElementById('wmpVolume');
    const wmpTrackName = document.getElementById('wmpTrackName');
    const visualizer = document.querySelector('.wmp-visualizer');
    
    const tracklist = [
        { name: 'Solitude Ambient.mp3', url: 'https://assets.mixkit.co/music/preview/mixkit-deep-ambient-loop-1175.mp3' },
        { name: 'Hatred Whispers.mp3', url: 'https://assets.mixkit.co/music/preview/mixkit-sinister-mystery-1191.mp3' },
        { name: 'Abyssal Drone.mp3', url: 'https://assets.mixkit.co/music/preview/mixkit-cold-tension-1185.mp3' }
    ];
    
    let currentTrackIndex = 0;
    let isPlaying = false;
    
    if (bgmAudio && wmpPlay) {
        // Synchronize initial volume slider
        bgmAudio.volume = wmpVolume ? parseFloat(wmpVolume.value) : 0.5;
        
        wmpPlay.addEventListener('click', () => {
            // Audio context activation check for autoplay
            if (soundEnabled && !audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            if (isPlaying) {
                pauseBgm();
            } else {
                playBgm();
            }
        });
        
        wmpVolume.addEventListener('input', (e) => {
            bgmAudio.volume = parseFloat(e.target.value);
        });
        
        wmpPrev.addEventListener('click', () => {
            currentTrackIndex = (currentTrackIndex - 1 + tracklist.length) % tracklist.length;
            changeTrack();
        });
        
        wmpNext.addEventListener('click', () => {
            currentTrackIndex = (currentTrackIndex + 1) % tracklist.length;
            changeTrack();
        });
        
        // Listeners for BGM audio object events
        bgmAudio.addEventListener('play', () => {
            isPlaying = true;
            wmpPlay.textContent = '⏸';
            visualizer.classList.add('playing-visualizer');
        });
        
        bgmAudio.addEventListener('pause', () => {
            isPlaying = false;
            wmpPlay.textContent = '▶';
            visualizer.classList.remove('playing-visualizer');
        });
    }
    
    function playBgm() {
        bgmAudio.play()
            .then(() => {
                showNotification(`재생 중: ${tracklist[currentTrackIndex].name}`);
            })
            .catch(err => {
                console.log('Autoplay blocked. User gesture required first.', err);
                showNotification('플레이어 재생 버튼을 한 번 더 눌러주세요.');
            });
    }
    
    function pauseBgm() {
        bgmAudio.pause();
    }
    
    function changeTrack() {
        const track = tracklist[currentTrackIndex];
        bgmAudio.src = track.url;
        wmpTrackName.textContent = track.name;
        
        if (isPlaying) {
            playBgm();
        } else {
            showNotification(`곡 선택 완료: ${track.name}`);
        }
    }
});
