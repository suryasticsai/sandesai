// ================================================================
// js/enhancements.js
// Adds NEW features on top of script.js without touching it:
//   • Invite links (long URL — no external APIs)
//   • Share invite to any app (no duplicate URL)
//   • Deep link handler for ?join=TOKEN
//   • Refresh connection
//   • Call log sync (Firestore <-> local)
//   • Profile lookup (name + username)
// ================================================================
(function () {
    'use strict';

    // ── Constants ──
    const INVITE_SECRET = 'sandesai-invite-v1-2026';
    const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    // ────────────────────────────────────────────────────────────
    // 1. INVITE TOKEN HELPERS
    // ────────────────────────────────────────────────────────────
    function signPayload(str) {
        let hash = 0;
        const s = INVITE_SECRET + '|' + str;
        for (let i = 0; i < s.length; i++) {
            hash = ((hash << 5) - hash) + s.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    function createInviteToken({ from, to, chat, msg, name }) {
        const payload = {
            from, to, chat: chat || to, msg: msg || '',
            name: name || '',
            exp: Date.now() + INVITE_TTL_MS,
        };
        const d = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
        const s = signPayload(d);
        return d + '.' + s;
    }

    function decodeInviteToken(token) {
        try {
            const [d, s] = String(token || '').split('.');
            if (!d || !s) return null;
            if (signPayload(d) !== s) return null;
            const payload = JSON.parse(decodeURIComponent(escape(atob(d))));
            if (!payload.exp || payload.exp < Date.now()) return null;
            return payload;
        } catch (e) { return null; }
    }

    function buildInviteURL(token) {
        const base = location.origin + location.pathname;
        return base + '?join=' + encodeURIComponent(token);
    }

    window.createInviteToken = createInviteToken;
    window.decodeInviteToken = decodeInviteToken;
    window.buildInviteURL = buildInviteURL;

    // ────────────────────────────────────────────────────────────
    // 2. SHARE INVITE — any app, no duplicate URL
    // ────────────────────────────────────────────────────────────
    async function shareInviteForPeer(peer) {
        if (!peer) { window.showToast && showToast('No contact selected'); return; }

        const userData = JSON.parse(localStorage.getItem('neonUser') || '{}');
        const me = localStorage.getItem('premCallNumber') || '';
        const senderName = userData.name || 'Someone';

        const token = createInviteToken({
            from: me,
            to: peer,
            chat: peer,
            name: senderName,
        });
        const url = buildInviteURL(token);

        // IMPORTANT: only `text`, no `url:` — the URL is inside `text`
        // Passing both causes the duplicate the user was seeing.
        const text =
            `👋 ${senderName} invited you to Sandesai.\n\n` +
            `Tap to open the chat:\n${url}`;

        if (navigator.share) {
            try {
                await navigator.share({ title: 'Sandesai Invite', text });
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                console.warn('navigator.share failed:', err);
            }
        }

        // Fallback: SMS app
        const isAndroid = /Android/i.test(navigator.userAgent);
        const smsHref = isAndroid
            ? `sms:${peer}?body=${encodeURIComponent(text)}`
            : `sms:${peer}&body=${encodeURIComponent(text)}`;

        // Fallback: clipboard
        if (navigator.clipboard) {
            try {
                await navigator.clipboard.writeText(text);
                window.showToast && showToast('📋 Invite copied — paste it anywhere');
                setTimeout(() => { try { window.location.href = smsHref; } catch (e) {} }, 400);
                return;
            } catch (e) {}
        }

        window.location.href = smsHref;
    }

    async function shareInviteOpen() {
        const userData = JSON.parse(localStorage.getItem('neonUser') || '{}');
        const me = localStorage.getItem('premCallNumber') || '';
        const senderName = userData.name || 'Someone';

        const token = createInviteToken({
            from: me,
            to: '',
            chat: me,
            name: senderName,
        });
        const url = buildInviteURL(token);
        const text = `👋 Join me on Sandesai — a messenger with AI superpowers!\n\n${url}`;

        if (navigator.share) {
            try {
                await navigator.share({ title: 'Join Sandesai', text });
                return;
            } catch (e) { if (e.name === 'AbortError') return; }
        }

        if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            window.showToast && showToast('📋 Invite copied to clipboard');
        }
    }

    window.shareInviteForPeer = shareInviteForPeer;
    window.shareInviteOpen = shareInviteOpen;

    // ────────────────────────────────────────────────────────────
    // 3. INVITE WELCOME OVERLAY + AUTO-REGISTER
    // ────────────────────────────────────────────────────────────
    function showInviteWelcomeOverlay(payload) {
        document.getElementById('inviteWelcomeOverlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'inviteWelcomeOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 8000;
            background: rgba(8,6,20,0.94);
            backdrop-filter: blur(20px);
            display: flex; align-items: center; justify-content: center;
            padding: 24px;
            font-family: 'Inter', sans-serif;
            color: #eef0f5;
        `;
        overlay.innerHTML = `
            <div style="max-width:380px; width:100%; background:rgba(18,16,36,0.96);
                        border:1px solid rgba(255,255,255,0.06); border-radius:28px;
                        padding:32px 24px; text-align:center;
                        box-shadow:0 40px 80px rgba(0,0,0,0.7);">
                <img src="sandesai-logo.png" alt="Sandesai"
                     style="width:64px;height:64px;border-radius:50%;margin-bottom:12px;" />
                <div style="font-size:1.3rem;font-weight:700;margin-bottom:4px;">
                    You're invited to Sandesai
                </div>
                <div style="font-size:0.85rem;color:#7a89a8;margin-bottom:24px;">
                    ${payload.name ? `<b style="color:#c4b5fd">${payload.name}</b> wants to chat with you.` : 'Join the conversation.'}
                </div>

                <div style="background:rgba(255,255,255,0.03);border-radius:14px;
                            padding:12px 16px;margin-bottom:20px;text-align:left;
                            border:1px solid rgba(255,255,255,0.04);">
                    <div style="font-size:0.7rem;color:#7a89a8;text-transform:uppercase;
                                letter-spacing:0.05em;margin-bottom:4px;">Your number</div>
                    <div style="font-size:1rem;font-weight:600;">+91 ${payload.to || '—'}</div>
                </div>

                <div style="margin-bottom:16px;text-align:left;">
                    <label style="font-size:0.72rem;color:#7a89a8;
                                  text-transform:uppercase;letter-spacing:0.05em;">
                        Your name
                    </label>
                    <input id="inviteName" type="text" placeholder="e.g. Ananya"
                           style="width:100%;margin-top:6px;padding:12px 14px;
                                  border-radius:14px;border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);color:#eef0f5;
                                  font-size:16px;outline:none;font-family:inherit;" />
                </div>

                <button id="inviteJoinBtn"
                        style="width:100%;padding:14px;border-radius:16px;border:none;
                               background:linear-gradient(135deg,#7c3aed,#6d28d9);
                               color:#fff;font-weight:700;font-size:1rem;cursor:pointer;
                               font-family:inherit;">
                    🚀 Join & open chat
                </button>

                <div style="margin-top:12px;font-size:0.7rem;color:#5a6885;">
                    By joining you agree to the Sandesai terms.
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('inviteJoinBtn').addEventListener('click', () => {
            const name = (document.getElementById('inviteName').value || '').trim() || 'New user';
            autoRegisterFromInvite(payload, name);
        });
    }

    async function autoRegisterFromInvite(payload, name) {
        const phone = payload.to;
        if (!phone) { window.showToast && showToast('Invite missing number'); return; }

        const userid = (name.toLowerCase().replace(/\s+/g, '') || 'user') +
                       '_' + Math.floor(1000 + Math.random() * 9000);

        const userData = { name, userid, phone, registered: true, status: 'online' };
        localStorage.setItem('neonUser', JSON.stringify(userData));
        localStorage.setItem('premCallNumber', phone);
        localStorage.setItem('premCallVerified', 'true');
        localStorage.setItem('premCallRegisteredAt', String(Date.now()));

        window.showToast && showToast('✅ Welcome, ' + name + '!');

        if (window.PremCall) window.PremCall.init(phone);

        if (!window.firebaseReady && typeof window.initFirebaseMessaging === 'function') {
            window.initFirebaseMessaging();
        }

        setTimeout(() => {
            if (window.db && phone) {
                window.db.collection('profiles').doc(phone).set({
                    phone, name, username: userid, updatedAt: Date.now()
                }, { merge: true }).catch(() => {});
            }
            if (typeof window.initCallSignaling === 'function') window.initCallSignaling();
            if (typeof window.initCallLogSync === 'function') window.initCallLogSync();
        }, 1200);

        document.getElementById('inviteWelcomeOverlay')?.remove();

        if (typeof window.updateStatusBadge === 'function') window.updateStatusBadge(userData);
        if (typeof window.renderProfileView === 'function') window.renderProfileView();
        const mn = document.getElementById('myNumberDisplay');
        if (mn) mn.textContent = phone;
        const dot = document.getElementById('headerStatusDot');
        if (dot) dot.className = 'status-dot connecting';

        setTimeout(() => {
            if (typeof window.switchTab === 'function') window.switchTab('chat');
            if (typeof window.openChat === 'function') window.openChat(payload.chat || payload.from);
        }, 1000);
    }

    async function handleInviteFromURL() {
        const params = new URLSearchParams(location.search);
        const token = params.get('join');
        if (!token) return;

        const payload = decodeInviteToken(token);
        if (!payload) {
            window.showToast && showToast('⚠️ Invite link expired or invalid');
            history.replaceState({}, '', location.pathname);
            return;
        }

        console.log('🎟️ Valid invite token:', payload);

        const isRegistered = localStorage.getItem('premCallRegisteredAt');
        if (isRegistered) {
            const myNum = localStorage.getItem('premCallNumber');
            if (myNum && payload.chat) {
                window.showToast && showToast(`Opening chat with ${payload.name || payload.from}…`);
                setTimeout(() => {
                    if (typeof window.switchTab === 'function') window.switchTab('chat');
                    if (typeof window.openChat === 'function') window.openChat(payload.chat);
                }, 400);
            }
            history.replaceState({}, '', location.pathname);
            return;
        }

        showInviteWelcomeOverlay(payload);
        history.replaceState({}, '', location.pathname);
    }

    window.handleInviteFromURL = handleInviteFromURL;

    // ────────────────────────────────────────────────────────────
    // 4. REFRESH CONNECTION
    // ────────────────────────────────────────────────────────────
    if (typeof window.refreshConnection !== 'function') {
        window.refreshConnection = async function () {
            const btn = document.getElementById('refreshConnectionBtn');
            if (btn) btn.classList.add('spinning');
            window.showToast && showToast('🔄 Reconnecting…');
            try {
                const storedNum = localStorage.getItem('premCallNumber');
                const verified = localStorage.getItem('premCallVerified') === 'true';

                if (storedNum && verified && window.PremCall) {
                    if (window.PremCall.reinit) window.PremCall.reinit(storedNum);
                    else window.PremCall.init(storedNum);
                }

                if (!window.firebaseReady && typeof window.initFirebaseMessaging === 'function') {
                    window.initFirebaseMessaging();
                } else {
                    if (typeof window.initCallSignaling === 'function') window.initCallSignaling();
                    if (typeof window.initCallLogSync === 'function') window.initCallLogSync();
                }

                if (typeof window.renderChatList === 'function') window.renderChatList();
                if (typeof window.renderCallList === 'function') window.renderCallList();

                setTimeout(() => {
                    window.showToast && showToast('✅ Connection refreshed');
                    if (btn) btn.classList.remove('spinning');
                }, 900);
            } catch (e) {
                console.error('Refresh failed:', e);
                window.showToast && showToast('Refresh failed: ' + e.message);
                if (btn) btn.classList.remove('spinning');
            }
        };
    }

    // ────────────────────────────────────────────────────────────
    // 5. CALL LOG SYNC
    // ────────────────────────────────────────────────────────────
    if (typeof window.initCallLogSync !== 'function') {
        window.callLogsUnsub = null;
        window.initCallLogSync = function () {
            if (!window.db || !window.myNumber) return;
            if (window.callLogsUnsub) { try { window.callLogsUnsub(); } catch (e) {} window.callLogsUnsub = null; }

            window.callLogsUnsub = window.db.collection('call_logs')
                .where('owner', '==', window.myNumber)
                .onSnapshot(snapshot => {
                    try {
                        const remoteLogs = snapshot.docs.map(doc => doc.data());
                        const localLogs = JSON.parse(localStorage.getItem('premCallLogs')) || [];
                        const byId = new Map();
                        localLogs.forEach(l => byId.set(l.id, l));
                        remoteLogs.forEach(l => byId.set(l.id, l));
                        const merged = Array.from(byId.values())
                            .sort((a, b) => (b.started || 0) - (a.started || 0))
                            .slice(0, 100);
                        localStorage.setItem('premCallLogs', JSON.stringify(merged));
                        if (typeof window.renderCallList === 'function') window.renderCallList();
                    } catch (e) { console.warn('Call log merge failed:', e); }
                }, err => console.warn('Call log listener error:', err));
        };
    }

    // ────────────────────────────────────────────────────────────
    // 6. PROFILE LOOKUP
    // ────────────────────────────────────────────────────────────
    if (typeof window.fetchUserProfile !== 'function') {
        window.userProfileCache = window.userProfileCache || {};

        window.fetchUserProfile = async function (phone) {
            if (!phone) return null;
            if (window.userProfileCache[phone] && window.userProfileCache[phone].loaded) {
                return window.userProfileCache[phone];
            }
            if (!window.db) return null;

            try {
                const doc = await window.db.collection('profiles').doc(phone).get();
                if (doc.exists) {
                    const data = doc.data();
                    window.userProfileCache[phone] = {
                        name: data.name || null,
                        username: data.username || null,
                        loaded: true,
                    };
                    return window.userProfileCache[phone];
                }
            } catch (e) { console.warn('Profile fetch failed for ' + phone, e); }

            window.userProfileCache[phone] = { name: null, username: null, loaded: true };
            return null;
        };
    }

    if (typeof window.getDisplayNameForPeer !== 'function') {
        window.getDisplayNameForPeer = function (phone) {
            const saved = typeof window.getContactName === 'function' ? window.getContactName(phone) : null;
            if (saved) return saved;
            const cached = (window.userProfileCache || {})[phone];
            if (cached && cached.name) return cached.name;
            return phone;
        };
    }

    // ────────────────────────────────────────────────────────────
    // 7. INJECT "Invite" BUTTON INTO CONTACT PROFILE
    // ────────────────────────────────────────────────────────────
    function injectInviteButton() {
        const profileOverlay = document.getElementById('contactProfileOverlay');
        if (!profileOverlay || profileOverlay.style.display === 'none') return;

        if (document.getElementById('contactProfileInvite')) return;

        const msgBtn = document.getElementById('contactProfileMessage');
        if (!msgBtn || !msgBtn.parentNode) return;

        const inviteBtn = document.createElement('button');
        inviteBtn.id = 'contactProfileInvite';
        inviteBtn.style.cssText = 'padding:0.6rem 1.5rem;border-radius:30px;border:1px solid rgba(110,231,255,0.2);background:rgba(110,231,255,0.08);color:#6ee7ff;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:0.5rem;';
        inviteBtn.innerHTML = '<i class="fas fa-share-nodes"></i> Invite';
        inviteBtn.addEventListener('click', () => {
            let peer = window.currentProfilePeer;
            if (!peer) {
                const phoneEl = document.getElementById('contactProfilePhone');
                if (phoneEl) {
                    const m = phoneEl.textContent.match(/(\d{10})/);
                    if (m) peer = m[1];
                }
            }
            if (peer) shareInviteForPeer(peer);
        });

        msgBtn.parentNode.appendChild(inviteBtn);
    }

    const observer = new MutationObserver(() => {
        const overlay = document.getElementById('contactProfileOverlay');
        if (overlay && overlay.style.display === 'flex') injectInviteButton();
    });
    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['style'],
        subtree: true,
    });
    setTimeout(injectInviteButton, 500);

    // ────────────────────────────────────────────────────────────
    // 8. INJECT "Invite friends" + "Refresh" INTO SETTINGS
    // ────────────────────────────────────────────────────────────
    function injectSettingsButtons() {
        const settingsSection = document.querySelector('.settings-section');
        if (!settingsSection) return;

        const logoutBtn = settingsSection.querySelector('.logout-btn');

        if (!document.getElementById('inviteFriendsBtn')) {
            const row = document.createElement('div');
            row.className = 'setting-item';
            row.innerHTML = `
                <span><i class="fas fa-user-group"></i> Invite friends</span>
                <button class="reg-btn" id="inviteFriendsBtn" title="Share Sandesai">
                    <i class="fas fa-share-nodes"></i>
                </button>
            `;
            row.querySelector('#inviteFriendsBtn').addEventListener('click', shareInviteOpen);
            settingsSection.insertBefore(row, logoutBtn);
        }

        if (!document.getElementById('refreshConnectionBtn')) {
            const row = document.createElement('div');
            row.className = 'setting-item';
            row.innerHTML = `
                <span><i class="fas fa-sync-alt"></i> Refresh connection</span>
                <button class="reg-btn" id="refreshConnectionBtn" title="Reconnect to network">
                    <i class="fas fa-rotate-right"></i>
                </button>
            `;
            row.querySelector('#refreshConnectionBtn').addEventListener('click', window.refreshConnection);
            settingsSection.insertBefore(row, logoutBtn);
        }
    }

    setTimeout(injectSettingsButtons, 600);

    const origSwitchTab = window.switchTab;
    if (typeof origSwitchTab === 'function') {
        window.switchTab = function (tab) {
            const result = origSwitchTab.apply(this, arguments);
            if (tab === 'me') setTimeout(injectSettingsButtons, 100);
            return result;
        };
    }

    // ────────────────────────────────────────────────────────────
    // 9. BOOT — handle invite link on load
    // ────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(handleInviteFromURL, 700));
    } else {
        setTimeout(handleInviteFromURL, 700);
    }

    console.log('✨ enhancements.js loaded — invite, refresh, sync, profiles');
})();