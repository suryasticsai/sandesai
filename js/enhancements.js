// ================================================================
// js/enhancements.js
// Adds NEW features on top of script.js without touching it:
//   • First-run registration gate (name + username + phone + email + OTP)
//   • Email OTP send / verify (real, via Apps Script)
//   • Duplicate username / phone check
//   • Force update banner (from health endpoint)
//   • Invite links + auto-registration
//   • Trap-mode invites
//   • Welcome popup with animated heart
//   • Google Sheets logging (registrations, conversations)
//   • Refresh connection
//   • Call log sync
//   • Profile lookup
//   • Debug console: Copy button + settings toggle
//   • RAGina memory toggles
//   • Auto-loads raginaMemory.js
// ================================================================
(function () {
    'use strict';

    const INVITE_SECRET = 'sandesai-invite-v1-2026';
    const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    // ════════════════════════════════════════════════════════════
    // CONFIG — read from config.js, with fallback
    // ════════════════════════════════════════════════════════════
    const CFG = window.SANDESAI || {};
    const SHEET_WEBHOOK_URL = CFG.SHEET_API_URL ||
        'https://script.google.com/macros/s/AKfycbwgv2ko4WgWQOJzKh3h0VdXZsETaZIHF7cM0Dxv5PM/exec';
    const SHEET_WEBHOOK_SECRET = CFG.SHEET_WEBHOOK_SECRET || 'sandesai-webhook-2026';

    // Local app version — compared against minAppVersion from backend
    const LOCAL_APP_VERSION = '0.4';

    let bootHadInvite = false;
    let forceUpdateShown = false;

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
    // 3. FORCE UPDATE CHECK
    // ────────────────────────────────────────────────────────────
    function versionLess(a, b) {
        const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
        const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const va = pa[i] || 0;
            const vb = pb[i] || 0;
            if (va < vb) return true;
            if (va > vb) return false;
        }
        return false;
    }

    function showForceUpdateBanner(message) {
        if (forceUpdateShown) return;
        forceUpdateShown = true;
        document.getElementById('forceUpdateBanner')?.remove();

        const banner = document.createElement('div');
        banner.id = 'forceUpdateBanner';
        banner.style.cssText = `
            position: fixed; inset: 0; z-index: 95000;
            background: rgba(8,6,20,0.96);
            backdrop-filter: blur(20px);
            display: flex; align-items: center; justify-content: center;
            padding: 24px;
            font-family: 'Inter', sans-serif;
            color: #eef0f5;
        `;
        banner.innerHTML = `
            <div style="max-width:360px; width:100%; text-align:center;
                        background: rgba(18,16,36,0.96);
                        border: 1px solid rgba(139,92,246,0.3);
                        border-radius: 24px; padding: 32px 24px;
                        box-shadow: 0 40px 100px rgba(0,0,0,0.8);">
                <div style="font-size: 2.4rem; margin-bottom: 12px;">🚀</div>
                <div style="font-size: 1.2rem; font-weight: 700; margin-bottom: 10px;">
                    Update required
                </div>
                <div style="font-size: 0.85rem; color: #a5b3d0; line-height: 1.5;
                            margin-bottom: 22px;">
                    ${escapeHtml(message || 'A new version of Sandesai is available. Please refresh to continue.')}
                </div>
                <button id="forceUpdateBtn"
                        style="width: 100%; padding: 14px; border-radius: 14px;
                               border: none;
                               background: linear-gradient(135deg, #7c3aed, #6d28d9);
                               color: #fff; font-weight: 700; font-size: 1rem;
                               cursor: pointer; font-family: inherit;
                               box-shadow: 0 8px 24px rgba(139,92,246,0.4);">
                    Refresh now
                </button>
            </div>
        `;
        document.body.appendChild(banner);
        document.getElementById('forceUpdateBtn').addEventListener('click', () => {
            location.reload(true);
        });
    }

    async function checkForceUpdate() {
        try {
            const r = await fetch(SHEET_WEBHOOK_URL + '?type=health');
            const data = await r.json();
            if (!data.ok) return;

            const minV = data.minAppVersion;
            if (minV && versionLess(LOCAL_APP_VERSION, minV)) {
                console.warn('🚨 Force update required:', LOCAL_APP_VERSION, '<', minV);
                showForceUpdateBanner(data.updateMessage);
                return true;
            }
        } catch (e) {
            console.warn('Force update check failed:', e);
        }
        return false;
    }

    // ────────────────────────────────────────────────────────────
    // 4. REGISTRATION HELPERS
    // ────────────────────────────────────────────────────────────
    function waitForAuthUid(maxMs) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                const u = window.auth && window.auth.currentUser;
                if (u && u.uid) return resolve(u.uid);
                if (Date.now() - start > maxMs) return resolve('');
                setTimeout(tick, 150);
            };
            tick();
        });
    }

    async function logRegistrationToSheet(name, username, phone) {
        if (!SHEET_WEBHOOK_URL) return;
        const uid = await waitForAuthUid(8000);

        let finalUsername = username || '';
        try {
            const stored = JSON.parse(localStorage.getItem('neonUser') || '{}');
            if (stored.userid) finalUsername = stored.userid;
        } catch (e) {}

        try {
            await fetch(SHEET_WEBHOOK_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    secret: SHEET_WEBHOOK_SECRET,
                    name: name || '',
                    username: finalUsername,
                    phone: phone || '',
                    uid: uid || '',
                }),
            });
            console.log('📊 Registration sent to Sheet. UID:', uid || '(none)');
        } catch (e) {
            console.warn('📊 Sheet notification failed:', e);
        }
    }
    window.logRegistrationToSheet = logRegistrationToSheet;

    // ── Check duplicate phone / username before registering ──
    async function checkAvailability(username, phone) {
        try {
            const r = await fetch(SHEET_WEBHOOK_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    type: 'checkAvailability',
                    secret: SHEET_WEBHOOK_SECRET,
                    username: username,
                    phone: phone,
                }),
            });
            // no-cors means we can't read the response — fall back to a GET
            // We'll use the health endpoint response pattern via a separate GET
            // for real readability:

            const q = SHEET_WEBHOOK_URL +
                '?type=checkAvailability' +
                '&username=' + encodeURIComponent(username) +
                '&phone=' + encodeURIComponent(phone);
            const r2 = await fetch(q);
            return await r2.json();
        } catch (e) {
            console.warn('Availability check failed:', e);
            return { ok: true }; // assume available on failure so registration isn't blocked
        }
    }

    // ── Send OTP via email ──
    async function sendOtpEmail(phone, email) {
        try {
            await fetch(SHEET_WEBHOOK_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    type: 'sendOtp',
                    secret: SHEET_WEBHOOK_SECRET,
                    phone: phone,
                    email: email,
                }),
            });
            return { ok: true };
        } catch (e) {
            console.warn('sendOtp failed:', e);
            return { ok: false, error: e.message };
        }
    }

    // ── Verify OTP via GET (readable response) ──
    async function verifyOtpEmail(phone, code) {
        try {
            const url = SHEET_WEBHOOK_URL +
                '?type=checkOtp' +
                '&phone=' + encodeURIComponent(phone) +
                '&code=' + encodeURIComponent(code);
            const r = await fetch(url);
            return await r.json();
        } catch (e) {
            console.warn('verifyOtp failed:', e);
            return { ok: false, error: 'network', message: 'Could not verify.' };
        }
    }

    // ────────────────────────────────────────────────────────────
    // 5. SHARE INVITE
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
    // 6. SHARED REGISTRATION CORE
    // ────────────────────────────────────────────────────────────
    async function _finishRegistration(name, phone, preferredUserid) {
        const userid = preferredUserid ||
            ((name.toLowerCase().replace(/\s+/g, '') || 'user') +
             '_' + Math.floor(1000 + Math.random() * 9000));

        const userData = { name, userid, phone, registered: true, status: 'online' };
        localStorage.setItem('neonUser', JSON.stringify(userData));
        localStorage.setItem('premCallNumber', phone);
        localStorage.setItem('premCallVerified', 'true');
        localStorage.setItem('premCallRegisteredAt', String(Date.now()));

        if (window.PremCall) {
            try {
                if (window.PremCall.reinit) window.PremCall.reinit(phone);
                else window.PremCall.init(phone);
            } catch (e) { console.warn('PremCall init failed:', e); }
        }

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

        logRegistrationToSheet(name, userid, phone);

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
    // 7. INVITE WELCOME OVERLAY (email + OTP + name + phone)
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

                <div style="margin-bottom:14px;text-align:left;">
                    <label style="font-size:0.72rem;color:#7a89a8;
                                  text-transform:uppercase;letter-spacing:0.05em;">
                        Email
                    </label>
                    <input id="inviteEmail" type="email" placeholder="you@example.com"
                           autocomplete="email" inputmode="email"
                           style="width:100%;margin-top:6px;padding:12px 14px;
                                  border-radius:14px;
                                  border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);
                                  color:#eef0f5;font-size:16px;
                                  outline:none;font-family:inherit;" />
                </div>

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
                    <div id="inviteOtpStatus"
                         style="font-size:0.72rem; color:#7a89a8;
                                margin-top:6px; min-height:1em;"></div>
                </div>

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
        document.getElementById('inviteSendOtp').addEventListener('click', async function () {
            const phone = document.getElementById('invitePhone').value.trim();
            const email = document.getElementById('inviteEmail').value.trim();
            const status = document.getElementById('inviteOtpStatus');
            const btn = this;

            if (!phone || !/^\d{10}$/.test(phone)) {
                window.showToast && showToast('Please enter a valid 10-digit number');
                return;
            }
            if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                window.showToast && showToast('Please enter a valid email');
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Sending…';
            if (status) status.textContent = '';

            const result = await sendOtpEmail(phone, email);
            if (result.ok) {
                window.showToast && showToast('📧 Code sent to ' + email);
                if (status) status.textContent = 'Check your inbox (and spam) for the 6-digit code. Expires in 10 min.';

                let cd = 60;
                btn.textContent = 'Resend (' + cd + 's)';
                const tick = setInterval(() => {
                    cd--;
                    if (cd <= 0) {
                        clearInterval(tick);
                        btn.disabled = false;
                        btn.textContent = 'Send OTP';
                    } else {
                        btn.textContent = 'Resend (' + cd + 's)';
                    }
                }, 1000);
            } else {
                window.showToast && showToast('Could not send OTP: ' + (result.error || 'unknown'));
                btn.disabled = false;
                btn.textContent = 'Send OTP';
            }
        });

        // Join
        document.getElementById('inviteJoinBtn').addEventListener('click', async () => {
            const name = (document.getElementById('inviteName').value || '').trim();
            const phone = (document.getElementById('invitePhone').value || '').trim();
            const email = (document.getElementById('inviteEmail').value || '').trim();
            const otp = (document.getElementById('inviteOtp').value || '').trim();

            if (!phone || !/^\d{10}$/.test(phone)) {
                window.showToast && showToast('Please enter a valid 10-digit number');
                return;
            }
            if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                window.showToast && showToast('Please enter a valid email');
                return;
            }
            if (!otp) {
                window.showToast && showToast('Please enter the OTP');
                return;
            }
            if (!name) {
                window.showToast && showToast('Please enter your name');
                return;
            }

            const joinBtn = document.getElementById('inviteJoinBtn');
            joinBtn.disabled = true;
            joinBtn.textContent = 'Verifying…';

            const verify = await verifyOtpEmail(phone, otp);
            if (!verify.ok) {
                window.showToast && showToast('⚠️ ' + (verify.message || 'Invalid OTP'));
                joinBtn.disabled = false;
                joinBtn.textContent = '🚀 Join & open chat';
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
    // 8. AUTO-REGISTER PATHS
    // ────────────────────────────────────────────────────────────
    async function autoRegisterFromInvite(payload, name, phone, openChatWith) {
        if (!phone) { window.showToast && showToast('Missing phone number'); return; }
        await _finishRegistration(name, phone);
        document.getElementById('inviteWelcomeOverlay')?.remove();
        showWelcomePopup(name);
        if (openChatWith) openChatWhenReady(openChatWith);
    }

    async function autoRegisterAsNewUser(name, phone) {
        if (!phone) return;
        await _finishRegistration(name, phone);
        document.getElementById('inviteWelcomeOverlay')?.remove();
        showWrongInvitePopup(name);
        setTimeout(() => {
            if (typeof window.switchTab === 'function') window.switchTab('chat');
            if (typeof window.renderChatList === 'function') window.renderChatList();
        }, 400);
    }

    // ────────────────────────────────────────────────────────────
    // 9. OPEN CHAT WHEN READY
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
    // 10. WELCOME / WRONG-INVITE POPUP
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
                    background: linear-gradient(90deg,#a78bfa 0%,#ffffff 50%,#a78bfa 100%);
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

        const heartGlow = isWelcome ? 'rgba(236,72,153,0.55)' : 'rgba(110,231,255,0.5)';
        const logoGlow  = isWelcome ? 'rgba(139,92,246,0.5)'  : 'rgba(110,231,255,0.4)';

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

                <div style="position:relative; width:132px; height:132px;
                            margin:6px auto 10px;">
                    <div style="position:absolute; inset:0; border-radius:50%;
                                background: radial-gradient(circle,${logoGlow} 0%, transparent 72%);
                                animation: wpopGlowPulse 1.8s ease-in-out infinite;
                                filter: blur(10px);"></div>
                    <span style="position:absolute; left:-6px; top:24%;
                                 font-size:13px; color:#c4b5fd;
                                 animation: wpopSparkle 2.6s ease-in-out infinite;">✦</span>
                    <span style="position:absolute; right:-4px; bottom:30%;
                                 font-size:11px; color:#6ee7ff;
                                 animation: wpopSparkle 2.6s ease-in-out infinite;
                                 animation-delay: 0.8s;">✦</span>
                    <span style="position:absolute; left:18%; bottom:-2px;
                                 font-size:12px; color:#a78bfa;
                                 animation: wpopSparkle 2.6s ease-in-out infinite;
                                 animation-delay: 1.6s;">✦</span>

                    <img src="sandesai-logo.png" alt="Sandesai"
                         style="position:absolute; left:50%; top:50%;
                                transform: translate(-50%, -50%);
                                width:100px; height:100px;
                                border-radius:50%;
                                border:2px solid rgba(139,92,246,0.35);
                                box-shadow: 0 0 40px ${logoGlow}, 0 10px 30px rgba(0,0,0,0.55);
                                object-fit:cover;" />

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

    function showWelcomePopup(name) { showJoinWelcomePopup(name, 'welcome'); }
    function showWrongInvitePopup(name) { showJoinWelcomePopup(name, 'wrong-invite'); }
    window.showJoinWelcomePopup = showJoinWelcomePopup;
    window.showWelcomePopup = showWelcomePopup;
    window.showWrongInvitePopup = showWrongInvitePopup;

    // ────────────────────────────────────────────────────────────
    // 11. INVITE URL HANDLER
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
    // 12. REFRESH CONNECTION
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
    // 13. CALL LOG SYNC
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
                    } catch (e) {}
                }, err => console.warn('Call log listener error:', err));
        };
    }

    // ────────────────────────────────────────────────────────────
    // 14. PROFILE LOOKUP
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
            } catch (e) {}
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
    // 15. INJECT INVITE BUTTON INTO CONTACT PROFILE
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
        attributes: true, attributeFilter: ['style'], subtree: true,
    });
    setTimeout(injectInviteButton, 500);

    // ────────────────────────────────────────────────────────────
    // 16. INJECT SETTINGS ROWS
    // ────────────────────────────────────────────────────────────
    function injectSettingsButtons() {
        const settingsSection = document.querySelector('.settings-section');
        if (!settingsSection) return;
        const logoutBtn = settingsSection.querySelector('.logout-btn');
        if (!logoutBtn) return;

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

        if (!document.getElementById('raginaMemoryToggle')) {
            const consent = (window.RaginaMemory && window.RaginaMemory.getConsent()) || { memory: false };
            const row = document.createElement('div');
            row.className = 'setting-item';
            row.innerHTML = `
                <span><i class="fas fa-brain"></i> RAGina memory</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="raginaMemoryToggle" ${consent.memory ? 'checked' : ''} />
                    <span class="toggle-slider"></span>
                </label>
            `;
            settingsSection.insertBefore(row, logoutBtn);
            row.querySelector('#raginaMemoryToggle').addEventListener('change', function () {
                const c = (window.RaginaMemory && window.RaginaMemory.getConsent()) || {};
                c.memory = this.checked;
                c.at = Date.now();
                if (window.RaginaMemory) window.RaginaMemory.setConsent(c);
                window.showToast && showToast(this.checked ? '🧠 RAGina will remember' : '🧠 Memory off');
            });
        }

        if (!document.getElementById('raginaChatContextToggle')) {
            const consent = (window.RaginaMemory && window.RaginaMemory.getConsent()) || { chats: false };
            const row = document.createElement('div');
            row.className = 'setting-item';
            row.innerHTML = `
                <span><i class="fas fa-comments"></i> Use chats as context</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="raginaChatContextToggle" ${consent.chats ? 'checked' : ''} />
                    <span class="toggle-slider"></span>
                </label>
            `;
            settingsSection.insertBefore(row, logoutBtn);
            row.querySelector('#raginaChatContextToggle').addEventListener('change', function () {
                const c = (window.RaginaMemory && window.RaginaMemory.getConsent()) || {};
                c.chats = this.checked;
                c.at = Date.now();
                if (window.RaginaMemory) window.RaginaMemory.setConsent(c);
                window.showToast && showToast(this.checked ? '💬 Chat context enabled' : '💬 Chat context off');
            });
        }

        if (!document.getElementById('debugConsoleToggle')) {
            const saved = localStorage.getItem('debugConsoleVisible');
            const visible = saved === null ? true : saved === 'true';
            const row = document.createElement('div');
            row.className = 'setting-item';
            row.innerHTML = `
                <span><i class="fas fa-terminal"></i> Debug console</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="debugConsoleToggle" ${visible ? 'checked' : ''} />
                    <span class="toggle-slider"></span>
                </label>
            `;
            settingsSection.insertBefore(row, logoutBtn);
            const toggle = row.querySelector('#debugConsoleToggle');
            const debugFab = document.getElementById('debugToggle');
            if (debugFab) debugFab.style.display = visible ? '' : 'none';
            toggle.addEventListener('change', function () {
                const v = this.checked;
                if (debugFab) debugFab.style.display = v ? '' : 'none';
                localStorage.setItem('debugConsoleVisible', String(v));
                if (!v) {
                    const c = document.getElementById('debugConsole');
                    if (c) c.style.transform = 'translateY(100%)';
                    const dt = document.getElementById('debugToggle');
                    if (dt) dt.innerHTML = '<i class="fas fa-terminal"></i>';
                }
                window.showToast && showToast(v ? '🐞 Debug button shown' : '🐞 Debug button hidden');
            });
        }
    }

    // ────────────────────────────────────────────────────────────
    // 17. COPY BUTTON IN DEBUG CONSOLE
    // ────────────────────────────────────────────────────────────
    function injectConsoleCopyButton() {
        const clearBtn = document.getElementById('consoleClear');
        if (!clearBtn) return;
        const actions = clearBtn.parentNode;
        if (!actions || document.getElementById('consoleCopy')) return;

        const copyBtn = document.createElement('button');
        copyBtn.id = 'consoleCopy';
        copyBtn.textContent = '📋 Copy';
        copyBtn.style.cssText = 'background:rgba(255,255,255,0.04);border:none;color:#a5b3d0;padding:2px 10px;border-radius:8px;font-size:10px;cursor:pointer;font-family:inherit;';
        copyBtn.addEventListener('click', async () => {
            const body = document.getElementById('consoleBody');
            if (!body) return;
            const text = (body.innerText || body.textContent || '').trim();
            if (!text) { window.showToast && showToast('Console is empty'); return; }
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                }
                copyBtn.textContent = '✅ Copied';
                setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
                window.showToast && showToast('📋 Console copied');
            } catch (e) {
                window.showToast && showToast('Copy failed: ' + e.message);
            }
        });
        actions.insertBefore(copyBtn, clearBtn);
    }

    // ────────────────────────────────────────────────────────────
    // 18. AUTO-LOAD raginaMemory.js
    // ────────────────────────────────────────────────────────────
    (function loadRaginaMemory() {
        if (document.querySelector('script[src*="raginaMemory.js"]')) return;
        const s = document.createElement('script');
        s.src = 'js/raginaMemory.js';
        s.onload = () => console.log('✅ raginaMemory.js auto-loaded');
        s.onerror = () => console.warn('⚠️ Could not load raginaMemory.js');
        document.body.appendChild(s);
    })();

    setTimeout(injectSettingsButtons, 600);
    setTimeout(() => { injectConsoleCopyButton(); injectSettingsButtons(); }, 900);
    setTimeout(injectConsoleCopyButton, 2000);
    setTimeout(injectConsoleCopyButton, 4000);

    const origSwitchTab = window.switchTab;
    if (typeof origSwitchTab === 'function') {
        window.switchTab = function (tab) {
            const result = origSwitchTab.apply(this, arguments);
            if (tab === 'me') setTimeout(() => {
                injectSettingsButtons();
                injectConsoleCopyButton();
            }, 150);
            return result;
        };
    }

    // ────────────────────────────────────────────────────────────
    // 19. FIRST-RUN REGISTRATION GATE
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
                           style="width:100%; padding:13px 16px; border-radius:14px;
                                  border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);
                                  color:#eef0f5; font-size:16px;
                                  outline:none; font-family:inherit;" />
                </div>

                <div>
                    <label style="font-size:0.72rem; color:#7a89a8;
                                  text-transform:uppercase; letter-spacing:0.06em;
                                  display:block; margin-bottom:6px; font-weight:500;">
                        Username
                    </label>
                    <input id="bootRegUserid" type="text" placeholder="Choose a unique ID"
                           autocomplete="username"
                           style="width:100%; padding:13px 16px; border-radius:14px;
                                  border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);
                                  color:#eef0f5; font-size:16px;
                                  outline:none; font-family:inherit;" />
                    <div id="bootRegUserStatus"
                         style="font-size:0.72rem; color:#7a89a8;
                                margin-top:4px; min-height:1em;"></div>
                </div>

                <div>
                    <label style="font-size:0.72rem; color:#7a89a8;
                                  text-transform:uppercase; letter-spacing:0.06em;
                                  display:block; margin-bottom:6px; font-weight:500;">
                        Phone Number
                    </label>
                    <input id="bootRegPhone" type="tel" placeholder="10-digit number"
                           maxlength="10" inputmode="numeric" autocomplete="tel"
                           style="width:100%; padding:13px 16px; border-radius:14px;
                                  border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);
                                  color:#eef0f5; font-size:16px;
                                  outline:none; font-family:inherit;" />
                </div>

                <div>
                    <label style="font-size:0.72rem; color:#7a89a8;
                                  text-transform:uppercase; letter-spacing:0.06em;
                                  display:block; margin-bottom:6px; font-weight:500;">
                        Email
                    </label>
                    <input id="bootRegEmail" type="email" placeholder="you@example.com"
                           autocomplete="email" inputmode="email"
                           style="width:100%; padding:13px 16px; border-radius:14px;
                                  border:1px solid rgba(255,255,255,0.08);
                                  background:rgba(255,255,255,0.04);
                                  color:#eef0f5; font-size:16px;
                                  outline:none; font-family:inherit;" />
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
                               style="flex:1; min-width:0; padding:13px 16px;
                                      border-radius:14px;
                                      border:1px solid rgba(255,255,255,0.08);
                                      background:rgba(255,255,255,0.04);
                                      color:#eef0f5; font-size:16px;
                                      outline:none; font-family:inherit;
                                      letter-spacing:2px;" />
                        <button id="bootRegSendOtp" type="button"
                                style="padding:13px 18px; border-radius:14px;
                                       border:1px solid rgba(139,92,246,0.25);
                                       background:rgba(139,92,246,0.12);
                                       color:#a78bfa; font-weight:600;
                                       font-size:0.8rem; cursor:pointer;
                                       white-space:nowrap; font-family:inherit;">
                            Send OTP
                        </button>
                    </div>
                    <div id="bootRegOtpStatus"
                         style="font-size:0.72rem; color:#7a89a8;
                                margin-top:6px; min-height:1em;"></div>
                </div>
            </div>

            <button id="bootRegSubmit" type="button"
                    style="width:100%; padding:15px; border-radius:16px; border:none;
                           background:linear-gradient(135deg,#7c3aed,#6d28d9);
                           color:#fff; font-weight:700; font-size:1rem;
                           cursor:pointer; font-family:inherit; margin-top:22px;
                           box-shadow: 0 8px 24px rgba(139,92,246,0.35);">
                Register
            </button>

            <div style="margin-top:16px; text-align:center;
                        font-size:0.7rem; color:#5a6885; line-height:1.5;">
                By registering you agree to Sandesai's terms<br />and privacy policy.
            </div>
        `;
        screen.appendChild(card);
        document.body.appendChild(screen);

        // ── Send OTP ──
        document.getElementById('bootRegSendOtp').addEventListener('click', async function () {
            const phone = document.getElementById('bootRegPhone').value.trim();
            const email = document.getElementById('bootRegEmail').value.trim();
            const status = document.getElementById('bootRegOtpStatus');
            const btn = this;

            if (!phone || !/^\d{10}$/.test(phone)) {
                window.showToast && showToast('Please enter a valid 10-digit number');
                return;
            }
            if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                window.showToast && showToast('Please enter a valid email');
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Sending…';
            if (status) status.textContent = '';

            const result = await sendOtpEmail(phone, email);
            if (result.ok) {
                window.showToast && showToast('📧 Code sent to ' + email);
                if (status) status.textContent = 'Check your inbox (and spam) for the 6-digit code. Expires in 10 min.';

                let cd = 60;
                btn.textContent = 'Resend (' + cd + 's)';
                const tick = setInterval(() => {
                    cd--;
                    if (cd <= 0) {
                        clearInterval(tick);
                        btn.disabled = false;
                        btn.textContent = 'Send OTP';
                    } else {
                        btn.textContent = 'Resend (' + cd + 's)';
                    }
                }, 1000);
            } else {
                window.showToast && showToast('Could not send OTP: ' + (result.error || 'unknown'));
                btn.disabled = false;
                btn.textContent = 'Send OTP';
            }
        });

        // ── Register ──
        const submitBtn = document.getElementById('bootRegSubmit');
        submitBtn.addEventListener('click', async () => {
            const name   = document.getElementById('bootRegName').value.trim();
            const userid = document.getElementById('bootRegUserid').value.trim();
            const phone  = document.getElementById('bootRegPhone').value.trim();
            const email  = document.getElementById('bootRegEmail').value.trim();
            const otp    = document.getElementById('bootRegOtp').value.trim();

            if (!name)   { window.showToast && showToast('Please enter your name'); return; }
            if (!userid) { window.showToast && showToast('Please choose a username'); return; }
            if (!phone || !/^\d{10}$/.test(phone)) {
                window.showToast && showToast('Please enter a valid 10-digit number');
                return;
            }
            if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                window.showToast && showToast('Please enter a valid email');
                return;
            }
            if (!otp) { window.showToast && showToast('Please enter the OTP'); return; }

            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.7';

            // ── Verify OTP ──
            submitBtn.textContent = 'Verifying…';
            const verify = await verifyOtpEmail(phone, otp);
            if (!verify.ok) {
                window.showToast && showToast('⚠️ ' + (verify.message || 'Invalid OTP'));
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.textContent = 'Register';
                return;
            }

            // ── Duplicate check ──
            submitBtn.textContent = 'Checking…';
            const avail = await checkAvailability(userid, phone);
            if (avail && avail.ok === false) {
                window.showToast && showToast('⚠️ ' + (avail.message || 'Not available'));
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.textContent = 'Register';
                return;
            }
            if (avail && avail.usernameAvailable === false) {
                window.showToast && showToast('⚠️ Username is already taken');
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.textContent = 'Register';
                return;
            }

            submitBtn.textContent = 'Registering…';
            await _finishRegistration(name, phone, userid);

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
        if (forceUpdateShown) return;

        if (bootHadInvite) {
            setTimeout(() => {
                if (document.getElementById('inviteWelcomeOverlay')) return;
                if (isRegistered()) return;
                if (forceUpdateShown) return;
                showBootRegistrationScreen();
            }, 1500);
            return;
        }
        showBootRegistrationScreen();
    }

    window.showBootRegistrationScreen = showBootRegistrationScreen;

    // ────────────────────────────────────────────────────────────
    // 20. BOOT
    // ────────────────────────────────────────────────────────────
    async function onBoot() {
        const params = new URLSearchParams(location.search);
        bootHadInvite = params.has('join') || params.has('invite');

        // Force update check first — if it fails, show banner and stop
        const needsUpdate = await checkForceUpdate();
        if (needsUpdate) return;

        setTimeout(() => { handleInviteFromURL(); }, 700);
        setTimeout(() => { bootRegistrationGate(); }, 1300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onBoot);
    } else {
        onBoot();
    }

// ────────────────────────────────────────────────────────────
// 21. 🗑️ DELETE ACCOUNT FLOW
// ────────────────────────────────────────────────────────────
function showDeleteAccountDialog() {
    document.getElementById('deleteAccountDialog')?.remove();

    const phone = localStorage.getItem('premCallNumber') || '';
    const userData = JSON.parse(localStorage.getItem('neonUser') || '{}');
    const userName = userData.name || 'friend';

    const overlay = document.createElement('div');
    overlay.id = 'deleteAccountDialog';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9600;
        background: rgba(8,6,20,0.94);
        backdrop-filter: blur(18px);
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
        font-family: 'Inter', sans-serif;
        color: #eef0f5;
    `;
    overlay.innerHTML = `
        <div style="max-width:400px; width:100%;
                    background: rgba(18,16,36,0.98);
                    border: 1px solid rgba(239,68,68,0.25);
                    border-radius: 24px; padding: 28px 24px 22px;
                    box-shadow: 0 40px 100px rgba(0,0,0,0.8);">

            <div style="text-align:center; margin-bottom:18px;">
                <div style="font-size:2.4rem; margin-bottom:8px;">⚠️</div>
                <div style="font-size:1.2rem; font-weight:700; color:#ef4444;">
                    Delete your account?
                </div>
                <div style="font-size:0.85rem; color:#a5b3d0;
                            margin-top:8px; line-height:1.55;">
                    This will permanently delete:
                </div>
                <div style="font-size:0.8rem; color:#7a89a8;
                            margin-top:10px; line-height:1.7; text-align:left;
                            background:rgba(239,68,68,0.06);
                            border:1px solid rgba(239,68,68,0.15);
                            border-radius:14px; padding:14px 16px;">
                    • Your account &amp; profile<br>
                    • All voice call history<br>
                    • All concierge conversations<br>
                    • All push notification tokens<br>
                    • Local data on this device
                </div>
                <div style="font-size:0.78rem; color:#a5b3d0;
                            margin-top:12px; line-height:1.5;">
                    <b style="color:#ef4444;">This cannot be undone.</b>
                </div>
            </div>

            <div style="margin-bottom:14px;">
                <label style="font-size:0.72rem; color:#7a89a8;
                              text-transform:uppercase; letter-spacing:0.05em;
                              display:block; margin-bottom:6px;">
                    Type your phone number to confirm
                </label>
                <input id="deleteConfirmPhone" type="tel"
                       inputmode="numeric" maxlength="10"
                       placeholder="${phone.slice(0, 2)}${'*'.repeat(Math.max(0, phone.length - 2))}"
                       style="width:100%; padding:13px 16px;
                              border-radius:14px;
                              border:1px solid rgba(239,68,68,0.2);
                              background:rgba(255,255,255,0.04);
                              color:#eef0f5; font-size:16px;
                              outline:none; font-family:inherit;
                              letter-spacing:2px; text-align:center;" />
            </div>

            <button id="deleteAccountConfirm"
                    style="width:100%; padding:14px; border-radius:14px;
                           border:none;
                           background:linear-gradient(135deg,#ef4444,#dc2626);
                           color:#fff; font-weight:700; font-size:0.95rem;
                           cursor:pointer; font-family:inherit;
                           box-shadow:0 8px 24px rgba(239,68,68,0.4);
                           transition:opacity 0.2s;">
                Permanently delete
            </button>

            <button id="deleteAccountCancel"
                    style="width:100%; padding:11px; margin-top:8px;
                           border-radius:14px;
                           border:1px solid rgba(255,255,255,0.06);
                           background:transparent; color:#7a89a8;
                           font-weight:500; font-size:0.85rem;
                           cursor:pointer; font-family:inherit;">
                Cancel
            </button>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = document.getElementById('deleteConfirmPhone');
    const confirmBtn = document.getElementById('deleteAccountConfirm');

    setTimeout(() => input.focus(), 300);

    // Enable confirm only when phone matches
    function checkMatch() {
        const typed = input.value.trim();
        const matches = typed === phone;
        confirmBtn.style.opacity = matches ? '1' : '0.4';
        confirmBtn.style.pointerEvents = matches ? 'auto' : 'none';
    }
    input.addEventListener('input', checkMatch);
    checkMatch();

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim() === phone) {
            confirmBtn.click();
        }
    });

    document.getElementById('deleteAccountCancel').addEventListener('click', () => {
        overlay.remove();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    confirmBtn.addEventListener('click', async () => {
        if (input.value.trim() !== phone) return;
        await performAccountDeletion(phone, userName);
        overlay.remove();
    });
}

async function performAccountDeletion(phone, name) {
    // Show a blocking spinner
    document.getElementById('deleteProgressOverlay')?.remove();
    const progress = document.createElement('div');
    progress.id = 'deleteProgressOverlay';
    progress.style.cssText = `
        position: fixed; inset: 0; z-index: 9700;
        background: rgba(8,6,20,0.96);
        backdrop-filter: blur(20px);
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 20px;
        font-family: 'Inter', sans-serif;
        color: #a5b3d0;
    `;
    progress.innerHTML = `
        <div style="font-size:2rem; animation:spin 1s linear infinite;">⏳</div>
        <div style="font-size:0.95rem;">Deleting your account…</div>
        <div style="font-size:0.75rem; color:#5a6885;">This may take a few seconds</div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(progress);

    let backendOk = false;
    try {
        // no-cors → we can't read the response, but the deletion happens server-side
        await fetch(SHEET_WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                type: 'deleteAccount',
                secret: SHEET_WEBHOOK_SECRET,
                phone: phone,
                uid: (window.auth && window.auth.currentUser && window.auth.currentUser.uid) || '',
            }),
        });
        backendOk = true;
        console.log('🗑️ Backend deletion sent');
    } catch (e) {
        console.warn('Backend deletion failed:', e);
    }

    // Also delete Firestore profile
    try {
        if (window.db && phone) {
            await window.db.collection('profiles').doc(phone).delete();
            console.log('🗑️ Firestore profile deleted');
        }
    } catch (e) {
        console.warn('Firestore delete failed:', e);
    }

    // Sign out Firebase
    try {
        if (window.auth && window.auth.currentUser) {
            await window.auth.signOut();
        }
    } catch (e) {}

    // Wipe localStorage
    try {
        const keysToKeep = [];
        // Nuke everything except nothing — we want a clean slate
        localStorage.clear();
        sessionStorage.clear();
        console.log('🗑️ Local storage cleared');
    } catch (e) {}

    // Wipe IndexedDB (media)
    try {
        if (window.indexedDB && indexedDB.deleteDatabase) {
            indexedDB.deleteDatabase('sandesaiMedia');
            console.log('🗑️ Media IndexedDB deleted');
        }
    } catch (e) {}

    // Show completion message, then reload
    progress.innerHTML = `
        <div style="font-size:2.6rem;">✅</div>
        <div style="font-size:1rem; color:#2fd992; font-weight:600;">
            Account deleted
        </div>
        <div style="font-size:0.8rem; color:#7a89a8; text-align:center; max-width:280px;">
            ${name ? 'Goodbye, ' + escapeHtml(name) + '.' : 'Goodbye.'} Thanks for using Sandesai.
        </div>
        <div style="font-size:0.7rem; color:#5a6885; margin-top:8px;">
            Reloading…
        </div>
    `;

    setTimeout(() => {
        location.reload(true);
    }, 2200);
}

window.showDeleteAccountDialog = showDeleteAccountDialog;

    console.log('✨ enhancements.js loaded — boot gate, invite, welcome, refresh, sync, profiles, sheets, debug, memory, OTP, force-update');
})();