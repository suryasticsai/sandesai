// ================================================================
// SCRIPT.JS – UI, Navigation, Contacts, Settings, Firebase Messaging,
//             Media (base64 inline), Call signaling
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
// 2. CONTACTS DATA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const defaultContacts = [];

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

function getAllContacts() {
    const saved = getSavedContacts();
    const all = [];
    saved.forEach(sc => {
        if (!all.find(c => c.number === sc.number)) {
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
// 3. STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let activeContactId = 4;
let currentTab = 'chat';
let activeChatPeer = null;
let firestoreConversations = {};
let conversationListeners = {};
let firebaseReady = false;
let db = null, auth = null;
let myNumber = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. FIREBASE MESSAGING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDc2vue40jIyuVCnU-frnbC5o0aNzovUNk",
    authDomain: "premcall-msg.firebaseapp.com",
    projectId: "premcall-msg",
    storageBucket: "premcall-msg.firebasestorage.app",
    messagingSenderId: "50980568455",
    appId: "1:50980568455:web:723fb612e7df28169d6722"
};

function initFirebaseMessaging() {
    if (firebaseReady) return;
    if (typeof firebase === 'undefined') {
        console.warn('Firebase not loaded');
        return;
    }
    try {
        if (!firebase.apps || firebase.apps.length === 0) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        db = firebase.firestore();
        auth = firebase.auth();
        db.enablePersistence({ synchronizeTabs: true }).catch(err => console.warn('Persistence error:', err));
        firebaseReady = true;
        console.log('🔥 Firebase initialized');
        startMessaging();
    } catch (e) {
        console.error('Firebase init error:', e);
        showToast('Firebase error: ' + (e.message || 'unknown'));
    }
}

function startMessaging() {
    const stored = localStorage.getItem('premCallNumber');
    const verified = localStorage.getItem('premCallVerified') === 'true';
    if (!stored || !verified) {
        console.warn('Not registered, skip messaging');
        return;
    }
    myNumber = stored;
    document.getElementById('myNumberDisplay').textContent = myNumber;

    auth.signInAnonymously().then(cred => {
        const uid = cred.user.uid;
        console.log('Auth success, UID:', uid);
        return db.collection('uids').doc(uid).get().then(doc => {
            if (doc.exists) {
                const mapped = doc.data().number;
                if (mapped !== myNumber) {
                    console.warn('Number mismatch: ' + mapped + ' vs ' + myNumber + '. Updating mapping...');
                    const batch = db.batch();
                    batch.update(db.collection('uids').doc(uid), { number: myNumber });
                    batch.set(db.collection('users').doc(myNumber), { uid: uid });
                    return batch.commit().then(() => {
                        console.log('✅ Mapping updated to new number: ' + myNumber);
                        showToast('Number updated in messaging system');
                    });
                } else {
                    return Promise.resolve();
                }
            } else {
                const batch = db.batch();
                batch.set(db.collection('users').doc(myNumber), { uid: uid });
                batch.set(db.collection('uids').doc(uid), { number: myNumber });
                return batch.commit();
            }
        });
    }).then(() => {
        console.log('Messaging ready');
        db.collection('presence').doc(myNumber).set({ lastSeen: Date.now() }, { merge: true });
        setInterval(() => {
            db.collection('presence').doc(myNumber).set({ lastSeen: Date.now() }, { merge: true });
        }, 15000);

        listenConversationsList();
        initCallSignaling();
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
            Object.keys(latestByPeer).forEach(peer => {
                if (!firestoreConversations[peer]) firestoreConversations[peer] = [];
                if (!window._firestoreLastMessages) window._firestoreLastMessages = {};
                window._firestoreLastMessages[peer] = {
                    text: latestByPeer[peer].text,
                    timestamp: latestByPeer[peer].timestamp,
                    direction: latestByPeer[peer].direction,
                };
            });
            renderChatList();
        }, err => {
            console.error('Conversation list listener error:', err);
        });
}

function listenPeerConversation(peer) {
    if (conversationListeners[peer]) return;
    if (!db || !myNumber) return;
    const convId = [myNumber, peer].sort().join('_');
    const unsub = db.collection('messages')
        .where('conversationId', '==', convId)
        .onSnapshot(snapshot => {
            const msgs = snapshot.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    text: d.text,
                    timestamp: d.timestamp,
                    direction: d.from === myNumber ? 'outgoing' : 'incoming',
                    from: d.from,
                    media: d.media || null,
                };
            });
            msgs.sort((a, b) => a.timestamp - b.timestamp);
            firestoreConversations[peer] = msgs;
            if (activeChatPeer === peer) {
                renderMessages();
            }
            renderChatList();
        }, err => {
            console.error('Conversation listener error for ' + peer, err);
        });
    conversationListeners[peer] = unsub;
}

function sendMessageToFirestore(peer, text) {
    if (!db || !myNumber || !peer) return;
    db.collection('messages').add({
        conversationId: [myNumber, peer].sort().join('_'),
        participants: [myNumber, peer],
        from: myNumber,
        to: peer,
        text: text,
        timestamp: Date.now()
    }).then(() => {
        showToast('Sent');
    }).catch(err => {
        console.error('Send error:', err);
        showToast('Send failed: ' + err.message);
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4b. MEDIA HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Firestore doc limit is 1 MB. Stay well under to leave room for metadata.
const MAX_INLINE_MEDIA_BYTES = 700 * 1024;

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function isInlineMediaType(mime) {
    if (!mime) return false;
    return /^image\//.test(mime) ||
           /^video\//.test(mime) ||
           /^audio\//.test(mime) ||
           mime === 'application/pdf';
}

async function handleAttachFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!activeChatPeer) { showToast('Open a chat first'); return; }

    for (const file of files) {
        try {
            const messageId = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

            // Small file → base64 inline (works cross-device)
            if (file.size <= MAX_INLINE_MEDIA_BYTES && isInlineMediaType(file.type)) {
                const dataUrl = await fileToBase64(file);
                await sendMediaMessageToFirestore(activeChatPeer, '📎 ' + (file.name || 'file'), {
                    name: file.name || 'file',
                    type: file.type || 'application/octet-stream',
                    size: file.size,
                    data: dataUrl,
                });
                showToast('📎 Sent: ' + (file.name || 'file'));
                continue;
            }

            // Large file → local save + reference + PeerJS if connected
            if (!window.MediaStore) { showToast('Media storage unavailable'); continue; }
            const mediaId = await window.MediaStore.saveMediaFile(file, activeChatPeer, messageId);
            const refText = '📎 ' + (file.name || 'file') + ' [media:' + mediaId + ']';
            sendMessageToFirestore(activeChatPeer, refText);

            if (window.PremCall && window.PremCall.getActiveDataConn &&
                window.PremCall.getActiveDataConn()) {
                try {
                    await window.PremCall.sendFile(file, activeChatPeer, (sent, total) => {
                        if (sent === total) showToast('📤 Sent: ' + file.name);
                    });
                } catch (err) {
                    console.warn('Peer transfer failed (local copy kept):', err);
                }
            }
            showToast('📎 Attached (large): ' + (file.name || 'file'));
        } catch (err) {
            console.error('Attach failed:', err);
            showToast('Attach failed: ' + (err.message || 'unknown'));
        }
    }
}

function sendMediaMessageToFirestore(peer, text, media) {
    if (!db || !myNumber || !peer) return Promise.reject(new Error('not ready'));
    return db.collection('messages').add({
        conversationId: [myNumber, peer].sort().join('_'),
        participants: [myNumber, peer],
        from: myNumber,
        to: peer,
        text: text,
        timestamp: Date.now(),
        media: media,
    });
}

function initIncomingFileListener() {
    window.addEventListener('sandesai:file-received', (e) => {
        const detail = e.detail || {};
        const mediaId = detail.mediaId;
        const meta = detail.meta || {};
        if (!mediaId) return;

        let peer = meta.chatId || null;
        if (!peer && window.PremCall && window.PremCall.getActiveDataConn) {
            const conn = window.PremCall.getActiveDataConn();
            if (conn && conn.peer) peer = conn.peer;
        }

        showToast('📥 Received: ' + (meta.fileName || 'file'));
        if (!peer) return;

        if (!firestoreConversations[peer]) firestoreConversations[peer] = [];
        firestoreConversations[peer].push({
            text: '📎 ' + (meta.fileName || 'file') + ' [media:' + mediaId + ']',
            timestamp: Date.now(),
            direction: 'incoming',
            from: peer
        });
        if (activeChatPeer === peer) renderMessages();
        renderChatList();
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4c. CALL SIGNALING (Firestore fallback ring)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let callSignalUnsub = null;

function initCallSignaling() {
    if (!db || !myNumber) return;
    if (callSignalUnsub) { try { callSignalUnsub(); } catch (e) {} callSignalUnsub = null; }

    callSignalUnsub = db.collection('call_signals')
        .where('to', '==', myNumber)
        .where('status', '==', 'ringing')
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const d = change.doc.data();
                    const overlay = document.getElementById('incomingOverlay');
                    if (overlay && !overlay.classList.contains('active')) {
                        if (window.PremCall && window.PremCall.showIncomingFromSignal) {
                            window.PremCall.showIncomingFromSignal(d.from, change.doc.id);
                        }
                    }
                }
                if (change.type === 'modified' || change.type === 'removed') {
                    const d = change.doc.data();
                    if (d && d.status && d.status !== 'ringing') {
                        if (window.PremCall && window.PremCall.dismissIncomingFromSignal) {
                            window.PremCall.dismissIncomingFromSignal(d.from);
                        }
                    }
                }
            });
        }, err => {
            console.warn('Call signal listener error:', err);
        });
}

async function sendCallSignal(toNumber) {
    if (!db || !myNumber || !toNumber) return null;
    try {
        const ref = await db.collection('call_signals').add({
            from: myNumber,
            to: toNumber,
            status: 'ringing',
            startedAt: Date.now(),
        });
        return ref.id;
    } catch (e) {
        console.warn('Send call signal failed:', e);
        return null;
    }
}

async function updateCallSignal(signalId, status) {
    if (!db || !signalId) return;
    try {
        await db.collection('call_signals').doc(signalId).set({
            status: status,
            updatedAt: Date.now(),
        }, { merge: true });
        if (status !== 'ringing') {
            setTimeout(() => {
                db.collection('call_signals').doc(signalId).delete().catch(() => {});
            }, 5000);
        }
    } catch (e) {}
}

window.SandesaiSignaling = {
    send: sendCallSignal,
    update: updateCallSignal,
    init: initCallSignaling,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. RENDER FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderChatList() {
    const container = document.getElementById('chatList');
    if (!container) return;

    const allContacts = getAllContacts();
    const convPeers = Object.keys(firestoreConversations);
    convPeers.forEach(num => {
        if (!allContacts.find(c => c.number === num)) {
            allContacts.push({
                id: Date.now() + Math.random(),
                name: num,
                img: 'https://i.pravatar.cc/150?img=' + Math.floor(Math.random() * 70),
                lastMsg: 'Start chat',
                time: '—',
                unread: 0,
                online: false,
                color: 'linear-gradient(135deg,#a78bfa,#8b5cf6)',
                messages: [],
                isSaved: false,
                number: num
            });
        }
    });

    allContacts.forEach(c => {
        if (c.number && firestoreConversations[c.number] && firestoreConversations[c.number].length > 0) {
            const last = firestoreConversations[c.number][firestoreConversations[c.number].length - 1];
            c.lastMsg = last.text || '';
            c.time = last.timestamp ? new Date(last.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
        }
    });

    allContacts.sort((a, b) => {
        const timeA = (a.number && firestoreConversations[a.number] && firestoreConversations[a.number].length > 0)
            ? firestoreConversations[a.number][firestoreConversations[a.number].length - 1].timestamp || 0
            : 0;
        const timeB = (b.number && firestoreConversations[b.number] && firestoreConversations[b.number].length > 0)
            ? firestoreConversations[b.number][firestoreConversations[b.number].length - 1].timestamp || 0
            : 0;
        return timeB - timeA;
    });

    container.innerHTML = '';
    allContacts.forEach(c => {
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
                <div class="name">${c.name} ${savedBadge}</div>
                <div class="msg-preview">${c.lastMsg || ' '}</div>
            </div>
            <div class="meta">
                <div class="time">${c.time || '—'}</div>
                ${c.unread > 0 ? `<div class="unread">${c.unread}</div>` : ''}
            </div>
        `;
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            const number = c.number || c.name;
            if (number) openChat(number);
        });
        container.appendChild(div);
    });

    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

function renderMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    if (!activeChatPeer) { container.innerHTML = ''; return; }

    const msgs = firestoreConversations[activeChatPeer] || [];
    container.innerHTML = '';

    msgs.forEach((msg, index) => {
        const div = document.createElement('div');
        const isSent = msg.direction === 'outgoing';
        div.className = `msg ${isSent ? 'sent' : 'received'}`;
        div.style.animationDelay = `${index * 0.04}s`;

        const time = msg.timestamp
            ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';

        // 1) Inline base64 media (cross-device)
        if (msg.media && msg.media.data) {
            const m = msg.media;
            const nameLine = document.createElement('div');
            nameLine.style.cssText = 'font-size:0.82rem;font-weight:600;margin-bottom:4px;word-break:break-all;';
            nameLine.textContent = '📎 ' + (m.name || 'file');
            div.appendChild(nameLine);

            let el;
            const type = m.type || '';
            if (type.startsWith('image/')) {
                el = document.createElement('img');
                el.src = m.data;
                el.style.cssText = 'max-width:100%;border-radius:10px;display:block;';
            } else if (type.startsWith('video/')) {
                el = document.createElement('video');
                el.src = m.data;
                el.controls = true;
                el.style.cssText = 'max-width:100%;border-radius:10px;display:block;';
            } else if (type.startsWith('audio/')) {
                el = document.createElement('audio');
                el.src = m.data;
                el.controls = true;
                el.style.cssText = 'width:100%;';
            } else {
                el = document.createElement('a');
                el.href = m.data;
                el.download = m.name || 'file';
                el.textContent = '⬇️ Download (' + Math.round((m.size || 0) / 1024) + ' KB)';
                el.style.cssText = 'color:#a78bfa;text-decoration:underline;font-size:0.85rem;display:inline-block;';
            }
            div.appendChild(el);
        }
        // 2) [media:ID] local IndexedDB reference (large-file fallback)
        else {
            const mediaMatch = (msg.text || '').match(/\[media:([^\]]+)\]/);
            const cleanText = (msg.text || '').replace(/\[media:[^\]]+\]/, '').trim();

            if (cleanText) {
                const textSpan = document.createElement('span');
                textSpan.textContent = cleanText;
                div.appendChild(textSpan);
            }

            if (mediaMatch && window.MediaStore) {
                const mediaId = mediaMatch[1];
                const placeholder = document.createElement('div');
                placeholder.textContent = '📎 Loading…';
                placeholder.style.cssText = 'opacity:0.6;font-size:0.8rem;margin-top:4px;';
                div.appendChild(placeholder);

                window.MediaStore.renderMediaElement(mediaId).then(res => {
                    if (!res || !res.el) { placeholder.textContent = '⚠️ Media unavailable'; return; }
                    placeholder.replaceWith(res.el);
                    if (res.el.tagName === 'IMG') {
                        res.el.onload = () => window.MediaStore.revokeMediaURL(res.url);
                    }
                }).catch(err => {
                    console.warn('Media load failed:', err);
                    placeholder.textContent = '⚠️ Media unavailable — ask sender to resend under 700 KB';
                });
            }
        }

        const timeEl = document.createElement('span');
        timeEl.className = 'time-tag';
        timeEl.textContent = time;
        div.appendChild(timeEl);

        container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;

    const name = getContactName(activeChatPeer) || activeChatPeer;
    document.getElementById('chatName').textContent = name;
    document.getElementById('chatStatus').textContent = `Chatting with ${activeChatPeer}`;
    const avatarEl = document.getElementById('chatAvatar');
    avatarEl.style.background = 'linear-gradient(135deg,#8b5cf6,#6d28d9)';
    avatarEl.innerHTML = `<span style="font-size:1.2rem;font-weight:700;">${name.charAt(0).toUpperCase()}</span>`;
}

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
        const dirClass = hasMissed ? 'missed' : (dir === 'incoming' ? 'incoming' : 'outgoing');

        let dirLabel = '';
        if (hasMissed) dirLabel = 'Missed';
        else if (dir === 'incoming') dirLabel = 'Incoming';
        else if (dir === 'outgoing') dirLabel = 'Outgoing';

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
                        <span style="font-weight:500;color:${hasMissed ? '#ef4444' : dir === 'incoming' ? '#2fd992' : '#4f8cf7'};">${dirLabel}</span>
                        <span>·</span>
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
            if (window.openCallDetails) window.openCallDetails(logId);
        });

        div.querySelectorAll('.call-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const num = btn.dataset.number;
                if (action === 'call') {
                    if (window.PremCall) PremCall.call(num, false);
                } else if (action === 'message') {
                    switchTab('chat');
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
// 6. PROFILE VIEW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderProfileView() {
    const savedUser = localStorage.getItem('neonUser');
    let userName = 'User', userPhone = '';
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            userName = user.name || 'User';
            userPhone = user.phone || '';
        } catch (e) {}
    }
    const premNum = localStorage.getItem('premCallNumber');
    if (premNum && !userPhone) userPhone = premNum;

    document.getElementById('profileAvatarText').textContent = userName.charAt(0).toUpperCase();
    document.getElementById('profileNameFull').textContent = userName;
    document.getElementById('profilePhoneFull').innerHTML = `<i class="fas fa-phone"></i> ${userPhone || '+91 9995554443'}`;
    document.getElementById('profileTimeFull').innerHTML = `<i class="far fa-clock"></i> Last active: Just now`;

    const link = document.querySelector('.registration-link');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            if (user && user.registered) {
                if (link) link.style.display = 'none';
            }
        } catch (e) {}
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. CONTACT PROFILE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let currentProfilePeer = null;
let contactBios = JSON.parse(localStorage.getItem('contactBios') || '{}');

function openContactProfile(peer) {
    if (!peer) return;
    currentProfilePeer = peer;
    const overlay = document.getElementById('contactProfileOverlay');
    if (!overlay) return;

    const name = getContactName(peer) || peer;
    const bio = contactBios[peer] || 'Tap to add a short bio';

    document.getElementById('contactProfileAvatarText').textContent = name.charAt(0).toUpperCase();
    document.getElementById('contactProfileName').textContent = name;
    document.getElementById('contactProfileUsername').textContent = '@' + name.toLowerCase().replace(/\s/g, '');
    document.getElementById('contactProfilePhone').textContent = '+91 ' + peer;
    document.getElementById('contactProfileBio').textContent = bio;
    document.getElementById('contactBioInput').value = bio;

    const logs = window.PremCall ? window.PremCall.getLogs() : [];
    const recent = logs.filter(l => l.number === peer).slice(0, 5);
    const callsContainer = document.getElementById('contactProfileRecentCalls');
    if (callsContainer) {
        if (recent.length === 0) {
            callsContainer.innerHTML = '<span style="color:#5a6885;">No recent calls</span>';
        } else {
            callsContainer.innerHTML = recent.map(call => {
                const dir = call.direction || 'incoming';
                const icon = dir === 'incoming' ? '📥' : dir === 'outgoing' ? '📤' : '❌';
                const time = new Date(call.started).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                return `<div style="display:flex;justify-content:space-between;padding:0.2rem 0;border-bottom:1px solid rgba(255,255,255,0.03);">${icon} ${time}</div>`;
            }).join('');
        }
    }

    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

function closeContactProfile() {
    const overlay = document.getElementById('contactProfileOverlay');
    if (overlay) overlay.style.display = 'none';
    const bioEditor = document.getElementById('contactBioEditor');
    if (bioEditor) bioEditor.style.display = 'none';
    currentProfilePeer = null;
}

function initContactProfile() {
    const backBtn = document.getElementById('contactProfileBack');
    const overlay = document.getElementById('contactProfileOverlay');
    const bio = document.getElementById('contactProfileBio');
    const bioEditor = document.getElementById('contactBioEditor');
    const bioInput = document.getElementById('contactBioInput');
    const bioSave = document.getElementById('contactBioSave');
    const bioCancel = document.getElementById('contactBioCancel');
    const callBtn = document.getElementById('contactProfileCall');
    const videoBtn = document.getElementById('contactProfileVideo');
    const msgBtn = document.getElementById('contactProfileMessage');

    if (!overlay || !backBtn || !bio) {
        console.warn('Contact profile elements missing, skipping init');
        return;
    }

    backBtn.addEventListener('click', closeContactProfile);
    overlay.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeContactProfile();
    });

    bio.addEventListener('click', () => {
        if (!currentProfilePeer) return;
        bioEditor.style.display = 'block';
        bioInput.value = contactBios[currentProfilePeer] || '';
        bioInput.focus();
    });

    if (bioSave) {
        bioSave.addEventListener('click', () => {
            if (!currentProfilePeer) return;
            const newBio = bioInput.value.trim() || 'Tap to add a short bio';
            contactBios[currentProfilePeer] = newBio;
            localStorage.setItem('contactBios', JSON.stringify(contactBios));
            document.getElementById('contactProfileBio').textContent = newBio;
            bioEditor.style.display = 'none';
            showToast('Bio updated');
        });
    }

    if (bioCancel) {
        bioCancel.addEventListener('click', () => {
            bioEditor.style.display = 'none';
        });
    }

    if (callBtn) {
        callBtn.addEventListener('click', () => {
            if (!currentProfilePeer) return;
            if (window.PremCall) PremCall.call(currentProfilePeer, false);
            closeContactProfile();
        });
    }

    if (videoBtn) {
        videoBtn.addEventListener('click', () => {
            if (!currentProfilePeer) return;
            if (window.PremCall) PremCall.call(currentProfilePeer, true);
            closeContactProfile();
        });
    }

    if (msgBtn) {
        msgBtn.addEventListener('click', () => {
            if (!currentProfilePeer) return;
            closeContactProfile();
            switchTab('chat');
            openChat(currentProfilePeer);
        });
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. SUMMARIZE CHAT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function summarizeCurrentChat() {
    if (!activeChatPeer) { showToast('No active chat to summarize'); return; }
    const msgs = firestoreConversations[activeChatPeer] || [];
    if (msgs.length === 0) { showToast('No messages to summarize'); return; }
    const text = msgs.map(m => `${m.direction === 'outgoing' ? 'You' : getContactName(activeChatPeer) || activeChatPeer}: ${m.text}`).join('\n');
    try {
        showToast('🧠 Generating summary...');
        const response = await fetch('https://ragina-crawler-ragina.vercel.app/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: `Summarize this conversation in 2-3 sentences:\n\n${text}\n\nSummary:` })
        });
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        const summary = data.text || 'Could not generate summary.';
        showToast('📝 ' + summary);
        if (activeChatPeer && firestoreConversations[activeChatPeer]) {
            firestoreConversations[activeChatPeer].push({
                text: '🧠 AI Summary: ' + summary,
                timestamp: Date.now(),
                direction: 'incoming',
                from: 'system'
            });
            renderMessages();
            renderChatList();
        }
    } catch (err) {
        console.error('Summarize error:', err);
        showToast('Error summarizing chat');
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. SUMMARIZE CALL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function summarizeCall(logId) {
    const logs = window.PremCall ? window.PremCall.getLogs() : [];
    const logIndex = logs.findIndex(l => l.id === logId);
    if (logIndex === -1) { showToast('Call log not found'); return; }
    const log = logs[logIndex];
    if (!log.messages || log.messages.length === 0) { showToast('No transcript for this call'); return; }

    const text = log.messages.map(m => `${m.role === 'user' ? 'You' : (log.type === 'ragina' ? 'RAGina' : 'Live')}: ${m.text}`).join('\n');

    try {
        showToast('🧠 Generating summary...');
        const response = await fetch('https://ragina-crawler-ragina.vercel.app/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: `Summarize this phone call transcript in 2-3 sentences:\n\n${text}\n\nSummary:` })
        });
        let summary = "Could not generate summary.";
        if (response.ok) {
            const data = await response.json();
            summary = data.text || summary;
        } else {
            throw new Error('API returned ' + response.status);
        }

        logs[logIndex].summary = summary;
        if (window.PremCall && window.PremCall.updateLogSummary) {
            window.PremCall.updateLogSummary(logId, summary);
        }
        if (window.openCallDetails) window.openCallDetails(logId);
        showToast('📝 Call summarized!');
    } catch (err) {
        console.error('Summarize call error:', err);
        const fallback = "Could not generate summary. Please try again later.";
        logs[logIndex].summary = fallback;
        if (window.PremCall && window.PremCall.updateLogSummary) {
            window.PremCall.updateLogSummary(logId, fallback);
        }
        if (window.openCallDetails) window.openCallDetails(logId);
        showToast('Error summarizing call: ' + err.message);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. NAVIGATION & CHAT ACTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.list-footer .tab').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });
    const chatPanel = document.getElementById('chatPanel');
    const callsPanel = document.getElementById('callsPanel');
    const profilePanel = document.getElementById('profilePanel');
    if (tab === 'chat') {
        chatPanel.style.display = 'block';
        callsPanel.style.display = 'none';
        profilePanel.style.display = 'none';
        document.getElementById('searchInput').placeholder = 'Search chats...';
        renderChatList();
    } else if (tab === 'calls') {
        chatPanel.style.display = 'none';
        callsPanel.style.display = 'block';
        profilePanel.style.display = 'none';
        document.getElementById('searchInput').placeholder = 'Search calls...';
        renderCallList();
    } else if (tab === 'me') {
        chatPanel.style.display = 'none';
        callsPanel.style.display = 'none';
        profilePanel.style.display = 'block';
        document.getElementById('searchInput').placeholder = 'Search...';
        renderProfileView();
    }
}

function openChat(peer) {
    if (!peer) return;
    if (!conversationListeners[peer]) listenPeerConversation(peer);
    activeChatPeer = peer;
    document.getElementById('chatView').classList.add('open');
    document.getElementById('listView').classList.add('shrink');
    renderMessages();
    const name = getContactName(peer) || peer;
    document.getElementById('chatName').textContent = name;
    document.getElementById('chatStatus').textContent = `Chatting with ${peer}`;
    const avatarEl = document.getElementById('chatAvatar');
    avatarEl.style.background = 'linear-gradient(135deg,#8b5cf6,#6d28d9)';
    avatarEl.innerHTML = `<span style="font-size:1.2rem;font-weight:700;">${name.charAt(0).toUpperCase()}</span>`;
    document.getElementById('msgInput').focus();
    const savedTheme = localStorage.getItem('neonTheme') || 'dark';
    applyTheme(savedTheme);
}

function closeChat() {
    document.querySelectorAll('#chatMessages img[src^="blob:"], ' +
                              '#chatMessages video[src^="blob:"], ' +
                              '#chatMessages audio[src^="blob:"]').forEach(el => {
        if (el.src && el.src.startsWith('blob:')) URL.revokeObjectURL(el.src);
    });
    activeChatPeer = null;
    document.getElementById('chatView').classList.remove('open');
    document.getElementById('listView').classList.remove('shrink');
    renderChatList();
}

function sendMessage() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text || !activeChatPeer || !firebaseReady) return;
    const peer = activeChatPeer;
    if (!firestoreConversations[peer]) firestoreConversations[peer] = [];
    const tempMsg = { text, timestamp: Date.now(), direction: 'outgoing', from: myNumber };
    firestoreConversations[peer].push(tempMsg);
    renderMessages();
    input.value = '';
    sendMessageToFirestore(peer, text);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. SETTINGS & THEME
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
    body.classList.remove('light-mode', 'neon-mode');
    if (theme === 'light') body.classList.add('light-mode');
    else if (theme === 'neon') body.classList.add('neon-mode');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. REGISTRATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initRegistration() {
    const overlay = document.getElementById('regOverlay');
    const openBtn = document.getElementById('openRegForm');
    const closeBtn = document.getElementById('regClose');
    const submitBtn = document.getElementById('regSubmit');
    const otpSend = document.getElementById('otpSend');
    const regPhone = document.getElementById('regPhone');

    const savedUser = localStorage.getItem('neonUser');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            if (user && user.registered) {
                const link = document.querySelector('.registration-link');
                if (link) link.style.display = 'none';
                renderProfileView();
                updateStatusBadge(user);
                if (window.PremCall && user.phone) {
                    localStorage.setItem('premCallNumber', user.phone);
                    localStorage.setItem('premCallVerified', 'true');
                    localStorage.setItem('premCallRegisteredAt', String(Date.now()));
                    PremCall.init(user.phone);
                    document.getElementById('myNumberDisplay').textContent = user.phone;
                    document.getElementById('headerStatusDot').className = 'status-dot connecting';
                }
                if (!firebaseReady) initFirebaseMessaging();
            }
        } catch (e) {}
    }

    if (!openBtn || !closeBtn || !submitBtn || !otpSend) return;

    openBtn.addEventListener('click', () => {
        if (localStorage.getItem('neonUser')) { showToast('Already registered'); return; }
        overlay.classList.add('open');
    });
    closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

    otpSend.addEventListener('click', () => {
        const phone = regPhone.value.trim();
        if (!phone || !/^\d{10}$/.test(phone)) { showToast('Please enter a valid 10-digit number'); return; }
        showToast(`📱 OTP sent to ${phone} (Demo: 1234)`);
        document.getElementById('regOtp').value = '1234';
    });

    submitBtn.addEventListener('click', () => {
        const name = document.getElementById('regName').value.trim();
        const userid = document.getElementById('regUserid').value.trim();
        const phone = regPhone.value.trim();
        const otp = document.getElementById('regOtp').value.trim();
        if (!name || !userid || !phone || !otp) { showToast('Please fill all fields'); return; }
        if (otp !== '1234') { showToast('Invalid OTP. Use 1234 (demo)'); return; }

        const userData = { name, userid, phone, registered: true, status: 'offline' };
        localStorage.setItem('neonUser', JSON.stringify(userData));
        updateStatusBadge(userData);
        overlay.classList.remove('open');
        renderProfileView();
        showToast('✅ Registration successful! Welcome, ' + name);
        const link = document.querySelector('.registration-link');
        if (link) link.style.display = 'none';
        regPhone.disabled = true;

        if (window.PremCall) {
            localStorage.setItem('premCallNumber', phone);
            localStorage.setItem('premCallVerified', 'true');
            localStorage.setItem('premCallRegisteredAt', String(Date.now()));
            PremCall.init(phone);
            document.getElementById('myNumberDisplay').textContent = phone;
            document.getElementById('headerStatusDot').className = 'status-dot connecting';
        }
        if (!firebaseReady) initFirebaseMessaging();
        setTimeout(() => { initCallSignaling(); }, 800);
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
// 13. FAB, DIALPAD, TOGGLES, TOAST, ABOUT, DEBUG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initFab() {
    const fab = document.getElementById('fabButton');
    if (!fab) return;
    fab.addEventListener('click', function() {
        document.getElementById('dialpadOverlay').classList.add('open');
        document.getElementById('dialpadDisplayText').textContent = '';
        document.getElementById('dialClearBtn').style.display = 'none';
    });
}

function initDialpad() {
    const overlay = document.getElementById('dialpadOverlay');
    const displayText = document.getElementById('dialpadDisplayText');
    const clearBtn = document.getElementById('dialClearBtn');
    if (!overlay || !displayText) return;
    let number = '';

    const closeDialpad = () => {
        overlay.classList.remove('open');
        number = '';
        displayText.textContent = '';
        clearBtn.style.display = 'none';
    };

    document.getElementById('dialpadClose').addEventListener('click', closeDialpad);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialpad(); });

    function updateDisplay() {
        displayText.textContent = number;
        clearBtn.style.display = number.length > 0 ? 'block' : 'none';
    }

    document.querySelectorAll('.dial-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.value;
            number += val;
            updateDisplay();
            if (window.PremCall) PremCall.playDtmf(val);
        });
    });

    clearBtn.addEventListener('click', () => {
        number = number.slice(0, -1);
        updateDisplay();
    });

    document.getElementById('dialCall').addEventListener('click', () => {
        if (number.trim()) {
            if (/^\d{10}$/.test(number)) {
                overlay.classList.remove('open');
                if (window.PremCall) PremCall.call(number, false);
                number = '';
                updateDisplay();
            } else { showToast('Enter exactly 10 digits'); }
        } else { showToast('Enter a number'); }
    });

    document.getElementById('dialMessage').addEventListener('click', () => {
        if (number.trim()) {
            if (/^\d{10}$/.test(number)) {
                overlay.classList.remove('open');
                switchTab('chat');
                if (!conversationListeners[number]) listenPeerConversation(number);
                openChat(number);
                number = '';
                updateDisplay();
            } else { showToast('Enter exactly 10 digits to message'); }
        } else { showToast('Enter a number'); }
    });
}

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

function toggleAiOverlay(open) {
    const overlay = document.getElementById('aiOverlay');
    if (overlay) overlay.classList.toggle('open', open);
}

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
                    relativeInput: true, clipRelativeInput: true,
                    calibrateX: true, calibrateY: true,
                    invertX: false, invertY: false,
                    limitX: 15, limitY: 15,
                    scalarX: 6, scalarY: 6,
                    frictionX: 0.1, frictionY: 0.1,
                    originX: 0.5, originY: 0.5, precision: 1,
                });
            });
        }
    } else {
        card.style.transform = 'scale(0.92) translateY(20px)';
        setTimeout(() => { overlay.style.display = 'none'; }, 400);
    }
}

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

    console.log = function(...args) { originalLog.apply(console, args); addLog(args.join(' '), 'info'); };
    console.error = function(...args) { originalError.apply(console, args); addLog(args.join(' '), 'error'); };
    console.warn = function(...args) { originalWarn.apply(console, args); addLog(args.join(' '), 'warn'); };

    window.addEventListener('error', function(e) { addLog(e.message || 'Uncaught error', 'error'); });

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

    clearBtn.addEventListener('click', () => { if (body) body.innerHTML = ''; });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 14. CALL DETAILS MODAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
window.openCallDetails = function(logId) {
    const logs = window.PremCall ? window.PremCall.getLogs() : [];
    const log = logs.find(l => l.id === logId);
    if (!log) { showToast('Call log not found'); return; }

    const number = log.number;
    const contactName = getContactName(number) || number;
    const isSaved = getSavedContacts().some(c => c.number === number);
    const allCallsForNumber = logs.filter(l => l.number === number);

    const modal = document.getElementById('callDetailsModal');
    const card = document.getElementById('callDetailsCard');
    if (!modal || !card) return;

    const avatar = document.getElementById('detailsAvatar');
    const nameEl = document.getElementById('detailsName');
    const numberEl = document.getElementById('detailsNumber');
    const saveStatus = document.getElementById('detailsSaveStatus');
    const saveBtn = document.getElementById('detailsSaveBtn');

    if (avatar) avatar.textContent = contactName.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = contactName === number ? 'Unknown' : contactName;
    if (numberEl) numberEl.textContent = '+91 ' + number;

    if (saveStatus && saveBtn) {
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
    }

    const historyContainer = document.getElementById('detailsCallList');
    if (historyContainer) {
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
    }

    const transcriptContainer = document.getElementById('detailsTranscriptContainer');
    const transcriptDiv = document.getElementById('detailsTranscript');
    if (transcriptContainer && transcriptDiv) {
        transcriptDiv.innerHTML = '';
        if (log.messages && log.messages.length > 0) {
            log.messages.forEach(m => {
                const div = document.createElement('div');
                div.style.cssText = 'padding:0.2rem 0;border-bottom:1px solid rgba(255,255,255,0.04);';
                const sender = m.role === 'user' ? 'You' : (log.type === 'ragina' ? 'RAGina' : 'Live');
                const color = m.role === 'user' ? '#8b5cf6' : '#2fd992';
                div.innerHTML = `<span style="font-weight:600;color:${color};">${sender}:</span> ${m.text}`;
                transcriptDiv.appendChild(div);
            });
        } else {
            transcriptDiv.innerHTML = '<div style="color:#5a6885;text-align:center;padding:0.5rem;">No transcript for this call</div>';
        }

        const header = transcriptContainer.querySelector('div:first-child');
        if (header) {
            let existingBtn = header.querySelector('.transcript-update-btn');
            if (!existingBtn) {
                const btn = document.createElement('button');
                btn.className = 'transcript-update-btn';
                btn.innerHTML = '📝';
                btn.title = 'Update AI Recap for this call';
                btn.style.cssText = 'background:rgba(255,255,255,0.04);border:none;color:#a5b3d0;margin-left:6px;cursor:pointer;font-size:0.8rem;';
                btn.onclick = (e) => { e.stopPropagation(); summarizeCall(log.id); };
                header.appendChild(btn);
            }
        }
    }

    const summaryContainer = document.getElementById('detailsSummary');
    if (summaryContainer) {
        if (log.summary) {
            summaryContainer.innerHTML = `<i class="fas fa-wand-magic-sparkles" style="color:#ffb648;margin-right:0.3rem;"></i> ${log.summary}`;
        } else {
            summaryContainer.innerHTML = '<span style="color:#5a6885;">No AI summary available</span>';
        }
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

    let summarizeBtn = document.querySelector('.details-summarize-btn');
    if (!summarizeBtn) {
        const btnContainer = document.querySelector('.details-export-btn')?.parentNode;
        if (btnContainer) {
            summarizeBtn = document.createElement('button');
            summarizeBtn.className = 'details-summarize-btn';
            summarizeBtn.style.cssText = 'padding:0.3rem 0.8rem;border-radius:30px;border:1px solid rgba(255,182,72,0.2);background:rgba(255,182,72,0.08);color:#ffb648;font-weight:500;font-size:0.7rem;cursor:pointer;';
            summarizeBtn.textContent = '🧠 Summarize';
            btnContainer.appendChild(summarizeBtn);
        }
    }
    if (summarizeBtn) summarizeBtn.onclick = () => summarizeCall(log.id);

    modal.querySelectorAll('.details-action-btn').forEach(btn => {
        btn.onclick = () => {
            const action = btn.dataset.action;
            if (action === 'call') {
                if (window.PremCall) PremCall.call(number, false);
                modal.classList.remove('active');
            } else if (action === 'message') {
                modal.classList.remove('active');
                switchTab('chat');
                openChat(number);
            } else if (action === 'video') {
                if (window.PremCall) PremCall.call(number, true);
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
// 15. EVENT LISTENERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setupEventListeners() {
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.addEventListener('click', closeChat);

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    const msgInput = document.getElementById('msgInput');
    if (msgInput) msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

    const attachBtn = document.getElementById('attachBtn');
    const mediaFileInput = document.getElementById('mediaFileInput');
    if (attachBtn && mediaFileInput) {
        attachBtn.addEventListener('click', () => mediaFileInput.click());
        mediaFileInput.addEventListener('change', (e) => {
            handleAttachFiles(e.target.files);
            e.target.value = '';
        });
    }

    initIncomingFileListener();

    const chatCallBtn = document.getElementById('chatCallBtn');
    const chatVideoBtn = document.getElementById('chatVideoBtn');
    if (chatCallBtn) {
        chatCallBtn.addEventListener('click', () => {
            if (activeChatPeer && window.PremCall) PremCall.call(activeChatPeer, false);
            else showToast('No active chat');
        });
    }
    if (chatVideoBtn) {
        chatVideoBtn.addEventListener('click', () => {
            if (activeChatPeer && window.PremCall) PremCall.call(activeChatPeer, true);
            else showToast('No active chat');
        });
    }
    document.querySelector('.call-btn')?.addEventListener('click', () => {
        if (activeChatPeer && window.PremCall) PremCall.call(activeChatPeer, false);
        else showToast('No active chat');
    });
    document.querySelector('.video-btn')?.addEventListener('click', () => {
        if (activeChatPeer && window.PremCall) PremCall.call(activeChatPeer, true);
        else showToast('No active chat');
    });

    document.querySelector('.voice-btn')?.addEventListener('click', () => {
        if (activeChatPeer && window.PremCall) {
            PremCall.call(activeChatPeer, false);
        } else {
            document.getElementById('dialpadOverlay').classList.add('open');
            document.getElementById('dialpadDisplayText').textContent = '';
            document.getElementById('dialClearBtn').style.display = 'none';
        }
    });

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
    if (openProfileBtn) {
        openProfileBtn.addEventListener('click', () => {
            const peer = activeChatPeer;
            if (!peer) { showToast('No active chat'); return; }
            if (typeof openContactProfile === 'function') openContactProfile(peer);
            else {
                if (document.getElementById('chatView')?.classList.contains('open')) closeChat();
                switchTab('me');
            }
        });
    }

    const aiSuggestion = document.getElementById('aiSuggestion');
    if (aiSuggestion) aiSuggestion.addEventListener('click', summarizeCurrentChat);

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
            if (document.getElementById('chatView')?.classList.contains('open')) closeChat();
            else if (document.getElementById('aiOverlay')?.classList.contains('open')) toggleAiOverlay(false);
            else if (document.getElementById('dialpadOverlay')?.classList.contains('open')) {
                document.getElementById('dialpadOverlay').classList.remove('open');
                document.getElementById('dialpadDisplayText').textContent = '';
                document.getElementById('dialClearBtn').style.display = 'none';
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
    document.getElementById('videoToggleBtn')?.addEventListener('click', function() {
        if (!window.PremCall) return;
        const v = PremCall.videoToggle();
        this.classList.toggle('active', v);
        this.innerHTML = v ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
        showToast(v ? 'Video on' : 'Video off');
    });
    document.getElementById('recordBtn')?.addEventListener('click', function() {
        if (!window.PremCall) return;
        const recording = PremCall.toggleRecording();
        this.classList.toggle('active', recording);
        this.innerHTML = recording ? '<i class="fas fa-stop-circle"></i>' : '<i class="fas fa-circle"></i>';
        showToast(recording ? 'Recording started' : 'Recording stopped');
    });
    document.getElementById('answerBtn')?.addEventListener('click', () => {
        if (window.PremCall) PremCall.answer();
    });
    document.getElementById('rejectBtn')?.addEventListener('click', () => {
        if (window.PremCall) PremCall.reject();
        showToast('Call declined');
    });

    const aboutBtn = document.getElementById('aboutBtn');
    if (aboutBtn) aboutBtn.addEventListener('click', () => toggleAboutPanel(true));
    const aboutClose = document.getElementById('aboutClose');
    if (aboutClose) aboutClose.addEventListener('click', () => toggleAboutPanel(false));
    const aboutOverlay = document.getElementById('aboutOverlay');
    if (aboutOverlay) aboutOverlay.addEventListener('click', (e) => { if (e.target === aboutOverlay) toggleAboutPanel(false); });

    console.log('✅ Sandesai · All event listeners attached');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 16. INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function init() {
    try {
        const savedUser = localStorage.getItem('neonUser');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                updateStatusBadge(user);
                renderProfileView();
                const link = document.querySelector('.registration-link');
                if (link) link.style.display = 'none';
            } catch (e) {}
        }

        initFab();
        initDialpad();
        initSettings();
        initRegistration();
        initFabToggle();
        initContactProfile();
        renderChatList();
        renderCallList();
        setupEventListeners();
        initDebugConsole();

        const stored = localStorage.getItem('premCallNumber');
        const verified = localStorage.getItem('premCallVerified') === 'true';
        if (stored && verified && window.PremCall) {
            document.getElementById('myNumberDisplay').textContent = stored;
            PremCall.init(stored);
            if (!firebaseReady) initFirebaseMessaging();
        } else if (window.PremCall) {
            PremCall.init('0000000000');
        }

        switchTab('chat');
        console.log('🚀 Sandesai · All systems ready');
    } catch (err) {
        console.error('❌ Init error:', err);
        showToast('Init error: ' + (err.message || 'unknown'));
    }
})();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXPOSE GLOBALS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
window.handleAttachFiles = handleAttachFiles;
window.initCallSignaling = initCallSignaling;