// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SILENCE CROSS-ORIGIN "Script error"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
window.addEventListener('error', function(e) {
    if (e.message === 'Script error.' && !e.filename) {
        e.preventDefault();
        return true;
    }
    console.warn('⚠️ Uncaught error:', e.message, e.filename, e.lineno);
    return false;
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. PARALLAX (with jQuery check)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function initParallax() {
    try {
        const scene = document.querySelector('.parallax-scene');
        if (scene && typeof Parallax !== 'undefined' && typeof jQuery !== 'undefined') {
            new Parallax(scene, {
                relativeInput: true,
                clipRelativeInput: true,
                calibrateX: true,
                calibrateY: true,
                invertX: false,
                invertY: false,
                limitX: 25,
                limitY: 25,
                scalarX: 10,
                scalarY: 10,
                frictionX: 0.1,
                frictionY: 0.1,
                originX: 0.5,
                originY: 0.5,
                precision: 1,
            });
            console.log('🌀 Parallax initialized');
        } else {
            console.warn('⚠️ Parallax or jQuery missing, skipping effect');
        }
    } catch (err) {
        console.warn('⚠️ Parallax init skipped:', err.message);
    }
})();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. DATA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const contacts = [{
    id: 1,
    name: 'Rahul',
    img: 'https://i.pravatar.cc/150?img=1',
    lastMsg: "Let's meet in the canteen",
    time: '10:32',
    unread: 2,
    online: true,
    color: 'linear-gradient(135deg,#f472b6,#ec4899)',
    messages: [
        { from: 'them', text: 'Hey! Are you free for lunch?', time: '10:15' },
        { from: 'me', text: 'Yes, where should we go?', time: '10:18' },
        { from: 'them', text: "Let's meet in the canteen", time: '10:32' },
    ]
}, {
    id: 2,
    name: 'Priya',
    img: 'https://i.pravatar.cc/150?img=5',
    lastMsg: 'replied to your story',
    time: '09:45',
    unread: 0,
    online: false,
    color: 'linear-gradient(135deg,#60a5fa,#3b82f6)',
    messages: [
        { from: 'them', text: 'Loved your story! 😍', time: '09:40' },
        { from: 'me', text: 'Thank you! 🙈', time: '09:42' },
        { from: 'them', text: 'replied to your story', time: '09:45' },
    ]
}, {
    id: 3,
    name: 'Rupali',
    img: 'https://i.pravatar.cc/150?img=10',
    lastMsg: 'Location',
    time: '09:12',
    unread: 0,
    online: true,
    color: 'linear-gradient(135deg,#34d399,#10b981)',
    messages: [
        { from: 'them', text: "I'm at the café near your office", time: '09:10' },
        { from: 'me', text: "On my way!", time: '09:12' },
        { from: 'them', text: 'Location', time: '09:12' },
    ]
}, {
    id: 4,
    name: 'Tushar',
    img: 'https://i.pravatar.cc/150?img=12',
    lastMsg: 'What about movie tonight?',
    time: 'Yesterday',
    unread: 3,
    online: true,
    color: 'linear-gradient(135deg,#6c3bf5,#3b82f6)',
    messages: [
        { from: 'them', text: "Hey Tushar! Have to talk to you about tomorrow's plan. Let's catch up?", time: '02:00' },
        { from: 'me', text: 'WASSUP BRO?', time: '02:10' },
        { from: 'them', text: 'What about movie tonight?', time: 'Yesterday' },
    ]
}, {
    id: 5,
    name: 'Kunal',
    img: 'https://i.pravatar.cc/150?img=20',
    lastMsg: 'Check India Won the match.',
    time: 'Yesterday',
    unread: 0,
    online: false,
    color: 'linear-gradient(135deg,#fb923c,#f97316)',
    messages: [
        { from: 'them', text: 'Did you see the match?', time: 'Yesterday' },
        { from: 'me', text: 'No, what happened?', time: 'Yesterday' },
        { from: 'them', text: 'Check India Won the match.', time: 'Yesterday' },
    ]
}, {
    id: 6,
    name: 'Parul',
    img: 'https://i.pravatar.cc/150?img=25',
    lastMsg: 'uploading files',
    time: 'Yesterday',
    unread: 0,
    online: true,
    color: 'linear-gradient(135deg,#a78bfa,#8b5cf6)',
    messages: [
        { from: 'them', text: "I'll send you the docs", time: 'Yesterday' },
        { from: 'me', text: 'Sure, thanks!', time: 'Yesterday' },
        { from: 'them', text: 'uploading files', time: 'Yesterday' },
    ]
}, {
    id: 7,
    name: 'Jasmine',
    img: 'https://i.pravatar.cc/150?img=30',
    lastMsg: 'Are you done with the notes?',
    time: 'Yesterday',
    unread: 1,
    online: false,
    color: 'linear-gradient(135deg,#f472b6,#db2777)',
    messages: [
        { from: 'them', text: 'Are you done with the notes?', time: 'Yesterday' },
        { from: 'me', text: 'Almost done!', time: 'Yesterday' },
    ]
}, {
    id: 8,
    name: 'Peter',
    img: 'https://i.pravatar.cc/150?img=11',
    lastMsg: 'Location',
    time: '09:12',
    unread: 0,
    online: true,
    color: 'linear-gradient(135deg,#34d399,#10b981)',
    messages: [
        { from: 'them', text: "I'm at the café near your office", time: '09:10' },
        { from: 'me', text: "On my way!", time: '09:12' },
        { from: 'them', text: 'Location', time: '09:12' },
    ]
}, {
    id: 9,
    name: 'Shiva',
    img: 'https://i.pravatar.cc/150?img=12',
    lastMsg: 'Location',
    time: '09:12',
    unread: 0,
    online: true,
    color: 'linear-gradient(135deg,#34d399,#10b981)',
    messages: [
        { from: 'them', text: "I'm at the café near your office", time: '09:10' },
        { from: 'me', text: "On my way!", time: '09:12' },
        { from: 'them', text: 'Location', time: '09:12' },
    ]
}, {
    id: 10,
    name: 'Kevin',
    img: 'https://i.pravatar.cc/150?img=13',
    lastMsg: 'Location',
    time: '09:12',
    unread: 0,
    online: true,
    color: 'linear-gradient(135deg,#34d399,#10b981)',
    messages: [
        { from: 'them', text: "I'm at the café near your office", time: '09:10' },
        { from: 'me', text: "On my way!", time: '09:12' },
        { from: 'them', text: 'Location', time: '09:12' },
    ]
}, ];

const myProfile = {
    name: 'Ravi Kant Gupta',
    phone: '+91 9995554443',
    img: 'https://i.pravatar.cc/150?img=11',
    color: 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
    time: 'Just now'
};

const callLogs = [
    { name: 'Priya', type: 'missed', time: '10:45', img: 'https://i.pravatar.cc/150?img=5' },
    { name: 'Rahul', type: 'incoming', time: '09:30', img: 'https://i.pravatar.cc/150?img=1' },
    { name: 'Kunal', type: 'outgoing', time: 'Yesterday', img: 'https://i.pravatar.cc/150?img=20' },
    { name: 'Tushar', type: 'incoming', time: 'Yesterday', img: 'https://i.pravatar.cc/150?img=12' },
    { name: 'Parul', type: 'missed', time: 'Yesterday', img: 'https://i.pravatar.cc/150?img=25' },
];

let activeContactId = 4;
let currentTab = 'chat';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. RENDER FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderChatList() {
    const container = document.getElementById('chatList');
    if (!container) return;
    container.innerHTML = '';
    contacts.forEach(c => {
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.dataset.id = c.id;
        div.innerHTML = `
                    <div class="avatar" style="background:${c.color};">
                        <img src="${c.img}" alt="${c.name}" loading="lazy" />
                        <span class="status-dot ${c.online ? '' : 'offline'}"></span>
                    </div>
                    <div class="info">
                        <div class="name">${c.name}${c.id === 4 ? '<span class="badge-ai">AI</span>' : ''}</div>
                        <div class="msg-preview">${c.lastMsg}</div>
                    </div>
                    <div class="meta">
                        <div class="time">${c.time}</div>
                        ${c.unread > 0 ? `<div class="unread">${c.unread}</div>` : ''}
                    </div>
                `;
        div.addEventListener('click', () => openChat(c.id));
        container.appendChild(div);
    });
    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

function renderCallList() {
    const container = document.getElementById('callList');
    if (!container) return;
    container.innerHTML = '';
    callLogs.forEach(call => {
        const div = document.createElement('div');
        div.className = 'call-item';
        const iconMap = { missed: 'fa-phone-slash', incoming: 'fa-phone-arrow-down', outgoing: 'fa-phone-arrow-up' };
        const labelMap = { missed: 'Missed', incoming: 'Incoming', outgoing: 'Outgoing' };
        div.innerHTML = `
                    <div class="call-icon ${call.type}">
                        <i class="fas ${iconMap[call.type]}"></i>
                    </div>
                    <div class="call-info">
                        <div class="call-name">${call.name}</div>
                        <div class="call-detail">${labelMap[call.type]} · ${call.time}</div>
                    </div>
                    <div class="call-time">${call.time}</div>
                `;
        container.appendChild(div);
    });
    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

function renderMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const contact = contacts.find(c => c.id === activeContactId);
    if (!contact) return;
    container.innerHTML = '';
    contact.messages.forEach((msg, index) => {
        const div = document.createElement('div');
        const isSent = msg.from === 'me';
        div.className = `msg ${isSent ? 'sent' : 'received'}`;
        div.style.animationDelay = `${index * 0.04}s`;
        div.innerHTML = `${msg.text}<span class="time-tag">${msg.time}</span>`;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;

    document.getElementById('chatName').textContent = contact.name;
    document.getElementById('chatStatus').textContent = `${contact.online ? 'Online' : 'Offline'} · ${contact.time}`;
    const avatarEl = document.getElementById('chatAvatar');
    avatarEl.style.background = contact.color;
    avatarEl.innerHTML = `<img src="${contact.img}" alt="${contact.name}" />`;

    document.getElementById('profileAvatar').style.background = contact.color;
    document.getElementById('profileAvatar').innerHTML = `<img src="${contact.img}" alt="${contact.name}" />`;
    document.getElementById('profileName').textContent = contact.name;
    document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> +91 9995554443`;
    document.getElementById('profileTime').innerHTML = `<i class="far fa-clock"></i> Last active: ${contact.time}`;

    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. NAVIGATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.list-footer .tab').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });
    const chatPanel = document.getElementById('chatPanel');
    const callsPanel = document.getElementById('callsPanel');
    if (tab === 'chat') {
        chatPanel.style.display = 'block';
        callsPanel.style.display = 'none';
        document.getElementById('searchInput').placeholder = 'Search chats...';
    } else if (tab === 'calls') {
        chatPanel.style.display = 'none';
        callsPanel.style.display = 'block';
        document.getElementById('searchInput').placeholder = 'Search calls...';
        renderCallList();
    } else if (tab === 'me') {
        openMyProfile();
        document.querySelectorAll('.list-footer .tab').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === 'me');
        });
    }
}

function openChat(id) {
    activeContactId = id;
    renderMessages();
    document.getElementById('chatView').classList.add('open');
    document.getElementById('listView').classList.add('shrink');
    document.querySelectorAll('.chat-item').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.id) === id);
    });
    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

function closeChat() {
    document.getElementById('chatView').classList.remove('open');
    document.getElementById('listView').classList.remove('shrink');
    renderChatList();
}

function openMyProfile() {
    const panel = document.getElementById('profilePanel');
    document.getElementById('profileAvatar').style.background = myProfile.color;
    document.getElementById('profileAvatar').innerHTML = `<img src="${myProfile.img}" alt="${myProfile.name}" />`;
    document.getElementById('profileName').textContent = myProfile.name;
    document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${myProfile.phone}`;
    document.getElementById('profileTime').innerHTML = `<i class="far fa-clock"></i> Last active: ${myProfile.time}`;
    panel.classList.add('open');
    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

function toggleProfile(open) {
    if (!open) {
        document.getElementById('profilePanel').classList.remove('open');
        if (currentTab === 'me') switchTab('chat');
    } else {
        document.getElementById('profilePanel').classList.add('open');
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. SEND MESSAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function sendMessage() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text) return;
    const contact = contacts.find(c => c.id === activeContactId);
    if (!contact) return;
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    contact.messages.push({ from: 'me', text, time: timeStr });
    contact.lastMsg = text;
    contact.time = timeStr;
    input.value = '';
    renderMessages();
    renderChatList();
    if (text.toLowerCase().includes('ai') || text.toLowerCase().includes('help')) {
        setTimeout(() => {
            const replies = [
                '🤖 I\'m your AI assistant! How can I help?',
                '🧠 Great question! Let me think…',
                '✨ AI is here! Would you like a smart reply?',
                '📊 I can summarize this chat if you want!'
            ];
            const reply = replies[Math.floor(Math.random() * replies.length)];
            contact.messages.push({ from: 'them', text: reply, time: new Date().getHours().toString().padStart(2, '0') +
                    ':' + new Date().getMinutes().toString().padStart(2, '0') });
            renderMessages();
            renderChatList();
        }, 800 + Math.random() * 1200);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. FAB (click only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initFab() {
    const fab = document.getElementById('fabButton');
    if (!fab) return;
    // Simple click handler – opens dialpad on every click/tap
    fab.addEventListener('click', function(e) {
        document.getElementById('dialpadOverlay').classList.add('open');
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. DIALPAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initDialpad() {
    const overlay = document.getElementById('dialpadOverlay');
    const display = document.getElementById('dialpadDisplay');
    if (!overlay || !display) return;
    let number = '';

    document.getElementById('dialpadClose').addEventListener('click', () => {
        overlay.classList.remove('open');
        number = '';
        display.textContent = '';
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('open');
            number = '';
            display.textContent = '';
        }
    });

    document.querySelectorAll('.dial-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.value;
            number += val;
            display.textContent = number;
        });
    });

    document.getElementById('dialDelete').addEventListener('click', () => {
        number = number.slice(0, -1);
        display.textContent = number;
    });

    document.getElementById('dialCall').addEventListener('click', () => {
        if (number.trim()) {
            alert(`📞 Calling ${number}... (WebRTC ready)`);
            overlay.classList.remove('open');
            number = '';
            display.textContent = '';
        } else {
            alert('Please enter a number');
        }
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. SETTINGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initSettings() {
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const theme = this.dataset.theme;
            applyTheme(theme);
            localStorage.setItem('neonTheme', theme);
        });
    });

    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === savedTheme);
    });
    applyTheme(savedTheme);

    document.querySelectorAll('.toggle-switch input').forEach(input => {
        const key = input.id || 'toggle_' + Math.random();
        const saved = localStorage.getItem(key);
        if (saved !== null) input.checked = saved === 'true';
        input.addEventListener('change', function() {
            localStorage.setItem(this.id || 'toggle_' + Math.random(), this.checked);
        });
    });

    const langSelect = document.querySelector('.lang-select');
    const savedLang = localStorage.getItem('neonLang') || 'en';
    if (langSelect) {
        langSelect.value = savedLang;
        langSelect.addEventListener('change', function() {
            localStorage.setItem('neonLang', this.value);
        });
    }

    document.querySelector('.logout-btn')?.addEventListener('click', () => {
        if (confirm('Logout? (Demo)')) {
            alert('Logged out! (Demo)');
            localStorage.clear();
            location.reload();
        }
    });
}

function applyTheme(theme) {
    const app = document.getElementById('app');
    const body = document.body;
    if (!app) return;
    app.style.background = '';
    app.style.backdropFilter = '';
    body.style.background = '';

    if (theme === 'light') {
        app.style.background = 'rgba(240, 242, 247, 0.85)';
        app.style.backdropFilter = 'blur(28px) saturate(1.6)';
        body.style.background = '#e8ecf1';
        document.querySelectorAll('.msg.received').forEach(el => {
            el.style.background = 'rgba(0,0,0,0.04)';
            el.style.color = '#1a1832';
            el.style.borderColor = 'rgba(0,0,0,0.08)';
        });
        document.querySelectorAll('.chat-item .info .name').forEach(el => el.style.color = '#1a1832');
        document.querySelectorAll('.msg-preview').forEach(el => el.style.color = '#4a4a6a');
        document.querySelectorAll('.chat-name').forEach(el => el.style.color = '#1a1832');
        document.querySelectorAll('.logo span').forEach(el => {
            el.style.background = 'linear-gradient(135deg, #6c3bf5, #3b82f6)';
            el.style.webkitBackgroundClip = 'text';
            el.style.webkitTextFillColor = 'transparent';
        });
        document.querySelectorAll('.setting-item span').forEach(el => el.style.color = '#1a1832');
        document.querySelectorAll('.settings-header').forEach(el => el.style.color = '#6c3bf5');
        document.getElementById('fabButton').style.boxShadow = '0 8px 32px rgba(108, 59, 245, 0.3)';
        document.querySelectorAll('.status-badge').forEach(el => {
            el.style.color = '#1a1832';
            el.style.background = 'rgba(0,0,0,0.06)';
        });
        document.querySelectorAll('.status-dot-badge').forEach(el => {
            el.style.border = '1px solid rgba(0,0,0,0.1)';
        });
    } else if (theme === 'neon') {
        app.style.background = 'rgba(20, 8, 50, 0.85)';
        app.style.backdropFilter = 'blur(28px) saturate(1.8)';
        body.style.background = '#0a0520';
        document.querySelectorAll('.msg.received').forEach(el => {
            el.style.background = 'rgba(139, 92, 246, 0.12)';
            el.style.color = '#d4c4ff';
            el.style.borderColor = 'rgba(139, 92, 246, 0.2)';
        });
        document.querySelectorAll('.chat-item .info .name').forEach(el => el.style.color = '#e4d4ff');
        document.querySelectorAll('.msg-preview').forEach(el => el.style.color = '#9a8abe');
        document.querySelectorAll('.chat-name').forEach(el => el.style.color = '#e4d4ff');
        document.querySelectorAll('.logo span').forEach(el => {
            el.style.background = 'linear-gradient(135deg, #c084fc, #f472b6)';
            el.style.webkitBackgroundClip = 'text';
            el.style.webkitTextFillColor = 'transparent';
        });
        document.querySelectorAll('.setting-item span').forEach(el => el.style.color = '#d4c4ff');
        document.querySelectorAll('.settings-header').forEach(el => el.style.color = '#c084fc');
        document.getElementById('fabButton').style.boxShadow = '0 0 40px rgba(192, 132, 252, 0.6), 0 0 80px rgba(192, 132, 252, 0.2)';
        document.querySelectorAll('.status-badge').forEach(el => {
            el.style.color = '#d4c4ff';
            el.style.background = 'rgba(139, 92, 246, 0.15)';
        });
        document.querySelectorAll('.status-dot-badge').forEach(el => {
            el.style.border = '1px solid rgba(192, 132, 252, 0.3)';
        });
    } else {
        app.style.background = 'rgba(12, 10, 28, 0.7)';
        app.style.backdropFilter = 'blur(28px) saturate(1.6)';
        body.style.background = '#07050e';
        document.querySelectorAll('.msg.received').forEach(el => {
            el.style.background = 'rgba(255, 255, 255, 0.06)';
            el.style.color = '#eef0f5';
            el.style.borderColor = 'rgba(255, 255, 255, 0.04)';
        });
        document.querySelectorAll('.chat-item .info .name').forEach(el => el.style.color = '#f0f2f7');
        document.querySelectorAll('.msg-preview').forEach(el => el.style.color = '#7a89a8');
        document.querySelectorAll('.chat-name').forEach(el => el.style.color = '#f0f2f7');
        document.querySelectorAll('.logo span').forEach(el => {
            el.style.background = 'linear-gradient(135deg, #a78bfa, #6ee7ff)';
            el.style.webkitBackgroundClip = 'text';
            el.style.webkitTextFillColor = 'transparent';
        });
        document.querySelectorAll('.setting-item span').forEach(el => el.style.color = '#d0d8ec');
        document.querySelectorAll('.settings-header').forEach(el => el.style.color = '#a78bfa');
        document.getElementById('fabButton').style.boxShadow = '0 8px 32px rgba(139, 92, 246, 0.4)';
        document.querySelectorAll('.status-badge').forEach(el => {
            el.style.color = '#7a89a8';
            el.style.background = 'rgba(255,255,255,0.06)';
        });
        document.querySelectorAll('.status-dot-badge').forEach(el => {
            el.style.border = '1px solid rgba(255,255,255,0.1)';
        });
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. REGISTRATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initRegistration() {
    const overlay = document.getElementById('regOverlay');
    const openBtn = document.getElementById('openRegForm');
    const closeBtn = document.getElementById('regClose');
    const submitBtn = document.getElementById('regSubmit');
    const otpSend = document.getElementById('otpSend');
    if (!openBtn || !closeBtn || !submitBtn || !otpSend) return;

    openBtn.addEventListener('click', () => overlay.classList.add('open'));
    closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
    });

    otpSend.addEventListener('click', () => {
        const phone = document.getElementById('regPhone').value.trim();
        if (!phone) { alert('Please enter phone number first'); return; }
        alert(`📱 OTP sent to ${phone} (Demo: 1234)`);
        document.getElementById('regOtp').value = '1234';
    });

    submitBtn.addEventListener('click', () => {
        const name = document.getElementById('regName').value.trim();
        const userid = document.getElementById('regUserid').value.trim();
        const phone = document.getElementById('regPhone').value.trim();
        const otp = document.getElementById('regOtp').value.trim();
        if (!name || !userid || !phone || !otp) { alert('Please fill all fields'); return; }
        if (otp !== '1234') { alert('Invalid OTP. Use 1234 (demo)'); return; }
        const userData = { name, userid, phone, registered: true, status: 'offline' };
        localStorage.setItem('neonUser', JSON.stringify(userData));
        updateStatusBadge(userData);
        overlay.classList.remove('open');
        document.getElementById('profileName').textContent = name;
        document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${phone}`;
        alert('✅ Registration successful! Welcome, ' + name);
    });
}

function updateStatusBadge(user) {
    const badge = document.getElementById('statusBadge');
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (!badge || !dot || !text) return;
    if (user && user.registered) {
        badge.style.display = 'inline-flex';
        const status = user.status || 'offline';
        dot.className = 'status-dot-badge ' + (status === 'online' ? 'online' : '');
        text.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        badge.style.cursor = 'pointer';
        badge.onclick = function(e) {
            e.stopPropagation();
            const current = user.status || 'offline';
            const newStatus = current === 'online' ? 'offline' : 'online';
            user.status = newStatus;
            localStorage.setItem('neonUser', JSON.stringify(user));
            updateStatusBadge(user);
        };
        const savedTheme = localStorage.getItem('neonTheme') || 'dark';
        applyTheme(savedTheme);
    } else {
        badge.style.display = 'none';
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. FAB TOGGLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initFabToggle() {
    const toggle = document.getElementById('fabToggle');
    const fab = document.getElementById('fabButton');
    if (!toggle || !fab) return;
    const saved = localStorage.getItem('fabVisible');
    if (saved !== null) {
        const visible = saved === 'true';
        toggle.checked = visible;
        fab.classList.toggle('hidden', !visible);
    }
    toggle.addEventListener('change', function() {
        const visible = this.checked;
        fab.classList.toggle('hidden', !visible);
        localStorage.setItem('fabVisible', visible);
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. TOGGLES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function toggleAiOverlay(open) {
    document.getElementById('aiOverlay').classList.toggle('open', open);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. EVENT LISTENERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setupEventListeners() {
    document.getElementById('backBtn').addEventListener('click', closeChat);
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('msgInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

    document.getElementById('openAiBtn').addEventListener('click', () => toggleAiOverlay(true));
    document.getElementById('openAiFromChat').addEventListener('click', () => toggleAiOverlay(true));
    document.getElementById('closeAiBtn').addEventListener('click', () => toggleAiOverlay(false));
    document.getElementById('aiOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) toggleAiOverlay(false);
    });

    document.getElementById('aiPromptSend').addEventListener('click', () => {
        const input = document.getElementById('aiPromptInput');
        const val = input.value.trim();
        if (!val) return;
        alert('🧠 AI: "' + val + '"\n\n(Simulated response)');
        input.value = '';
        toggleAiOverlay(false);
    });
    document.getElementById('aiPromptInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('aiPromptSend').click();
    });

    document.getElementById('openProfileBtn').addEventListener('click', () => toggleProfile(true));
    document.getElementById('closeProfileBtn').addEventListener('click', () => toggleProfile(false));
    document.getElementById('profilePanel').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) toggleProfile(false);
    });

    document.getElementById('aiSuggestion').addEventListener('click', () => {
        const contact = contacts.find(c => c.id === activeContactId);
        if (!contact) return;
        const summary =
            `📊 This chat has ${contact.messages.length} messages. Last: "${contact.messages[contact.messages.length-1]?.text || 'none'}"`;
        const now = new Date();
        const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2,
            '0');
        contact.messages.push({ from: 'them', text: '🤖 ' + summary, time: timeStr });
        renderMessages();
        renderChatList();
    });

    document.querySelector('.voice-btn').addEventListener('click', () => alert('🎤 Voice (WebRTC ready)'));
    document.querySelector('.call-btn').addEventListener('click', () => alert('📞 Call (WebRTC ready)'));
    document.querySelector('.video-btn').addEventListener('click', () => alert('📹 Video (WebRTC ready)'));

    document.querySelectorAll('.list-footer .tab').forEach(tab => {
        tab.addEventListener('click', function() { switchTab(this.dataset.tab); });
    });

    document.getElementById('searchInput').addEventListener('input', function() {
        const q = this.value.toLowerCase();
        if (currentTab === 'chat') {
            document.querySelectorAll('.chat-item').forEach(item => {
                const name = item.querySelector('.name')?.textContent?.toLowerCase() || '';
                item.style.display = name.includes(q) ? 'flex' : 'none';
            });
        } else if (currentTab === 'calls') {
            document.querySelectorAll('.call-item').forEach(item => {
                const name = item.querySelector('.call-name')?.textContent?.toLowerCase() || '';
                item.style.display = name.includes(q) ? 'flex' : 'none';
            });
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('profilePanel').classList.contains('open')) toggleProfile(false);
            else if (document.getElementById('aiOverlay').classList.contains('open')) toggleAiOverlay(false);
            else if (document.getElementById('chatView').classList.contains('open')) closeChat();
            else if (document.getElementById('dialpadOverlay').classList.contains('open')) {
                document.getElementById('dialpadOverlay').classList.remove('open');
                document.getElementById('dialpadDisplay').textContent = '';
            } else if (document.getElementById('regOverlay').classList.contains('open')) {
                document.getElementById('regOverlay').classList.remove('open');
            }
        }
    });

    console.log('✅ Sandesai · All event listeners attached');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 13. INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function init() {
    try {
        const savedUser = localStorage.getItem('neonUser');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                updateStatusBadge(user);
                document.getElementById('profileName').textContent = user.name || 'Ravi';
                document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${user.phone || '+91 9995554443'}`;
            } catch (e) {}
        }

        initFab();
        initDialpad();
        initSettings();
        initRegistration();
        initFabToggle();
        renderChatList();
        renderCallList();
        setupEventListeners();

        console.log('🚀 Sandesai · All systems ready');
    } catch (err) {
        console.error('❌ Init error:', err);
        alert('Something went wrong. Check console for details.');
    }
})();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CALL HISTORY INTEGRATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Override the existing renderCallList to show real call logs
const originalRenderCallList = renderCallList;
renderCallList = function() {
    const container = document.getElementById('callList');
    if (!container) return;

    // Use PremCall logs if available
    const logs = window.PremCall ? window.PremCall.getLogs() : [];
    container.innerHTML = '';

    if (!logs || logs.length === 0) {
        container.innerHTML =
            '<div style="text-align:center;color:#5a6885;padding:2rem 0;font-size:0.85rem;"><i class="fas fa-phone" style="display:block;font-size:1.8rem;margin-bottom:0.5rem;opacity:0.3;"></i>No calls yet</div>';
        return;
    }

    logs.slice(0, 20).forEach(log => {
        const div = document.createElement('div');
        div.className = 'call-item';
        const dir = log.direction || 'missed';
        const iconMap = {
            missed: 'fa-phone-slash',
            incoming: 'fa-phone-arrow-down',
            outgoing: 'fa-phone-arrow-up'
        };
        const labelMap = {
            missed: 'Missed',
            incoming: 'Incoming',
            outgoing: 'Outgoing'
        };
        const duration = log.duration || '—';
        const time = new Date(log.started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `
            <div class="call-icon ${dir}">
                <i class="fas ${iconMap[dir] || 'fa-phone'}"></i>
            </div>
            <div class="call-info" style="cursor:pointer;" data-logid="${log.id}">
                <div class="call-name">${log.number}</div>
                <div class="call-detail">${labelMap[dir] || 'Call'} · ${duration} · ${time}</div>
            </div>
            <div class="call-time">${time}</div>
        `;
        // Click to view details
        const info = div.querySelector('.call-info');
        info.addEventListener('click', function() {
            const logId = parseInt(this.dataset.logid);
            const fullLog = window.PremCall ? window.PremCall.getLogs().find(l => l.id === logId) : null;
            if (fullLog && window.openCallDetails) {
                window.openCallDetails(fullLog);
            }
        });
        container.appendChild(div);
    });
};

// Add call details modal opener
window.openCallDetails = function(log) {
    if (!log) return;
    const modal = document.createElement('div');
    modal.style.cssText =
        'position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,0.7);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div style="background:rgba(18,16,36,0.95);border:1px solid rgba(255,255,255,0.06);border-radius:24px;padding:1.5rem;max-width:400px;width:92%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 40px 80px rgba(0,0,0,0.6);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                <span style="font-weight:700;font-size:1.1rem;">${log.number}</span>
                <button id="detailsClose" style="background:rgba(255,255,255,0.04);border:none;color:#a5b3d0;width:32px;height:32px;border-radius:10px;font-size:1.1rem;cursor:pointer;">✕</button>
            </div>
            <div style="font-size:0.75rem;color:#7a89a8;margin-bottom:0.3rem;">
                ${log.direction === 'incoming' ? '📥 Incoming' : log.direction === 'outgoing' ? '📤 Outgoing' : '❌ Missed'} · 
                ${log.duration || '—'} · ${new Date(log.started).toLocaleString()}
                ${log.summary ? '<br><span style="color:#c4b5fd;font-size:0.7rem;">🧠 ' + log.summary + '</span>' : ''}
            </div>
            <div style="flex:1;min-height:0;overflow-y:auto;background:rgba(0,0,0,0.2);border-radius:12px;padding:0.6rem;margin:0.4rem 0;font-size:0.75rem;scrollbar-width:thin;">
                ${log.messages && log.messages.length ? log.messages.map(m => 
                    '<div style="padding:0.2rem 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="font-weight:600;color:' + (m.role === 'user' ? '#8b5cf6' : '#2fd992') + ';">' + (m.role === 'user' ? 'You' : (log.type === 'ragina' ? 'RAGina' : 'Live')) + ':</span> ' + m.text + '</div>'
                ).join('') : '<div style="color:#5a6885;text-align:center;padding:0.8rem;">No transcript</div>'}
            </div>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.4rem;">
                <button class="details-call" style="padding:0.35rem 0.9rem;border-radius:30px;border:none;font-weight:600;font-size:0.75rem;cursor:pointer;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;">📞 Call</button>
                <button class="details-msg" style="padding:0.35rem 0.9rem;border-radius:30px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:#a5b3d0;font-weight:500;font-size:0.75rem;cursor:pointer;">💬 Msg</button>
                <button class="details-export-txt" style="padding:0.35rem 0.9rem;border-radius:30px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:#a5b3d0;font-weight:500;font-size:0.75rem;cursor:pointer;">📄 TXT</button>
                <button class="details-export-json" style="padding:0.35rem 0.9rem;border-radius:30px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:#a5b3d0;font-weight:500;font-size:0.75rem;cursor:pointer;">📄 JSON</button>
                <button class="details-share" style="padding:0.35rem 0.9rem;border-radius:30px;border:1px solid rgba(79,140,247,0.2);background:transparent;color:#8b5cf6;font-weight:500;font-size:0.75rem;cursor:pointer;">↗ Share</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Close
    modal.querySelector('#detailsClose').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Call
    modal.querySelector('.details-call').addEventListener('click', () => {
        modal.remove();
        if (window.PremCall) {
            const num = log.number;
            document.getElementById('dialText').innerHTML = num;
            if (window.dialedNumber !== undefined) window.dialedNumber = num;
            PremCall.call(num);
        }
    });

    // Message
    modal.querySelector('.details-msg').addEventListener('click', () => {
        modal.remove();
        // Switch to chat tab
        if (window.switchTab) switchTab('chat');
        // Pre-fill search with number
        const search = document.getElementById('searchInput');
        if (search) search.value = log.number;
        // Simulate search
        if (search) search.dispatchEvent(new Event('input'));
    });

    // Export TXT
    modal.querySelector('.details-export-txt').addEventListener('click', () => {
        if (window.PremCall) PremCall.exportLog(log, 'txt');
    });

    // Export JSON
    modal.querySelector('.details-export-json').addEventListener('click', () => {
        if (window.PremCall) PremCall.exportLog(log, 'json');
    });

    // Share
    modal.querySelector('.details-share').addEventListener('click', async () => {
        if (!window.PremCall) return;
        const text = window.PremCall.logText ? window.PremCall.logText(log) : 'Call transcript';
        if (navigator.share) {
            try { await navigator.share({ title: 'Call Transcript', text }); return; } catch (e) {}
        }
        try { await navigator.clipboard.writeText(text);
            showToast('Copied!'); } catch (e) {
            window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
        }
    });
};

// Override the tab switching to refresh calls when switching to calls tab
const originalSwitchTab = switchTab;
switchTab = function(tab) {
    originalSwitchTab(tab);
    if (tab === 'calls') {
        renderCallList();
    }
};

// Add call history entry from PremCall
window.addHistoryEntry = function(number, direction, duration, logId) {
    // This is called from PremCall - just refresh the call list
    if (document.getElementById('callsPanel').style.display !== 'none') {
        setTimeout(renderCallList, 300);
    }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 14 INIT CALLING ON LOAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
document.addEventListener('DOMContentLoaded', function() {
    // Check for registered number
    const stored = localStorage.getItem('premCallNumber');
    const verified = localStorage.getItem('premCallVerified') === 'true';
    if (stored && verified && window.PremCall) {
        document.getElementById('myNumberDisplay').textContent = stored;
        PremCall.init(stored);
    } else if (window.PremCall) {
        PremCall.init('0000000000');
    }

    // Call screen button handlers
    document.getElementById('hangupCallBtn')?.addEventListener('click', () => {
        if (window.PremCall) PremCall.hangup();
        vibrate(15);
    });

    document.getElementById('muteBtn')?.addEventListener('click', function() {
        if (!window.PremCall) return;
        const m = PremCall.mute();
        this.classList.toggle('active', m);
        this.innerHTML = m ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
        showToast(m ? 'Muted' : 'Unmuted');
    });

    document.getElementById('speakerBtn')?.addEventListener('click', function() {
        if (!window.PremCall) return;
        const s = PremCall.speaker();
        this.classList.toggle('active', s);
        showToast(s ? 'Speaker on' : 'Speaker off');
    });

    document.getElementById('videoBtn')?.addEventListener('click', function() {
        if (!window.PremCall) return;
        const v = PremCall.video();
        this.classList.toggle('active', v);
        this.innerHTML = v ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
        showToast(v ? 'Video on' : 'Video off');
    });

    document.getElementById('answerBtn')?.addEventListener('click', () => {
        if (window.PremCall) PremCall.answer();
    });

    document.getElementById('rejectBtn')?.addEventListener('click', () => {
        if (window.PremCall) PremCall.reject();
        showToast('Call declined');
    });
});