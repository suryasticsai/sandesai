// ================================================================
// SANDESAI · Full App (Chat + Calls + Contacts + Settings + Firebase Messaging)
// ================================================================

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. PARALLAX (safe fallback)
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
// 2. DATA – default contacts & saved contacts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const defaultContacts = [
    { id: 1, name: 'Rahul', img: 'https://i.pravatar.cc/150?img=1', lastMsg: "Let's meet in the canteen", time: '10:32', unread: 2, online: true, color: 'linear-gradient(135deg,#f472b6,#ec4899)', messages: [{ from: 'them', text: 'Hey! Are you free for lunch?', time: '10:15' }, { from: 'me', text: 'Yes, where should we go?', time: '10:18' }, { from: 'them', text: "Let's meet in the canteen", time: '10:32' }] },
    { id: 2, name: 'Priya', img: 'https://i.pravatar.cc/150?img=5', lastMsg: 'replied to your story', time: '09:45', unread: 0, online: false, color: 'linear-gradient(135deg,#60a5fa,#3b82f6)', messages: [{ from: 'them', text: 'Loved your story! 😍', time: '09:40' }, { from: 'me', text: 'Thank you! 🙈', time: '09:42' }, { from: 'them', text: 'replied to your story', time: '09:45' }] },
    { id: 3, name: 'Rupali', img: 'https://i.pravatar.cc/150?img=10', lastMsg: 'Location', time: '09:12', unread: 0, online: true, color: 'linear-gradient(135deg,#34d399,#10b981)', messages: [{ from: 'them', text: "I'm at the café near your office", time: '09:10' }, { from: 'me', text: "On my way!", time: '09:12' }, { from: 'them', text: 'Location', time: '09:12' }] },
    { id: 4, name: 'Tushar', img: 'https://i.pravatar.cc/150?img=12', lastMsg: 'What about movie tonight?', time: 'Yesterday', unread: 3, online: true, color: 'linear-gradient(135deg,#6c3bf5,#3b82f6)', messages: [{ from: 'them', text: "Hey Tushar! Have to talk to you about tomorrow's plan. Let's catch up?", time: '02:00' }, { from: 'me', text: 'WASSUP BRO?', time: '02:10' }, { from: 'them', text: 'What about movie tonight?', time: 'Yesterday' }] },
    { id: 5, name: 'Kunal', img: 'https://i.pravatar.cc/150?img=20', lastMsg: 'Check India Won the match.', time: 'Yesterday', unread: 0, online: false, color: 'linear-gradient(135deg,#fb923c,#f97316)', messages: [{ from: 'them', text: 'Did you see the match?', time: 'Yesterday' }, { from: 'me', text: 'No, what happened?', time: 'Yesterday' }, { from: 'them', text: 'Check India Won the match.', time: 'Yesterday' }] },
    { id: 6, name: 'Parul', img: 'https://i.pravatar.cc/150?img=25', lastMsg: 'uploading files', time: 'Yesterday', unread: 0, online: true, color: 'linear-gradient(135deg,#a78bfa,#8b5cf6)', messages: [{ from: 'them', text: "I'll send you the docs", time: 'Yesterday' }, { from: 'me', text: 'Sure, thanks!', time: 'Yesterday' }, { from: 'them', text: 'uploading files', time: 'Yesterday' }] },
    { id: 7, name: 'Jasmine', img: 'https://i.pravatar.cc/150?img=30', lastMsg: 'Are you done with the notes?', time: 'Yesterday', unread: 1, online: false, color: 'linear-gradient(135deg,#f472b6,#db2777)', messages: [{ from: 'them', text: 'Are you done with the notes?', time: 'Yesterday' }, { from: 'me', text: 'Almost done!', time: 'Yesterday' }] },
    { id: 8, name: 'Peter', img: 'https://i.pravatar.cc/150?img=11', lastMsg: 'Location', time: '09:12', unread: 0, online: true, color: 'linear-gradient(135deg,#34d399,#10b981)', messages: [{ from: 'them', text: "I'm at the café near your office", time: '09:10' }, { from: 'me', text: "On my way!", time: '09:12' }, { from: 'them', text: 'Location', time: '09:12' }] },
    { id: 9, name: 'Shiva', img: 'https://i.pravatar.cc/150?img=12', lastMsg: 'Location', time: '09:12', unread: 0, online: true, color: 'linear-gradient(135deg,#34d399,#10b981)', messages: [{ from: 'them', text: "I'm at the café near your office", time: '09:10' }, { from: 'me', text: "On my way!", time: '09:12' }, { from: 'them', text: 'Location', time: '09:12' }] },
    { id: 10, name: 'Kevin', img: 'https://i.pravatar.cc/150?img=13', lastMsg: 'Location', time: '09:12', unread: 0, online: true, color: 'linear-gradient(135deg,#34d399,#10b981)', messages: [{ from: 'them', text: "I'm at the café near your office", time: '09:10' }, { from: 'me', text: "On my way!", time: '09:12' }, { from: 'them', text: 'Location', time: '09:12' }] },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SAVED CONTACTS (localStorage)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getSavedContacts() {
    try { return JSON.parse(localStorage.getItem('savedContacts')) || []; } catch (e) { return []; }
}

function saveContact(name, number, username) {
    const contacts = getSavedContacts();
    if (contacts.find(c => c.number === number)) {
        showToast('Contact already saved');
        return false;
    }
    contacts.push({ name, number, username: username || '', id: Date.now() });
    localStorage.setItem('savedContacts', JSON.stringify(contacts));
    renderChatList();
    renderCallList();
    showToast('✅ Contact saved: ' + name);
    return true;
}

function deleteContact(number) {
    let contacts = getSavedContacts();
    contacts = contacts.filter(c => c.number !== number);
    localStorage.setItem('savedContacts', JSON.stringify(contacts));
    renderChatList();
    renderCallList();
    showToast('Contact removed');
}

function getContactName(number) {
    const saved = getSavedContacts();
    const found = saved.find(c => c.number === number);
    return found ? found.name : null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MERGE CONTACTS (default + saved)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getAllContacts() {
    const saved = getSavedContacts();
    const all = [...defaultContacts];
    saved.forEach(sc => {
        if (!all.find(c => c.name === sc.name || (c.number && c.number === sc.number))) {
            all.push({
                id: sc.id,
                name: sc.name,
                img: 'https://i.pravatar.cc/150?img=' + (sc.id % 70),
                lastMsg: 'Saved contact',
                time: '—',
                unread: 0,
                online: false,
                color: 'linear-gradient(135deg,#a78bfa,#8b5cf6)',
                messages: [],
                isSaved: true,
                number: sc.number
            });
        }
    });
    return all;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let activeContactId = 4;
let currentTab = 'chat';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RENDER CHAT LIST (with Firestore conversations)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderChatList() {
    const container = document.getElementById('chatList');
    if (!container) return;

    // Get conversations from Firestore (if available)
    const conversations = window._firestoreConversations || {};

    // Build contact list: show all contacts (default + saved), but if they have Firestore messages, show last message
    const allContacts = getAllContacts();
    container.innerHTML = '';

    // We need to merge: for each contact, if we have a conversation in Firestore, use that last message.
    // For contacts without a conversation, show the default last message.

    // Create a map of phone -> latest message from Firestore
    const convMap = {};
    Object.keys(conversations).forEach(peer => {
        const msgs = conversations[peer];
        if (msgs && msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            convMap[peer] = {
                text: last.text || '',
                time: last.timestamp ? new Date(last.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
                direction: last.direction || 'incoming',
            };
        }
    });

    // Also include any contacts from saved contacts that might not be in defaultContacts
    const allNumbers = new Set();
    allContacts.forEach(c => { if (c.number) allNumbers.add(c.number); });
    // Also add any numbers from Firestore conversations
    Object.keys(convMap).forEach(num => allNumbers.add(num));

    // Build a list of contacts to display: for each number in allNumbers, find the contact or create one.
    const displayContacts = [];
    allNumbers.forEach(num => {
        let contact = allContacts.find(c => c.number === num);
        if (!contact) {
            // Create a temporary contact for this number
            contact = {
                id: Date.now() + Math.random(),
                name: num,
                img: 'https://i.pravatar.cc/150?img=' + Math.floor(Math.random() * 70),
                lastMsg: convMap[num] ? convMap[num].text : 'Start chat',
                time: convMap[num] ? convMap[num].time : '—',
                unread: 0,
                online: false,
                color: 'linear-gradient(135deg,#a78bfa,#8b5cf6)',
                messages: [],
                isSaved: false,
                number: num
            };
        } else {
            // Update lastMsg and time from Firestore if available
            if (convMap[num]) {
                contact.lastMsg = convMap[num].text;
                contact.time = convMap[num].time;
            }
        }
        displayContacts.push(contact);
    });

    // Sort by latest message time (Firestore timestamp or default)
    displayContacts.sort((a, b) => {
        const timeA = convMap[a.number] ? convMap[a.number].timestamp || 0 : 0;
        const timeB = convMap[b.number] ? convMap[b.number].timestamp || 0 : 0;
        return timeB - timeA;
    });

    displayContacts.forEach(c => {
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.dataset.id = c.id;
        div.dataset.number = c.number || '';
        const savedBadge = c.isSaved ? '<span class="contact-saved-badge">⭐</span>' : '';
        div.innerHTML = `
            <div class="avatar" style="background:${c.color};">
                <img src="${c.img}" alt="${c.name}" loading="lazy" />
                <span class="status-dot ${c.online ? '' : 'offline'}"></span>
            </div>
            <div class="info">
                <div class="name">${c.name} ${savedBadge}${c.id === 4 ? '<span class="badge-ai">AI</span>' : ''}</div>
                <div class="msg-preview">${c.lastMsg || ' '}</div>
            </div>
            <div class="meta">
                <div class="time">${c.time || '—'}</div>
                ${c.unread > 0 ? `<div class="unread">${c.unread}</div>` : ''}
            </div>
        `;
        div.addEventListener('click', () => {
            const number = c.number || c.name; // fallback
            if (number) openChat(number);
        });
        container.appendChild(div);
    });

    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RENDER MESSAGES (from Firestore)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const contact = window._activeChatPeer; // phone number of active chat
    if (!contact) {
        container.innerHTML = '';
        return;
    }

    const conversations = window._firestoreConversations || {};
    const msgs = conversations[contact] || [];
    container.innerHTML = '';
    msgs.forEach((msg, index) => {
        const div = document.createElement('div');
        const isSent = msg.direction === 'outgoing';
        div.className = `msg ${isSent ? 'sent' : 'received'}`;
        div.style.animationDelay = `${index * 0.04}s`;
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        div.innerHTML = `${msg.text}<span class="time-tag">${time}</span>`;
        if (msg.pending) {
            div.style.opacity = '0.6';
        }
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;

    // Update chat header
    const name = getContactName(contact) || contact;
    document.getElementById('chatName').textContent = name;
    document.getElementById('chatStatus').textContent = `Chatting with ${contact}`;
    const avatarEl = document.getElementById('chatAvatar');
    const color = 'linear-gradient(135deg,#8b5cf6,#6d28d9)';
    avatarEl.style.background = color;
    avatarEl.innerHTML = `<span style="font-size:1.2rem;font-weight:700;">${name.charAt(0).toUpperCase()}</span>`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIREBASE MESSAGING INTEGRATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let firebaseInitialized = false;
let db = null;
let auth = null;
let myNumber = null;
let conversations = {};
let conversationListeners = {};
let activeChatPeer = null;

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDc2vue40jIyuVCnU-frnbC5o0aNzovUNk",
    authDomain: "premcall-msg.firebaseapp.com",
    projectId: "premcall-msg",
    storageBucket: "premcall-msg.firebasestorage.app",
    messagingSenderId: "50980568455",
    appId: "1:50980568455:web:723fb612e7df28169d6722"
};

function initFirebaseMessaging() {
    if (firebaseInitialized) return;
    if (typeof firebase === 'undefined') {
        console.warn('Firebase not loaded');
        return;
    }
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.firestore();
        auth = firebase.auth();
        db.enablePersistence({ synchronizeTabs: true }).catch(err => console.warn('Persistence error:', err));
        firebaseInitialized = true;
        console.log('🔥 Firebase initialized');
        startMessaging();
    } catch (e) {
        console.error('Firebase init error:', e);
    }
}

function startMessaging() {
    // Get registered number from localStorage
    const stored = localStorage.getItem('premCallNumber');
    const verified = localStorage.getItem('premCallVerified') === 'true';
    if (!stored || !verified) {
        console.warn('Not registered, skip messaging');
        return;
    }
    myNumber = stored;
    document.getElementById('myNumberDisplay').textContent = myNumber;

    // Anonymous auth
    auth.signInAnonymously().then(cred => {
        const uid = cred.user.uid;
        console.log('Auth success, UID:', uid);
        // Map UID to number
        return db.collection('uids').doc(uid).get().then(doc => {
            if (doc.exists) {
                const mapped = doc.data().number;
                if (mapped !== myNumber) {
                    return Promise.reject(new Error('Number mismatch: ' + mapped + ' vs ' + myNumber));
                }
            } else {
                // Create mapping
                const batch = db.batch();
                batch.set(db.collection('users').doc(myNumber), { uid: uid });
                batch.set(db.collection('uids').doc(uid), { number: myNumber });
                return batch.commit();
            }
        });
    }).then(() => {
        console.log('Messaging ready');
        // Presence
        db.collection('presence').doc(myNumber).set({ lastSeen: Date.now() }, { merge: true });
        setInterval(() => {
            db.collection('presence').doc(myNumber).set({ lastSeen: Date.now() }, { merge: true });
        }, 15000);

        // Start listening to conversations list
        listenConversationsList();
        renderChatList();
    }).catch(err => {
        console.error('Messaging init error:', err);
        showToast('Messaging error: ' + err.message);
    });
}

function listenConversationsList() {
    if (!db || !myNumber) return;
    db.collection('messages')
        .where('participants', 'array-contains', myNumber)
        .onSnapshot(snapshot => {
            const latestByPeer = {};
            snapshot.docs.forEach(doc => {
                const d = doc.data();
                const peer = d.from === myNumber ? d.to : d.from;
                if (!latestByPeer[peer] || d.timestamp > latestByPeer[peer].timestamp) {
                    latestByPeer[peer] = {
                        peer: peer,
                        text: d.text,
                        timestamp: d.timestamp,
                        direction: d.from === myNumber ? 'outgoing' : 'incoming',
                    };
                }
            });
            // Update conversations with latest messages
            Object.keys(latestByPeer).forEach(peer => {
                if (!conversations[peer]) conversations[peer] = [];
                // We only need to ensure the last message is up to date, but we keep all messages from the per-peer listener
                // We'll just update the last message in the conversation array if needed.
                // Actually, we don't store all messages in this listener – only the latest per peer.
                // We'll let the per-peer listeners handle full message history.
                // But we should ensure the peer exists in conversations so renderChatList shows the last message.
                // So we will just store the last message as a single-entry array? Better: we'll keep the full history from the per-peer listener.
                // This listener is just for the conversation list (last message).
                // We'll store a separate map for last messages.
                if (!window._firestoreConversations) window._firestoreConversations = {};
                // The per-peer listener will populate full history; here we just need to trigger re-render.
                // But we also need to know the last message for each peer.
                // We'll store lastMsg in a separate object for quick access.
                if (!window._firestoreLastMessages) window._firestoreLastMessages = {};
                window._firestoreLastMessages[peer] = {
                    text: latestByPeer[peer].text,
                    timestamp: latestByPeer[peer].timestamp,
                    direction: latestByPeer[peer].direction,
                };
            });
            // Re-render chat list
            renderChatList();
        }, err => {
            console.error('Conversation list listener error:', err);
        });
}

function listenPeerConversation(peer) {
    if (conversationListeners[peer]) {
        // Already listening
        return;
    }
    if (!db || !myNumber) return;
    const convId = [myNumber, peer].sort().join('_');
    const unsub = db.collection('messages')
        .where('conversationId', '==', convId)
        .orderBy('timestamp', 'asc')
        .onSnapshot(snapshot => {
            const msgs = snapshot.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    text: d.text,
                    timestamp: d.timestamp,
                    direction: d.from === myNumber ? 'outgoing' : 'incoming',
                    from: d.from,
                };
            });
            // Store in conversations
            conversations[peer] = msgs;
            if (!window._firestoreConversations) window._firestoreConversations = {};
            window._firestoreConversations[peer] = msgs;
            // If this peer is active, re-render messages
            if (activeChatPeer === peer) {
                renderMessages();
            }
            // Update chat list with latest message
            renderChatList();
        }, err => {
            console.error('Conversation listener error for ' + peer, err);
        });
    conversationListeners[peer] = unsub;
}

function openChat(peer) {
    if (!peer) return;
    // Ensure we have a conversation listener for this peer
    if (!conversationListeners[peer]) {
        listenPeerConversation(peer);
    }
    activeChatPeer = peer;
    window._activeChatPeer = peer;
    document.getElementById('chatView').classList.add('open');
    document.getElementById('listView').classList.add('shrink');
    // Render messages
    renderMessages();
    // Update chat header
    const name = getContactName(peer) || peer;
    document.getElementById('chatName').textContent = name;
    document.getElementById('chatStatus').textContent = `Chatting with ${peer}`;
    const avatarEl = document.getElementById('chatAvatar');
    const color = 'linear-gradient(135deg,#8b5cf6,#6d28d9)';
    avatarEl.style.background = color;
    avatarEl.innerHTML = `<span style="font-size:1.2rem;font-weight:700;">${name.charAt(0).toUpperCase()}</span>`;
    // Also update profile panel (contact details)
    const contact = getAllContacts().find(c => c.number === peer);
    if (contact) {
        document.getElementById('profileAvatar').style.background = contact.color;
        document.getElementById('profileAvatar').innerHTML = `<img src="${contact.img}" alt="${contact.name}" />`;
        document.getElementById('profileName').textContent = contact.name;
        document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${peer}`;
        document.getElementById('profileTime').innerHTML = `<i class="far fa-clock"></i> Last active: ${contact.time || 'Just now'}`;
    } else {
        document.getElementById('profileAvatar').style.background = 'linear-gradient(135deg,#8b5cf6,#6d28d9)';
        document.getElementById('profileAvatar').innerHTML = `<span style="font-size:1.5rem;font-weight:700;">${peer.charAt(0).toUpperCase()}</span>`;
        document.getElementById('profileName').textContent = peer;
        document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${peer}`;
        document.getElementById('profileTime').innerHTML = `<i class="far fa-clock"></i> Last active: Just now`;
    }
    // Focus input
    document.getElementById('msgInput').focus();
    // Apply theme
    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

function closeChat() {
    activeChatPeer = null;
    window._activeChatPeer = null;
    document.getElementById('chatView').classList.remove('open');
    document.getElementById('listView').classList.remove('shrink');
    // Re-render chat list to reflect any changes
    renderChatList();
}

function sendMessage() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text || !activeChatPeer || !db || !myNumber) return;
    const peer = activeChatPeer;
    // Optimistically add to UI
    if (!conversations[peer]) conversations[peer] = [];
    const tempMsg = {
        text: text,
        timestamp: Date.now(),
        direction: 'outgoing',
        from: myNumber,
        pending: true,
    };
    conversations[peer].push(tempMsg);
    if (!window._firestoreConversations) window._firestoreConversations = {};
    if (!window._firestoreConversations[peer]) window._firestoreConversations[peer] = [];
    window._firestoreConversations[peer].push(tempMsg);
    renderMessages();
    input.value = '';

    // Send to Firestore
    db.collection('messages').add({
        conversationId: [myNumber, peer].sort().join('_'),
        participants: [myNumber, peer],
        from: myNumber,
        to: peer,
        text: text,
        timestamp: Date.now()
    }).then(docRef => {
        // Update the pending message with the real ID
        const msgs = conversations[peer];
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].pending && msgs[i].text === text && msgs[i].timestamp === tempMsg.timestamp) {
                msgs[i].pending = false;
                msgs[i].id = docRef.id;
                break;
            }
        }
        renderMessages();
        renderChatList();
    }).catch(err => {
        console.error('Send error:', err);
        const msgs = conversations[peer];
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].pending && msgs[i].text === text && msgs[i].timestamp === tempMsg.timestamp) {
                msgs[i].error = true;
                msgs[i].pending = false;
                break;
            }
        }
        renderMessages();
        showToast('Send failed: ' + err.message);
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NAVIGATION (switching tabs)
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
        renderChatList();
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROFILE (loads from registration data)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function openMyProfile() {
    const panel = document.getElementById('profilePanel');
    const savedUser = localStorage.getItem('neonUser');
    let userName = 'User',
        userPhone = '';
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            userName = user.name || 'User';
            userPhone = user.phone || '';
        } catch (e) {}
    }
    const premNum = localStorage.getItem('premCallNumber');
    if (premNum && !userPhone) userPhone = premNum;

    const avatarEl = document.getElementById('profileAvatar');
    avatarEl.style.background = 'linear-gradient(135deg,#8b5cf6,#6d28d9)';
    avatarEl.innerHTML = `<span style="font-size:2.5rem;font-weight:700;color:#fff;">${userName.charAt(0).toUpperCase()}</span>`;
    document.getElementById('profileName').textContent = userName;
    document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${userPhone || '+91 9995554443'}`;
    document.getElementById('profileTime').innerHTML = `<i class="far fa-clock"></i> Last active: Just now`;

    const oldList = document.getElementById('savedContactsList');
    if (oldList) oldList.remove();

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
// SEND MESSAGE (original chat – kept for compatibility but overridden)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// We override sendMessage above with Firestore version.
// The old sendMessage is no longer used.

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RENDER CALL LIST (unchanged)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderCallList() {
    const container = document.getElementById('callList');
    if (!container) return;
    const logs = window.PremCall ? window.PremCall.getLogs() : [];
    container.innerHTML = '';

    if (!logs || logs.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#5a6885;padding:2rem 0;font-size:0.85rem;"><i class="fas fa-phone" style="display:block;font-size:1.8rem;margin-bottom:0.5rem;opacity:0.3;"></i>No calls yet</div>';
        return;
    }

    const groups = {};
    logs.forEach(log => {
        const num = log.number;
        if (!groups[num]) groups[num] = [];
        groups[num].push(log);
    });

    const sortedGroups = Object.keys(groups).sort((a, b) => {
        const aLatest = groups[a].reduce((max, l) => Math.max(max, l.started || 0), 0);
        const bLatest = groups[b].reduce((max, l) => Math.max(max, l.started || 0), 0);
        return bLatest - aLatest;
    });

    sortedGroups.forEach(number => {
        const calls = groups[number];
        const latest = calls.reduce((a, b) => (a.started > b.started ? a : b));
        const callCount = calls.length;
        const contactName = getContactName(number) || number;
        const displayName = contactName === number ? number : contactName;
        const missedCount = calls.filter(c => c.direction === 'missed').length;
        const hasMissed = missedCount > 0;
        const dir = latest.direction || 'incoming';
        const iconMap = { missed: 'fa-phone-slash', incoming: 'fa-phone-arrow-down', outgoing: 'fa-phone-arrow-up' };
        const time = new Date(latest.started).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const isSaved = getSavedContacts().some(c => c.number === number);
        const dirIcon = hasMissed ? 'fa-phone-slash' : (dir === 'incoming' ? 'fa-phone-arrow-down' : 'fa-phone-arrow-up');
        const dirClass = hasMissed ? 'missed' : (dir === 'incoming' ? 'incoming' : 'outgoing');

        const div = document.createElement('div');
        div.className = 'call-item';
        div.style.padding = '12px 0';
        div.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
        div.style.cursor = 'pointer';
        div.dataset.number = number;

        div.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
                <div class="call-icon ${dirClass}" style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.9rem;background:${isSaved ? 'rgba(47,217,146,0.08)' : 'rgba(255,255,255,0.04)'};color:${isSaved ? '#2fd992' : '#a5b3d0'};">
                    <i class="fas ${iconMap[dir] || 'fa-phone'}"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span style="font-weight:600;font-size:0.95rem;color:#f0f2f7;">${displayName}</span>
                        ${callCount > 1 ? `<span style="font-size:0.7rem;color:#5a6885;font-weight:500;">(${callCount})</span>` : ''}
                        ${isSaved ? '<span style="font-size:0.6rem;color:#2fd992;">⭐</span>' : ''}
                    </div>
                    <div style="font-size:0.75rem;color:#7a89a8;display:flex;align-items:center;gap:4px;margin-top:1px;">
                        <i class="fas ${dirIcon}" style="font-size:0.6rem;color:${hasMissed ? '#ef4444' : '#5a6885'};"></i>
                        ${hasMissed ? 'Missed · ' : ''}
                        ${time}
                    </div>
                </div>
                <div style="display:flex;gap:8px;flex-shrink:0;">
                    <button class="call-action-btn" data-action="call" data-number="${number}" style="background:rgba(47,217,146,0.08);border:none;color:#2fd992;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:0.8rem;transition:all 0.2s;"><i class="fas fa-phone"></i></button>
                    <button class="call-action-btn" data-action="message" data-number="${number}" style="background:rgba(139,92,246,0.08);border:none;color:#a78bfa;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:0.8rem;transition:all 0.2s;"><i class="fas fa-comment"></i></button>
                </div>
            </div>
        `;

        div.addEventListener('click', (e) => {
            if (e.target.closest('.call-action-btn')) return;
            const logId = latest.id;
            if (window.openCallDetails) {
                window.openCallDetails(logId);
            }
        });

        div.querySelectorAll('.call-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const num = btn.dataset.number;
                if (action === 'call') {
                    if (window.PremCall) PremCall.call(num);
                } else if (action === 'message') {
                    switchTab('chat');
                    // Open chat with this number
                    openChat(num);
                }
            });
        });

        container.appendChild(div);
    });

    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OPEN CALL DETAILS (unchanged)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
window.openCallDetails = function(logId) {
    const logs = window.PremCall ? window.PremCall.getLogs() : [];
    const log = logs.find(l => l.id === logId);
    if (!log) {
        showToast('Call log not found');
        return;
    }

    const number = log.number;
    const contactName = getContactName(number) || number;
    const isSaved = getSavedContacts().some(c => c.number === number);
    const allCallsForNumber = logs.filter(l => l.number === number);

    const modal = document.getElementById('callDetailsModal');
    const card = document.getElementById('callDetailsCard');

    const avatar = document.getElementById('detailsAvatar');
    avatar.textContent = contactName.charAt(0).toUpperCase();
    document.getElementById('detailsName').textContent = contactName === number ? 'Unknown' : contactName;
    document.getElementById('detailsNumber').textContent = '+91 ' + number;

    const saveStatus = document.getElementById('detailsSaveStatus');
    const saveBtn = document.getElementById('detailsSaveBtn');
    if (isSaved) {
        saveStatus.textContent = '⭐ Contact saved';
        saveBtn.textContent = 'Remove';
        saveBtn.style.background = 'rgba(239,68,68,0.15)';
        saveBtn.style.color = '#ef4444';
    } else {
        saveStatus.textContent = 'Not a contact';
        saveBtn.textContent = 'Save';
        saveBtn.style.background = 'linear-gradient(135deg,#7c3aed,#6d28d9)';
        saveBtn.style.color = '#fff';
    }
    saveBtn.onclick = () => {
        if (isSaved) {
            deleteContact(number);
            modal.classList.remove('active');
            renderCallList();
        } else {
            openSaveContactModal(number);
            modal.classList.remove('active');
        }
    };

    const historyContainer = document.getElementById('detailsCallList');
    historyContainer.innerHTML = '';
    allCallsForNumber.slice(0, 10).forEach(call => {
        const dir = call.direction || 'incoming';
        const iconMap = { missed: 'fa-phone-slash', incoming: 'fa-phone-arrow-down', outgoing: 'fa-phone-arrow-up' };
        const time = new Date(call.started).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.8rem;';
        item.innerHTML = `
            <i class="fas ${iconMap[dir] || 'fa-phone'}" style="color:${dir === 'missed' ? '#ef4444' : '#5a6885'};width:18px;"></i>
            <span style="flex:1;color:#f0f2f7;">${dir === 'missed' ? 'Missed' : dir === 'incoming' ? 'Incoming' : 'Outgoing'}</span>
            <span style="color:#5a6885;font-size:0.7rem;">${time}</span>
        `;
        historyContainer.appendChild(item);
    });

    const transcriptContainer = document.getElementById('detailsTranscript');
    transcriptContainer.innerHTML = '';
    if (log.messages && log.messages.length > 0) {
        log.messages.forEach(m => {
            const div = document.createElement('div');
            div.style.cssText = 'padding:0.2rem 0;border-bottom:1px solid rgba(255,255,255,0.04);';
            const sender = m.role === 'user' ? 'You' : (log.type === 'ragina' ? 'RAGina' : 'Live');
            const color = m.role === 'user' ? '#8b5cf6' : '#2fd992';
            div.innerHTML = `<span style="font-weight:600;color:${color};">${sender}:</span> ${m.text}`;
            transcriptContainer.appendChild(div);
        });
    } else {
        transcriptContainer.innerHTML = '<div style="color:#5a6885;text-align:center;padding:0.5rem;">No transcript for this call</div>';
    }

    const summaryContainer = document.getElementById('detailsSummary');
    if (log.summary) {
        summaryContainer.innerHTML = `<i class="fas fa-wand-magic-sparkles" style="color:#ffb648;margin-right:0.3rem;"></i> ${log.summary}`;
    } else {
        summaryContainer.innerHTML = '<span style="color:#5a6885;">No AI summary available</span>';
    }

    document.querySelectorAll('.details-export-btn').forEach(btn => {
        btn.onclick = () => {
            const format = btn.dataset.format;
            if (format === 'share') {
                const text = window.PremCall.logText ? window.PremCall.logText(log) : 'Call transcript';
                if (navigator.share) {
                    try { navigator.share({ title: 'Call Transcript', text }); return; } catch (e) {}
                }
                try { navigator.clipboard.writeText(text); showToast('Copied!'); } catch (e) {
                    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
                }
            } else {
                if (window.PremCall) PremCall.exportLog(log, format);
            }
        };
    });

    modal.querySelectorAll('.details-action-btn').forEach(btn => {
        btn.onclick = () => {
            const action = btn.dataset.action;
            if (action === 'call') {
                if (window.PremCall) PremCall.call(number);
                modal.classList.remove('active');
            } else if (action === 'message') {
                modal.classList.remove('active');
                switchTab('chat');
                openChat(number);
            } else if (action === 'video') {
                showToast('📹 Video call coming soon');
                modal.classList.remove('active');
            }
        };
    });

    modal.classList.add('active');
    setTimeout(() => { card.style.transform = 'translateY(0)'; }, 50);

    document.getElementById('detailsCloseModal').onclick = () => {
        modal.classList.remove('active');
        card.style.transform = 'translateY(100%)';
    };
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
            card.style.transform = 'translateY(100%)';
        }
    };
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SAVE CONTACT MODAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function openSaveContactModal(number) {
    const modal = document.getElementById('saveContactModal');
    document.getElementById('saveContactPhone').value = number;
    document.getElementById('saveContactName').value = '';
    document.getElementById('saveContactUsername').value = '';
    modal.classList.add('active');

    document.getElementById('saveContactClose').onclick = () => { modal.classList.remove('active'); };
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('active'); };

    document.getElementById('saveContactConfirm').onclick = () => {
        const name = document.getElementById('saveContactName').value.trim();
        const username = document.getElementById('saveContactUsername').value.trim();
        const phone = document.getElementById('saveContactPhone').value.trim();
        if (!name) { showToast('Please enter a name'); return; }
        if (!phone) { showToast('Please enter a phone number'); return; }
        const saved = saveContact(name, phone, username);
        if (saved) {
            modal.classList.remove('active');
            renderCallList();
            const logs = window.PremCall ? window.PremCall.getLogs() : [];
            const log = logs.find(l => l.number === phone);
            if (log) window.openCallDetails(log.id);
        }
    };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FAB & DIALPAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initFab() {
    const fab = document.getElementById('fabButton');
    if (!fab) return;
    fab.addEventListener('click', function() {
        document.getElementById('dialpadOverlay').classList.add('open');
    });
}

function initDialpad() {
    const overlay = document.getElementById('dialpadOverlay');
    const display = document.getElementById('dialpadDisplay');
    if (!overlay || !display) return;
    let number = '';

    const closeDialpad = () => {
        overlay.classList.remove('open');
        number = '';
        display.textContent = '';
    };

    document.getElementById('dialpadClose').addEventListener('click', closeDialpad);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialpad(); });

    document.querySelectorAll('.dial-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.value;
            number += val;
            display.textContent = number;
            if (window.PremCall) PremCall.playDtmf(val);
        });
    });

    document.getElementById('dialDelete').addEventListener('click', () => {
        number = number.slice(0, -1);
        display.textContent = number;
    });

    document.getElementById('dialCall').addEventListener('click', () => {
        if (number.trim()) {
            if (/^\d{10}$/.test(number)) {
                overlay.classList.remove('open');
                if (window.PremCall) PremCall.call(number);
            } else {
                showToast('Enter exactly 10 digits');
            }
        } else {
            showToast('Enter a number');
        }
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETTINGS & THEME
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
            showToast('Logged out');
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

    // Remove previous theme classes
    body.classList.remove('light-mode', 'neon-mode');
    if (theme === 'light') {
        body.classList.add('light-mode');
    } else if (theme === 'neon') {
        body.classList.add('neon-mode');
    }
    // dark is default
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REGISTRATION (persisted, one-time)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initRegistration() {
    const overlay = document.getElementById('regOverlay');
    const openBtn = document.getElementById('openRegForm');
    const closeBtn = document.getElementById('regClose');
    const submitBtn = document.getElementById('regSubmit');
    const otpSend = document.getElementById('otpSend');
    const regPhone = document.getElementById('regPhone');

    // Check if already registered – hide the "Registration" link if so
    const savedUser = localStorage.getItem('neonUser');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            if (user && user.registered) {
                const link = document.querySelector('.registration-link');
                if (link) link.style.display = 'none';
                document.getElementById('profileName').textContent = user.name;
                document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${user.phone}`;
                updateStatusBadge(user);
                if (window.PremCall && user.phone) {
                    localStorage.setItem('premCallNumber', user.phone);
                    localStorage.setItem('premCallVerified', 'true');
                    localStorage.setItem('premCallRegisteredAt', String(Date.now()));
                    PremCall.init(user.phone);
                    document.getElementById('myNumberDisplay').textContent = user.phone;
                    document.getElementById('headerStatusDot').className = 'status-dot connecting';
                }
                // Also initialize Firebase messaging if not already
                if (!firebaseInitialized) {
                    initFirebaseMessaging();
                }
            }
        } catch (e) {}
    }

    if (!openBtn || !closeBtn || !submitBtn || !otpSend) return;

    openBtn.addEventListener('click', () => {
        if (localStorage.getItem('neonUser')) {
            showToast('Already registered');
            return;
        }
        overlay.classList.add('open');
    });
    closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

    otpSend.addEventListener('click', () => {
        const phone = regPhone.value.trim();
        if (!phone || !/^\d{10}$/.test(phone)) {
            showToast('Please enter a valid 10-digit number');
            return;
        }
        showToast(`📱 OTP sent to ${phone} (Demo: 1234)`);
        document.getElementById('regOtp').value = '1234';
    });

    submitBtn.addEventListener('click', () => {
        const name = document.getElementById('regName').value.trim();
        const userid = document.getElementById('regUserid').value.trim();
        const phone = regPhone.value.trim();
        const otp = document.getElementById('regOtp').value.trim();
        if (!name || !userid || !phone || !otp) {
            showToast('Please fill all fields');
            return;
        }
        if (otp !== '1234') {
            showToast('Invalid OTP. Use 1234 (demo)');
            return;
        }
        const userData = { name, userid, phone, registered: true, status: 'offline' };
        localStorage.setItem('neonUser', JSON.stringify(userData));
        updateStatusBadge(userData);
        overlay.classList.remove('open');
        document.getElementById('profileName').textContent = name;
        document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${phone}`;
        showToast('✅ Registration successful! Welcome, ' + name);
        const link = document.querySelector('.registration-link');
        if (link) link.style.display = 'none';

        if (window.PremCall) {
            localStorage.setItem('premCallNumber', phone);
            localStorage.setItem('premCallVerified', 'true');
            localStorage.setItem('premCallRegisteredAt', String(Date.now()));
            PremCall.init(phone);
            document.getElementById('myNumberDisplay').textContent = phone;
            document.getElementById('headerStatusDot').className = 'status-dot connecting';
        }
        regPhone.disabled = true;

        // Initialize Firebase messaging after registration
        if (!firebaseInitialized) {
            initFirebaseMessaging();
        }
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
// FAB TOGGLE
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
// AI OVERLAY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function toggleAiOverlay(open) {
    const overlay = document.getElementById('aiOverlay');
    if (overlay) overlay.classList.toggle('open', open);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOAST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.cssText = 'position:fixed;bottom:calc(28px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%) translateY(20px);background:rgba(18,16,36,0.95);border:1px solid rgba(255,255,255,0.06);color:#eef0f5;padding:0.65rem 1.3rem;border-radius:40px;font-size:0.83rem;opacity:0;pointer-events:none;transition:opacity .25s ease,transform .25s ease;z-index:6000;max-width:88%;text-align:center;font-family:Inter,sans-serif;backdrop-filter:blur(12px);';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2200);
}
window.showToast = showToast;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ABOUT PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function toggleAboutPanel(open) {
    const overlay = document.getElementById('aboutOverlay');
    if (!overlay) return;
    const card = overlay.querySelector('.about-card');
    if (open) {
        overlay.style.display = 'flex';
        setTimeout(() => { card.style.transform = 'scale(1) translateY(0)'; }, 20);
        if (window.Parallax) {
            document.querySelectorAll('#aboutOverlay [data-depth]').forEach(el => {
                new Parallax(el, {
                    relativeInput: true,
                    clipRelativeInput: true,
                    calibrateX: true,
                    calibrateY: true,
                    invertX: false,
                    invertY: false,
                    limitX: 15,
                    limitY: 15,
                    scalarX: 6,
                    scalarY: 6,
                    frictionX: 0.1,
                    frictionY: 0.1,
                    originX: 0.5,
                    originY: 0.5,
                    precision: 1,
                });
            });
        }
    } else {
        card.style.transform = 'scale(0.92) translateY(20px)';
        setTimeout(() => { overlay.style.display = 'none'; }, 400);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEBUG CONSOLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initDebugConsole() {
    const toggle = document.getElementById('debugToggle');
    const consoleEl = document.getElementById('debugConsole');
    const body = document.getElementById('consoleBody');
    const closeBtn = document.getElementById('consoleClose');
    const clearBtn = document.getElementById('consoleClear');

    if (!toggle || !consoleEl) return;

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    function addLog(message, type = 'info') {
        if (!body) return;
        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
        body.appendChild(entry);
        body.scrollTop = body.scrollHeight;
    }

    console.log = function(...args) {
        originalLog.apply(console, args);
        addLog(args.join(' '), 'info');
    };
    console.error = function(...args) {
        originalError.apply(console, args);
        addLog(args.join(' '), 'error');
    };
    console.warn = function(...args) {
        originalWarn.apply(console, args);
        addLog(args.join(' '), 'warn');
    };

    window.addEventListener('error', function(e) {
        addLog(e.message || 'Uncaught error', 'error');
    });

    let isOpen = false;
    toggle.addEventListener('click', () => {
        isOpen = !isOpen;
        consoleEl.style.transform = isOpen ? 'translateY(0)' : 'translateY(100%)';
        toggle.innerHTML = isOpen ? '<i class="fas fa-times"></i>' : '<i class="fas fa-terminal"></i>';
    });

    closeBtn.addEventListener('click', () => {
        isOpen = false;
        consoleEl.style.transform = 'translateY(100%)';
        toggle.innerHTML = '<i class="fas fa-terminal"></i>';
    });

    clearBtn.addEventListener('click', () => {
        if (body) body.innerHTML = '';
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EVENT LISTENERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setupEventListeners() {
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.addEventListener('click', closeChat);

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    const msgInput = document.getElementById('msgInput');
    if (msgInput) msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

    const openAiBtn = document.getElementById('openAiBtn');
    if (openAiBtn) openAiBtn.addEventListener('click', () => toggleAiOverlay(true));
    const openAiFromChat = document.getElementById('openAiFromChat');
    if (openAiFromChat) openAiFromChat.addEventListener('click', () => toggleAiOverlay(true));
    const closeAiBtn = document.getElementById('closeAiBtn');
    if (closeAiBtn) closeAiBtn.addEventListener('click', () => toggleAiOverlay(false));
    const aiOverlay = document.getElementById('aiOverlay');
    if (aiOverlay) aiOverlay.addEventListener('click', (e) => { if (e.target === e.currentTarget) toggleAiOverlay(false); });

    const aiPromptSend = document.getElementById('aiPromptSend');
    if (aiPromptSend) {
        aiPromptSend.addEventListener('click', () => {
            const input = document.getElementById('aiPromptInput');
            if (!input) return;
            const val = input.value.trim();
            if (!val) return;
            showToast('🧠 AI: "' + val + '" (simulated)');
            input.value = '';
            toggleAiOverlay(false);
        });
    }
    const aiPromptInput = document.getElementById('aiPromptInput');
    if (aiPromptInput) {
        aiPromptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const btn = document.getElementById('aiPromptSend');
                if (btn) btn.click();
            }
        });
    }

    const openProfileBtn = document.getElementById('openProfileBtn');
    if (openProfileBtn) openProfileBtn.addEventListener('click', () => toggleProfile(true));
    const closeProfileBtn = document.getElementById('closeProfileBtn');
    if (closeProfileBtn) closeProfileBtn.addEventListener('click', () => toggleProfile(false));
    const profilePanel = document.getElementById('profilePanel');
    if (profilePanel) profilePanel.addEventListener('click', (e) => { if (e.target === e.currentTarget) toggleProfile(false); });

    const aiSuggestion = document.getElementById('aiSuggestion');
    if (aiSuggestion) {
        aiSuggestion.addEventListener('click', () => {
            const contact = getAllContacts().find(c => c.id === activeContactId);
            if (!contact) return;
            const summary = `📊 This chat has ${(contact.messages || []).length} messages. Last: "${contact.messages[contact.messages.length-1]?.text || 'none'}"`;
            const now = new Date();
            const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
            if (!contact.messages) contact.messages = [];
            contact.messages.push({ from: 'them', text: '🤖 ' + summary, time: timeStr });
            renderMessages();
            renderChatList();
        });
    }

    document.querySelector('.voice-btn')?.addEventListener('click', () => showToast('🎤 Voice (WebRTC ready)'));
    document.querySelector('.call-btn')?.addEventListener('click', () => showToast('📞 Call (WebRTC ready)'));
    document.querySelector('.video-btn')?.addEventListener('click', () => showToast('📹 Video (WebRTC ready)'));

    document.querySelectorAll('.list-footer .tab').forEach(tab => {
        tab.addEventListener('click', function() { switchTab(this.dataset.tab); });
    });

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
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
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('profilePanel')?.classList.contains('open')) toggleProfile(false);
            else if (document.getElementById('aiOverlay')?.classList.contains('open')) toggleAiOverlay(false);
            else if (document.getElementById('chatView')?.classList.contains('open')) closeChat();
            else if (document.getElementById('dialpadOverlay')?.classList.contains('open')) {
                document.getElementById('dialpadOverlay').classList.remove('open');
                document.getElementById('dialpadDisplay').textContent = '';
            } else if (document.getElementById('regOverlay')?.classList.contains('open')) {
                document.getElementById('regOverlay').classList.remove('open');
            } else if (document.getElementById('callDetailsModal')?.classList.contains('active')) {
                document.getElementById('callDetailsModal').classList.remove('active');
                document.getElementById('callDetailsCard').style.transform = 'translateY(100%)';
            } else if (document.getElementById('saveContactModal')?.classList.contains('active')) {
                document.getElementById('saveContactModal').classList.remove('active');
            } else if (document.getElementById('aboutOverlay')?.classList.contains('active')) {
                toggleAboutPanel(false);
            }
        }
    });

    // Call screen buttons
    document.getElementById('hangupCallBtn')?.addEventListener('click', () => {
        if (window.PremCall) PremCall.hangup();
        if (window.vibrate) vibrate(15);
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

    // About panel buttons
    const aboutBtn = document.getElementById('aboutBtn');
    if (aboutBtn) aboutBtn.addEventListener('click', () => toggleAboutPanel(true));
    const aboutClose = document.getElementById('aboutClose');
    if (aboutClose) aboutClose.addEventListener('click', () => toggleAboutPanel(false));
    const aboutOverlay = document.getElementById('aboutOverlay');
    if (aboutOverlay) aboutOverlay.addEventListener('click', (e) => { if (e.target === aboutOverlay) toggleAboutPanel(false); });

    // New Chat button
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', function() {
            if (!firebaseInitialized) {
                showToast('Messaging not ready, please register first');
                return;
            }
            const num = prompt('Enter 10-digit number to start a chat:');
            if (num && /^\d{10}$/.test(num.trim())) {
                const trimmed = num.trim();
                // Ensure we have a conversation listener for this peer
                if (!conversationListeners[trimmed]) {
                    listenPeerConversation(trimmed);
                }
                // Open chat
                openChat(trimmed);
            } else if (num) {
                showToast('Invalid number');
            }
        });
    }

    console.log('✅ Sandesai · All event listeners attached');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function init() {
    try {
        // Load saved user status for chat
        const savedUser = localStorage.getItem('neonUser');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                updateStatusBadge(user);
                document.getElementById('profileName').textContent = user.name || 'User';
                document.getElementById('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${user.phone || '+91 9995554443'}`;
                const link = document.querySelector('.registration-link');
                if (link) link.style.display = 'none';
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
        initDebugConsole();

        // Check for registered number for calling
        const stored = localStorage.getItem('premCallNumber');
        const verified = localStorage.getItem('premCallVerified') === 'true';
        if (stored && verified && window.PremCall) {
            document.getElementById('myNumberDisplay').textContent = stored;
            PremCall.init(stored);
            // Initialize Firebase messaging if not already
            if (!firebaseInitialized) {
                initFirebaseMessaging();
            }
        } else if (window.PremCall) {
            PremCall.init('0000000000');
        }

        console.log('🚀 Sandesai · All systems ready');
    } catch (err) {
        console.error('❌ Init error:', err);
    }
})();

// Expose functions globally for app.js integration
window.renderCallList = renderCallList;
window.openCallDetails = window.openCallDetails;
window.addHistoryEntry = function(number, direction, duration, logId) {
    setTimeout(renderCallList, 300);
};
window.getSavedContacts = getSavedContacts;
window.saveContact = saveContact;
window.deleteContact = deleteContact;
window.showToast = showToast;
window.getContactName = getContactName;
window.openChat = openChat;
window.closeChat = closeChat;
window.renderChatList = renderChatList;
window.renderMessages = renderMessages;
window.sendMessage = sendMessage;