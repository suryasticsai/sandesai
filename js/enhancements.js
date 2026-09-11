// ================================================================
// js/enhancements.js
// Adds NEW features on top of script.js without touching it:
//   • First-run registration gate
//   • Invite links (long URL, no external APIs)
//   • Invite overlay with phone + OTP + name
//   • Trap-mode: wrong-number invites register user but don't connect
//   • Unified welcome popup (logo hero + beating heart badge)
//   • Refresh connection
//   • Call log sync (Firestore <-> local)
//   • Profile lookup (name + username)
// ================================================================
(function () {
    'use strict';

    // ── Constants ──
    const INVITE_SECRET = 'sandesai-invite-v1-2026';
    const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    let bootHadInvite = false;

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
    // 2. HTML escape
    // ────────────────────────────────────────────────────────────
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    window.escapeHtml = escapeHtml;

    // ────────────────────────────────────────────────────────────
    // 3. SHARE INVITE — any app, no duplicate URL
    // ────────────────────────────────────────────────────────────
    async function shareInviteForPeer(peer) {
        if (!peer) { window.showToast && showToast('No contact selected'); return; }

        const userData = JSON.parse(localStorage.getItem('neonUser') || '{}');
        const me = localStorage.getItem('premCallNumber') || '';
        const senderName = userData.name || 'Someone';

        const token = createInviteToken({
            from: me, to: peer, chat: peer, name: senderName,
        });
        const url = buildInviteURL(token);

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

        const isAndroid = /Android/i.test(navigator.userAgent);
        const smsHref = isAndroid
            ? `sms:${peer}?body=${encodeURIComponent(text)}`
            : `sms:${peer}&body=${encodeURIComponent(text)}`;

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
            from: me, to: '', chat: me, name: senderName,
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
    // 4. SHARED REGISTRATION CORE
    // ────────────────────────────────────────────────────────────
    async function _finishRegistration(name, phone) {
        const userid = (name.toLowerCase().replace(/\s+/g, '') || 'user') +
                       '_' + Math.floor(1000 + Math.random() * 9000);

        const userData = { name, userid, phone, registered: true, status: 'online' };
        localStorage.setItem('neonUser', JSON.stringify(userData));
        localStorage.setItem('premCallNumber', phone);
        localStorage.setItem('premCallVerified', 'true');
        localStorage.setItem('premCallRegisteredAt', String(Date.now()));

        // Init PeerJS
        if (window.PremCall) {
            try {
                if (window.PremCall.reinit) window.PremCall.reinit(phone);
                else window.PremCall.init(phone);
            } catch (e) { console.warn('PremCall init failed:', e); }
        }

        // Init Firebase
        if (!window.firebaseReady && typeof window.initFirebaseMessaging === 'function') {
            window.initFirebaseMessaging();
        }

        // Publish profile + start sync
        setTimeout(() => {
            if (window.db && phone) {
                window.db.collection('profiles').doc(phone).set({
                    phone, name, username: userid, updatedAt: Date.now()
                }, { merge: true }).catch(() => {});
            }
            if (typeof window.initCallSignaling === 'function') window.initCallSignaling();
            if (typeof window.initCallLogSync === 'function') window.initCallLogSync();
        }, 1200);

        // Update UI bits
        const mn = document.getElementById('myNumberDisplay');
        if (mn) mn.textContent = phone;
        const dot = document.getElementById('headerStatusDot');
        if (dot) dot.className = 'status-dot connecting';
        if (typeof window.updateStatusBadge === 'function') window.updateStatusBadge(userData);
        if (typeof window.renderProfileView === 'function') window.renderProfileView();
        const link = document.querySelector('.registration-link');
        if (link) link.style.display = 'none';
    }

    // ────────────────────────────────────────────────────────────
    // 5. INVITE WELCOME OVERLAY (phone + OTP + name)
    // ────────────────────────────────────────────────────────────
    function showInviteWelcomeOverlay(payload) {
        document.getElementById('inviteWelcomeOverlay')?.remove();

        const isTargeted = !!(payload.to && payload.to.length === 10);
        const subtitle = isTargeted
            ? 'Someone invited you to Sandesai'
            : (payload.name
                ? `<b style="color:#c4b5fd">${escapeHtml(payload.name)}</b> wants to chat with you.`
                : 'Join the conversation.');

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
            overflow-y: auto;
        `;
        overlay.innerHTML = `
            <div style="max-width:380px; width:100%; background:rgba(18,16,36,0.96);
                        border:1px solid rgba(255,255,255,0.06); border-radius:28px;
                        padding:32px 24px; text-align:center;
                        box-shadow:0 40px 80px rgba(0,0,0,0.7);
                        margin:auto;">
                <img src="sandesai-logo.png" alt="Sandesai"
                     style="width:64px;height:64px;border-radius:50%;margin-bottom:12px;" />
                <div style="font-size:1.3rem;font-weight:700;margin-bottom:4px;">
                    You're invited to Sandesai
                </div>
                <div style="font-size:0.85rem;color:#7a89a8;margin-bottom:24px;">
                    ${subtitle}
                </div>

                <!-- Phone -->
                <div style="margin-bottom:14px;text-align:left;">
                    <label style="font-size:0.72rem;color:#7a89a8;
                                  text-transform:uppercase;letter-spacing:0.05em;">
                        Your number
                    </label>
                    <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                        <span style="padding:12px 14px;border-radius:14px;
                                     background:rgba(255,255,255,0.04);
                                     border:1px solid rgba(255,255,255,0.08);
                                     color:#a5b3d0;font-size:1rem;font-weight:600;
                                     white-space:nowrap;">+91</span>
                        <input id="invitePhone" type="tel" inputmode="numeric"
                               maxlength="10" placeholder="10-digit number"
                               value="${payload.to || ''}"
                               style="flex:1;min-width:0;padding:12px 14px;
                                      border-radius:14px;
                                      border:1px solid rgba(255,255,255,0.08);
                                      background:rgba(255,255,255,0.04);
                                      color:#eef0f5;font-size:16px;
                                      outline:none;font-family:inherit;
                                      letter-spacing:1px;" />
                    </div>
                </div>

                <!-- OTP -->
                <div style="margin-bottom:14px;text-align:left;">
                    <label style="font-size:0.72rem;color:#7a89a8;
                                  text-transform:uppercase;letter-spacing:0.05em;">
                        OTP
                    </label>
                    <div style="display:flex;gap:8px;margin-top:6px;">
                        <input id="inviteOtp" type="text" inputmode="numeric"
                               maxlength="6" placeholder="Enter OTP"
                               style="flex:1;min-width:0;padding:12px 14px;
                                      border-radius:14px;
                                      border:1px solid rgba(255,255,255,0.08);
                                      background:rgba(255,255,255,0.04);
                                      color:#eef0f5;font-size:16px;
                                      outline:none;font-family:inherit;
                                      letter-spacing:2px;" />
                        <button id="inviteSendOtp" type="button"
                                style="padding:12px 16px;border-radius:14px;
                                       border:1px solid rgba(139,92,246,0.25);
                                       background:rgba(139,92,246,0.12);
                                       color:#a78bfa;font-weight:600;
                                       font-size:0.78rem;cursor:pointer;
                                       white-space:nowrap;font-family:inherit;
                                       transition:background 0.2s, transform 0.1s;">
                            Send OTP
                        </button>
                    </div>
                </div>

                <!-- Name -->
                <div style="margin-bottom:16px;text-align:left;">
                    <label style="font-size:0.72rem;color:#7a89a8;
                                  text-transform:uppercase;letter-spacing:0.05em;">
                        Your name
                    </label>
                    <input id="inviteName" type="text" placeholder="e.g. Ananya"
                           style="width:100%;margin-top:6px;padding:12px 14px;
                                  border-radius:14px;
                                  border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);
                                  color:#eef0f5;font-size:16px;
                                  outline:none;font-family:inherit;" />
                </div>

                <button id="inviteJoinBtn"
                        style="width:100%;padding:14px;border-radius:16px;border:none;
                               background:linear-gradient(135deg,#7c3aed,#6d28d9);
                               color:#fff;font-weight:700;font-size:1rem;cursor:pointer;
                               font-family:inherit;
                               box-shadow:0 8px 24px rgba(139,92,246,0.35);
                               transition:transform 0.1s;">
                    🚀 Join & open chat
                </button>

                <div style="margin-top:12px;font-size:0.7rem;color:#5a6885;">
                    By joining you agree to the Sandesai terms.
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Send OTP
        document.getElementById('inviteSendOtp').addEventListener('click', () => {
            const phone = document.getElementById('invitePhone').value.trim();
            if (!phone || !/^\d{10}$/.test(phone)) {
                window.showToast && showToast('Please enter a valid 10-digit number');
                return;
            }
            window.showToast && showToast(`📱 OTP sent to +91 ${phone} (Demo: 1234)`);
            document.getElementById('inviteOtp').value = '1234';
        });

        // Join
        document.getElementById('inviteJoinBtn').addEventListener('click', async () => {
            const name = (document.getElementById('inviteName').value || '').trim();
            const phone = (document.getElementById('invitePhone').value || '').trim();
            const otp = (document.getElementById('inviteOtp').value || '').trim();

            if (!phone || !/^\d{10}$/.test(phone)) {
                window.showToast && showToast('Please enter a valid 10-digit number');
                return;
            }
            if (!otp) {
                window.showToast && showToast('Please enter the OTP');
                return;
            }
            if (otp !== '1234') {
                window.showToast && showToast('Invalid OTP. Use 1234 (demo)');
                return;
            }
            if (!name) {
                window.showToast && showToast('Please enter your name');
                return;
            }

            const isIntendedRecipient = !isTargeted || phone === payload.to;

            if (isIntendedRecipient) {
                autoRegisterFromInvite(payload, name, phone, payload.from || payload.chat);
            } else {
                autoRegisterAsNewUser(name, phone);
            }
        });

        setTimeout(() => document.getElementById('invitePhone')?.focus(), 400);
    }

    // ────────────────────────────────────────────────────────────
    // 6. AUTO-REGISTER PATHS
    // ────────────────────────────────────────────────────────────
    async function autoRegisterFromInvite(payload, name, phone, openChatWith) {
        if (!phone) { window.showToast && showToast('Missing phone number'); return; }

        const btn = document.getElementById('inviteJoinBtn');
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.75';
            btn.textContent = 'Creating your account…';
        }

        await _finishRegistration(name, phone);
        document.getElementById('inviteWelcomeOverlay')?.remove();

        showWelcomePopup(name);
        if (openChatWith) openChatWhenReady(openChatWith);
    }

    async function autoRegisterAsNewUser(name, phone) {
        if (!phone) return;

        const btn = document.getElementById('inviteJoinBtn');
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.75';
            btn.textContent = 'Creating your account…';
        }

        await _finishRegistration(name, phone);
        document.getElementById('inviteWelcomeOverlay')?.remove();

        showWrongInvitePopup(name);

        setTimeout(() => {
            if (typeof window.switchTab === 'function') window.switchTab('chat');
            if (typeof window.renderChatList === 'function') window.renderChatList();
        }, 400);
    }

    // ────────────────────────────────────────────────────────────
    // 7. OPEN CHAT WHEN READY
    // ────────────────────────────────────────────────────────────
    function openChatWhenReady(peer, maxWaitMs = 10000) {
        const start = Date.now();
        function attempt() {
            const ready = window.firebaseReady && window.myNumber;
            if (ready || Date.now() - start > maxWaitMs) {
                if (typeof window.switchTab === 'function') window.switchTab('chat');
                if (typeof window.openChat === 'function') window.openChat(peer);
                console.log('💬 Opened chat with', peer, '(ready:', ready, ')');
                return;
            }
            setTimeout(attempt, 250);
        }
        attempt();
    }
    window.openChatWhenReady = openChatWhenReady;

    // ────────────────────────────────────────────────────────────
    // 8. UNIFIED WELCOME POPUP (logo hero + heart badge + sparkles)
    //    variant: 'welcome'      → normal join, ☝️ hint about ⋮ menu
    //    variant: 'wrong-invite' → trap path, gentle "wasn't for you"
    // ────────────────────────────────────────────────────────────
    function showJoinWelcomePopup(name, variant) {
        document.getElementById('welcomePopup')?.remove();

        if (!document.getElementById('welcomePopupStyles')) {
            const s = document.createElement('style');
            s.id = 'welcomePopupStyles';
            s.textContent = `
                @keyframes wpopHeartBeat {
                    0%, 100% { transform: scale(1); }
                    20%      { transform: scale(1.25); }
                    35%      { transform: scale(1.08); }
                    50%      { transform: scale(1.28); }
                    70%      { transform: scale(1); }
                }
                @keyframes wpopGlowPulse {
                    0%, 100% { opacity: 0.45; transform: scale(0.9); }
                    50%      { opacity: 0.95; transform: scale(1.15); }
                }
                @keyframes wpopArrowBounce {
                    0%, 100% { transform: translateY(0); }
                    50%      { transform: translateY(-6px); }
                }
                @keyframes wpopSparkle {
                    0%   { transform: translateY(0)    scale(0.5); opacity: 0; }
                    25%  { opacity: 1; }
                    100% { transform: translateY(-38px) scale(1);   opacity: 0; }
                }
                @keyframes wpopShimmer {
                    0%   { background-position: -200% center; }
                    100% { background-position:  200% center; }
                }
                .wpop-shimmer {
                    background: linear-gradient(
                        90deg,
                        #a78bfa 0%,
                        #ffffff 50%,
                        #a78bfa 100%
                    );
                    background-size: 200% auto;
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    animation: wpopShimmer 3s linear infinite;
                }
            `;
            document.head.appendChild(s);
        }

        const isWelcome = variant === 'welcome';

        const heading = isWelcome
            ? `Welcome, ${escapeHtml(name || 'friend')}!`
            : `Welcome aboard, ${escapeHtml(name || 'friend')}!`;

        const bodyText = isWelcome
            ? `You're all set. Tap the <b style="color:#c4b5fd;">⋮ menu</b>
               at the top right anytime to invite friends, refresh your
               connection, or explore settings.`
            : `Heads up — that invite was created for a different number,
               so we didn't connect you with its sender. But you're all set.
               Enjoy Sandesai — start your own chats and invite friends anytime.`;

        const heartGlow = isWelcome
            ? 'rgba(236,72,153,0.55)'
            : 'rgba(110,231,255,0.5)';
        const logoGlow = isWelcome
            ? 'rgba(139,92,246,0.5)'
            : 'rgba(110,231,255,0.4)';

        const popup = document.createElement('div');
        popup.id = 'welcomePopup';
        popup.style.cssText = `
            position: fixed; inset: 0; z-index: 9000;
            background: rgba(8,6,20,0.85);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            display: flex; align-items: center; justify-content: center;
            padding: 24px;
            font-family: 'Inter', sans-serif;
            color: #eef0f5;
            opacity: 0;
            transition: opacity 0.35s ease;
        `;

        popup.innerHTML = `
            <div style="max-width:340px; width:100%;
                        background: rgba(18,16,36,0.96);
                        border:1px solid rgba(255,255,255,0.07);
                        border-radius:24px; padding:28px 24px 24px;
                        text-align:center;
                        box-shadow: 0 40px 100px rgba(0,0,0,0.75);
                        position:relative; overflow:hidden;">

                ${isWelcome ? `
                    <div style="position:relative; height:30px; margin-bottom:2px;">
                        <div style="position:absolute; top:0; right:4px;
                                    font-size:22px; line-height:1;
                                    animation: wpopArrowBounce 1.4s ease-in-out infinite;">
                            ☝️
                        </div>
                    </div>
                ` : ''}

                <!-- Logo hero + heart badge + sparkles -->
                <div style="position:relative; width:132px; height:132px;
                            margin:6px auto 10px;">

                    <!-- Ambient glow behind logo -->
                    <div style="position:absolute; inset:0; border-radius:50%;
                                background: radial-gradient(circle,
                                    ${logoGlow} 0%, transparent 72%);
                                animation: wpopGlowPulse 1.8s ease-in-out infinite;
                                filter: blur(10px);"></div>

                    <!-- Drifting sparkles -->
                    <span style="position:absolute; left:-6px; top:24%;
                                 font-size:13px; color:#c4b5fd;
                                 animation: wpopSparkle 2.6s ease-in-out infinite;
                                 animation-delay: 0s;">✦</span>
                    <span style="position:absolute; right:-4px; bottom:30%;
                                 font-size:11px; color:#6ee7ff;
                                 animation: wpopSparkle 2.6s ease-in-out infinite;
                                 animation-delay: 0.8s;">✦</span>
                    <span style="position:absolute; left:18%; bottom:-2px;
                                 font-size:12px; color:#a78bfa;
                                 animation: wpopSparkle 2.6s ease-in-out infinite;
                                 animation-delay: 1.6s;">✦</span>

                    <!-- Logo -->
                    <img src="sandesai-logo.png" alt="Sandesai"
                         style="position:absolute; left:50%; top:50%;
                                transform: translate(-50%, -50%);
                                width:100px; height:100px;
                                border-radius:50%;
                                border:2px solid rgba(139,92,246,0.35);
                                box-shadow:
                                    0 0 40px ${logoGlow},
                                    0 10px 30px rgba(0,0,0,0.55);
                                object-fit:cover;" />

                    <!-- Beating heart badge -->
                    <div style="position:absolute; right:6px; bottom:6px;
                                width:38px; height:38px;
                                border-radius:50%;
                                background: linear-gradient(135deg, #ec4899, #7c3aed);
                                display:flex; align-items:center; justify-content:center;
                                font-size:19px; line-height:1;
                                border:2px solid rgba(18,16,36,0.95);
                                box-shadow: 0 4px 18px ${heartGlow};
                                animation: wpopHeartBeat 1.5s ease-in-out infinite;">
                        ${isWelcome ? '💜' : '🤍'}
                    </div>
                </div>

                <div class="wpop-shimmer"
                     style="font-size:1.35rem; font-weight:700;
                            margin-bottom:10px;">
                    ${heading}
                </div>

                <div style="font-size:0.85rem; color:#a5b3d0; line-height:1.55;
                            margin-bottom:22px;">
                    ${bodyText}
                </div>

                <button id="welcomeGotItBtn"
                        style="width:100%; padding:13px; border-radius:14px; border:none;
                               background:linear-gradient(135deg,#7c3aed,#6d28d9);
                               color:#fff; font-weight:700; font-size:0.95rem;
                               cursor:pointer; font-family:inherit;
                               box-shadow:0 8px 24px rgba(139,92,246,0.4);
                               transition:transform 0.1s;">
                    Got it →
                </button>
            </div>
        `;

        document.body.appendChild(popup);
        requestAnimationFrame(() => { popup.style.opacity = '1'; });

        const dismiss = () => {
            popup.style.opacity = '0';
            setTimeout(() => popup.remove(), 350);
        };

        document.getElementById('welcomeGotItBtn').addEventListener('click', dismiss);
        setTimeout(() => { if (popup.parentNode) dismiss(); }, isWelcome ? 7500 : 9000);
    }

    function showWelcomePopup(name) {
        showJoinWelcomePopup(name, 'welcome');
    }

    function showWrongInvitePopup(name) {
        showJoinWelcomePopup(name, 'wrong-invite');
    }

    window.showJoinWelcomePopup = showJoinWelcomePopup;
    window.showWelcomePopup = showWelcomePopup;
    window.showWrongInvitePopup = showWrongInvitePopup;

    // ────────────────────────────────────────────────────────────
    // 9. INVITE URL HANDLER
    // ────────────────────────────────────────────────────────────
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
    // 10. REFRESH CONNECTION
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
    // 11. CALL LOG SYNC
    // ────────────────────────────────────────────────────────────
    if (typeof window.initCallLogSync !== 'function') {
        window.callLogsUnsub = null;
        window.initCallLogSync = function () {
            if (!window.db || !window.myNumber) return;
            if (window.callLogsUnsub) {
                try { window.callLogsUnsub(); } catch (e) {}
                window.callLogsUnsub = null;
            }

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
    // 12. PROFILE LOOKUP
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
    // 13. INJECT "Invite" BUTTON INTO CONTACT PROFILE
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
    // 14. INJECT "Invite friends" + "Refresh" INTO SETTINGS
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
    // 15. FIRST-RUN REGISTRATION GATE
    // ────────────────────────────────────────────────────────────
    function isRegistered() {
        return !!localStorage.getItem('premCallRegisteredAt') &&
               localStorage.getItem('premCallVerified') === 'true' &&
               !!localStorage.getItem('premCallNumber');
    }

    function showBootRegistrationScreen() {
        if (document.getElementById('bootRegScreen')) return;
        if (document.getElementById('inviteWelcomeOverlay')) return;

        if (!document.getElementById('bootRegStyles')) {
            const style = document.createElement('style');
            style.id = 'bootRegStyles';
            style.textContent = `
                @keyframes bootCardIn {
                    from { opacity: 0; transform: translateY(24px) scale(0.98); }
                    to   { opacity: 1; transform: translateY(0)    scale(1);    }
                }
                #bootRegScreen input:focus {
                    border-color: rgba(139,92,246,0.5) !important;
                    background: rgba(255,255,255,0.06) !important;
                }
                #bootRegScreen button:active { transform: scale(0.97); }
            `;
            document.head.appendChild(style);
        }

        const screen = document.createElement('div');
        screen.id = 'bootRegScreen';
        screen.style.cssText = `
            position: fixed; inset: 0; z-index: 100000;
            background: #07050e;
            overflow-y: auto;
            padding: 32px 24px;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #eef0f5;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
        `;

        const bg = document.createElement('div');
        bg.style.cssText = `
            position: fixed; inset: 0; z-index: -1;
            background:
                radial-gradient(circle at 20% 15%, rgba(139,92,246,0.20), transparent 55%),
                radial-gradient(circle at 80% 85%, rgba(110,231,255,0.15), transparent 55%),
                radial-gradient(circle at 50% 50%, rgba(124,58,237,0.08), transparent 70%);
            pointer-events: none;
        `;
        screen.appendChild(bg);

        const card = document.createElement('div');
        card.style.cssText = `
            max-width: 400px; width: 100%;
            margin: auto 0;
            background: rgba(18, 16, 36, 0.88);
            backdrop-filter: blur(28px);
            -webkit-backdrop-filter: blur(28px);
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 28px;
            padding: 36px 28px 28px;
            box-shadow: 0 40px 100px rgba(0, 0, 0, 0.7);
            animation: bootCardIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;

        card.innerHTML = `
            <div style="text-align:center; margin-bottom:28px;">
                <img src="sandesai-logo.png" alt="Sandesai"
                     style="width:88px; height:88px; border-radius:50%;
                            margin:0 auto 14px; display:block;
                            border:2px solid rgba(139,92,246,0.3);
                            box-shadow: 0 0 60px rgba(139,92,246,0.4),
                                        0 0 100px rgba(110,231,255,0.15);" />
                <div style="font-size:1.75rem; font-weight:700; letter-spacing:-0.02em;
                            background: linear-gradient(135deg,#a78bfa,#6ee7ff);
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;">
                    Sandesai
                </div>
                <div style="font-size:0.85rem; color:#7a89a8; margin-top:6px;">
                    Sign up to get started
                </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:14px;">
                <div>
                    <label style="font-size:0.72rem; color:#7a89a8;
                                  text-transform:uppercase; letter-spacing:0.06em;
                                  display:block; margin-bottom:6px; font-weight:500;">
                        Name
                    </label>
                    <input id="bootRegName" type="text" placeholder="Your name"
                           autocomplete="name"
                           style="width:100%; padding:13px 16px;
                                  border-radius:14px;
                                  border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);
                                  color:#eef0f5; font-size:16px;
                                  outline:none; font-family:inherit;
                                  transition:border-color 0.2s, background 0.2s;" />
                </div>

                <div>
                    <label style="font-size:0.72rem; color:#7a89a8;
                                  text-transform:uppercase; letter-spacing:0.06em;
                                  display:block; margin-bottom:6px; font-weight:500;">
                        Username
                    </label>
                    <input id="bootRegUserid" type="text" placeholder="Choose a unique ID"
                           autocomplete="username"
                           style="width:100%; padding:13px 16px;
                                  border-radius:14px;
                                  border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);
                                  color:#eef0f5; font-size:16px;
                                  outline:none; font-family:inherit;
                                  transition:border-color 0.2s, background 0.2s;" />
                </div>

                <div>
                    <label style="font-size:0.72rem; color:#7a89a8;
                                  text-transform:uppercase; letter-spacing:0.06em;
                                  display:block; margin-bottom:6px; font-weight:500;">
                        Phone Number
                    </label>
                    <input id="bootRegPhone" type="tel" placeholder="10-digit number"
                           maxlength="10" inputmode="numeric" autocomplete="tel"
                           style="width:100%; padding:13px 16px;
                                  border-radius:14px;
                                  border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);
                                  color:#eef0f5; font-size:16px;
                                  outline:none; font-family:inherit;
                                  transition:border-color 0.2s, background 0.2s;" />
                </div>

                <div>
                    <label style="font-size:0.72rem; color:#7a89a8;
                                  text-transform:uppercase; letter-spacing:0.06em;
                                  display:block; margin-bottom:6px; font-weight:500;">
                        OTP
                    </label>
                    <div style="display:flex; gap:8px;">
                        <input id="bootRegOtp" type="text" placeholder="Enter OTP"
                               inputmode="numeric" maxlength="6"
                               style="flex:1; min-width:0;
                                      padding:13px 16px;
                                      border-radius:14px;
                                      border:1px solid rgba(255,255,255,0.08);
                                      background:rgba(255,255,255,0.04);
                                      color:#eef0f5; font-size:16px;
                                      outline:none; font-family:inherit;
                                      transition:border-color 0.2s, background 0.2s;" />
                        <button id="bootRegSendOtp" type="button"
                                style="padding:13px 18px; border-radius:14px;
                                       border:1px solid rgba(139,92,246,0.25);
                                       background:rgba(139,92,246,0.12);
                                       color:#a78bfa; font-weight:600;
                                       font-size:0.8rem; cursor:pointer;
                                       white-space:nowrap; font-family:inherit;
                                       transition:background 0.2s, transform 0.1s;">
                            Send OTP
                        </button>
                    </div>
                </div>
            </div>

            <button id="bootRegSubmit" type="button"
                    style="width:100%; padding:15px; border-radius:16px; border:none;
                           background:linear-gradient(135deg,#7c3aed,#6d28d9);
                           color:#fff; font-weight:700; font-size:1rem;
                           cursor:pointer; font-family:inherit; margin-top:22px;
                           box-shadow: 0 8px 24px rgba(139,92,246,0.35);
                           transition:transform 0.1s, box-shadow 0.2s;">
                Register
            </button>

            <div style="margin-top:16px; text-align:center;
                        font-size:0.7rem; color:#5a6885; line-height:1.5;">
                By registering you agree to Sandesai's terms<br />and privacy policy.
            </div>
        `;
        screen.appendChild(card);
        document.body.appendChild(screen);

        document.getElementById('bootRegSendOtp').addEventListener('click', () => {
            const phone = document.getElementById('bootRegPhone').value.trim();
            if (!phone || !/^\d{10}$/.test(phone)) {
                window.showToast && showToast('Please enter a valid 10-digit number');
                return;
            }
            window.showToast && showToast(`📱 OTP sent to ${phone} (Demo: 1234)`);
            document.getElementById('bootRegOtp').value = '1234';
        });

        const submitBtn = document.getElementById('bootRegSubmit');
        submitBtn.addEventListener('click', async () => {
            const name = document.getElementById('bootRegName').value.trim();
            const userid = document.getElementById('bootRegUserid').value.trim();
            const phone = document.getElementById('bootRegPhone').value.trim();
            const otp = document.getElementById('bootRegOtp').value.trim();

            if (!name)   { window.showToast && showToast('Please enter your name'); return; }
            if (!userid) { window.showToast && showToast('Please choose a username'); return; }
            if (!phone || !/^\d{10}$/.test(phone)) {
                window.showToast && showToast('Please enter a valid 10-digit number');
                return;
            }
            if (!otp) { window.showToast && showToast('Please enter the OTP'); return; }
            if (otp !== '1234') {
                window.showToast && showToast('Invalid OTP. Use 1234 (demo)');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.7';
            submitBtn.textContent = 'Registering…';

            await _finishRegistration(name, phone);

            const screenEl = document.getElementById('bootRegScreen');
            if (screenEl) {
                screenEl.style.transition = 'opacity 0.45s ease';
                screenEl.style.opacity = '0';
                setTimeout(() => screenEl.remove(), 500);
            }

            window.showToast && showToast('✅ Welcome to Sandesai, ' + name + '!');

            setTimeout(() => {
                if (typeof window.renderChatList === 'function') window.renderChatList();
                if (typeof window.renderCallList === 'function') window.renderCallList();
            }, 600);
        });

        document.getElementById('bootRegOtp').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitBtn.click();
        });

        setTimeout(() => document.getElementById('bootRegName')?.focus(), 400);
    }

    function bootRegistrationGate() {
        if (document.getElementById('inviteWelcomeOverlay')) return;
        if (isRegistered()) return;

        if (bootHadInvite) {
            setTimeout(() => {
                if (document.getElementById('inviteWelcomeOverlay')) return;
                if (isRegistered()) return;
                showBootRegistrationScreen();
            }, 1500);
            return;
        }

        showBootRegistrationScreen();
    }

    window.showBootRegistrationScreen = showBootRegistrationScreen;

    // ────────────────────────────────────────────────────────────
    // 16. BOOT
    // ────────────────────────────────────────────────────────────
    function onBoot() {
        const params = new URLSearchParams(location.search);
        bootHadInvite = params.has('join') || params.has('invite');

        setTimeout(() => { handleInviteFromURL(); }, 700);
        setTimeout(() => { bootRegistrationGate(); }, 1300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onBoot);
    } else {
        onBoot();
    }

    console.log('✨ enhancements.js loaded — boot gate, invite, welcome, refresh, sync, profiles');
})();