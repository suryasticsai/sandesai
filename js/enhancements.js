// ================================================================
// js/enhancements.js  (v14 – Google redirect ordering fix)
// Adds features on top of script.js without touching it:
//   • First-run registration gate (name + username + phone + SMS OTP)
//   • Firebase Phone Auth (real SMS) — bootstraps Firebase if needed
//   • Google Sign-In (popup on desktop, redirect on mobile)
//   • Email OTP still available on the invite overlay
//   • Duplicate username / phone check
//   • Force update banner (from health endpoint)
//   • Invite links + auto-registration + Google on invite overlay
//   • Welcome popup, refresh connection, call log sync, profile lookup
//   • Debug console copy button + settings toggles
//   • RAGina memory toggles, account deletion
//   • Device session registration + verification
//   • Auto-loads raginaMemory.js
//
// What changed vs v13:
//   • onBoot() now checks getRedirectResult() FIRST — before any
//     call that could trigger signInAnonymously() — so a returning
//     Google redirect user isn't overwritten by an anonymous session.
// ================================================================
(function () {
    'use strict';

    const INVITE_SECRET = 'sandesai-invite-v1-2026';
    const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    // ════════════════════════════════════════════════════════════
    // CONFIG — read from config.js, with fallbacks
    // ════════════════════════════════════════════════════════════
    const CFG = window.SANDESAI || {};
    const SHEET_WEBHOOK_URL = CFG.SHEET_API_URL ||
        'https://script.google.com/macros/s/AKfycbzTLYqybTS1_Ql9SmLupd019ncohZEj8yEVJtabzAyyIZh_kC-E2Xz8sfU2KQ_w6Iib/exec';
    const SHEET_WEBHOOK_SECRET = CFG.SHEET_WEBHOOK_SECRET || 'sandesai-webhook-2026';

    if (!window.SANDESAI) {
        console.warn('⚠️ window.SANDESAI missing — is config.js loaded BEFORE enhancements.js? Using fallback URL.');
    }
    console.log('🔗 Backend URL:', SHEET_WEBHOOK_URL);

    const LOCAL_APP_VERSION = '0.7';

    let bootHadInvite = false;
    let forceUpdateShown = false;

    // ────────────────────────────────────────────────────────────
    // 0. SMALL SHARED HELPERS
    // ────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const toast = (m) => { if (window.showToast) window.showToast(m); };

    // Indian mobile: 10 digits, starts 6–9
    const PHONE_RE    = /^[6-9]\d{9}$/;
    const EMAIL_RE    = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

    const LBL = 'font-size:0.72rem;color:#7a89a8;text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:6px;font-weight:500;';
    const INP = 'width:100%;padding:13px 16px;border-radius:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#eef0f5;font-size:16px;outline:none;font-family:inherit;';
    const BTN_PRIMARY = 'width:100%;padding:15px;border-radius:16px;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-weight:700;font-size:1rem;cursor:pointer;font-family:inherit;box-shadow:0 8px 24px rgba(139,92,246,0.35);';
    const BTN_OTP = 'padding:13px 18px;border-radius:14px;border:1px solid rgba(139,92,246,0.25);background:rgba(139,92,246,0.12);color:#a78bfa;font-weight:600;font-size:0.8rem;cursor:pointer;white-space:nowrap;font-family:inherit;';

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    window.escapeHtml = escapeHtml;

    async function fetchJson(url, timeoutMs) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs || 25000);
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            const text = await r.text();
            try { return JSON.parse(text); }
            catch (e) {
                throw new Error('Backend returned non-JSON (check deployment access = "Anyone")');
            }
        } finally {
            clearTimeout(timer);
        }
    }

    async function postJson(payload, timeoutMs) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs || 25000);
        try {
            const r = await fetch(SHEET_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload),
                redirect: 'follow',
                signal: ctrl.signal
            });
            const text = await r.text();
            try { return JSON.parse(text); }
            catch (e) {
                throw new Error('Backend returned non-JSON (redeploy Code.gs?)');
            }
        } finally {
            clearTimeout(timer);
        }
    }

    // ────────────────────────────────────────────────────────────
    // 0b. FIREBASE AUTH UID — with SDK bootstrap
    // ────────────────────────────────────────────────────────────
    function getAuthUid() {
        try {
            if (window.auth && window.auth.currentUser && window.auth.currentUser.uid) {
                return window.auth.currentUser.uid;
            }
        } catch (e) {}
        try {
            if (window.firebase && typeof window.firebase.auth === 'function') {
                const a = window.firebase.auth();
                if (a && a.currentUser && a.currentUser.uid) {
                    if (!window.auth) {
                        window.auth = a;
                        console.log('🔧 window.auth self-healed from firebase.auth()');
                    }
                    return a.currentUser.uid;
                }
            }
        } catch (e) {}
        return '';
    }

    function waitForAuthUid(maxMs) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                const uid = getAuthUid();
                if (uid) return resolve(uid);
                if (Date.now() - start > maxMs) return resolve('');
                setTimeout(tick, 150);
            };
            tick();
        });
    }

    // Bootstrap Firebase if script.js hasn't done it yet.
    function ensureWindowAuth() {
        if (window.auth) return;
        if (typeof firebase === 'undefined') {
            console.warn('⚠️ Firebase SDK not loaded — check index.html script tags');
            return;
        }
        try {
            if (typeof window.initFirebaseMessaging === 'function') {
                window.initFirebaseMessaging();
            }
        } catch (e) {
            console.warn('initFirebaseMessaging threw:', e);
        }
        try {
            if (window.firebase && typeof window.firebase.auth === 'function') {
                window.auth = window.firebase.auth();
                console.log('🔧 window.auth assigned via ensureWindowAuth()');
            }
        } catch (e) {
            console.warn('ensureWindowAuth failed:', e);
        }
    }

    // ────────────────────────────────────────────────────────────
    // 0c. DEVICE SESSION TOKEN
    // ────────────────────────────────────────────────────────────
    function randomToken(bytes) {
        const n = bytes || 32;
        const arr = new Uint8Array(n);
        const c = window.crypto || window.msCrypto;
        if (c && c.getRandomValues) c.getRandomValues(arr);
        else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
        return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function getDeviceToken() {
        let t = localStorage.getItem('sandesaiDeviceToken');
        if (!t || t.length < 24) {
            t = randomToken(32);
            localStorage.setItem('sandesaiDeviceToken', t);
        }
        return t;
    }

    async function registerSessionWithServer(phone) {
        if (!phone) return;
        try {
            const res = await postJson({
                secret: SHEET_WEBHOOK_SECRET,
                type: 'registerSession',
                phone: phone,
                token: getDeviceToken(),
                device: (navigator.userAgent || 'web').slice(0, 110)
            });
            if (res && res.ok) console.log('🔐 Session registered with backend');
            else console.warn('🔐 Session registration:', res && (res.error || res.message));
        } catch (e) {
            console.warn('🔐 Session registration failed:', e.message || e);
        }
    }

    async function verifySessionWithServer(phone) {
        if (!phone) return { ok: false };
        try {
            return await postJson({
                secret: SHEET_WEBHOOK_SECRET,
                type: 'verifySession',
                phone: phone,
                token: getDeviceToken()
            });
        } catch (e) {
            return { ok: false, error: 'network' };
        }
    }

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
        return d + '.' + signPayload(d);
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
        return location.origin + location.pathname + '?join=' + encodeURIComponent(token);
    }

    window.createInviteToken = createInviteToken;
    window.decodeInviteToken = decodeInviteToken;
    window.buildInviteURL = buildInviteURL;

    // ────────────────────────────────────────────────────────────
    // 2. FORCE UPDATE CHECK
    // ────────────────────────────────────────────────────────────
    function versionLess(a, b) {
        const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
        const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const va = pa[i] || 0, vb = pb[i] || 0;
            if (va < vb) return true;
            if (va > vb) return false;
        }
        return false;
    }

    function showForceUpdateBanner(message) {
        if (forceUpdateShown) return;
        forceUpdateShown = true;
        $('forceUpdateBanner')?.remove();

        const banner = document.createElement('div');
        banner.id = 'forceUpdateBanner';
        banner.style.cssText = `
            position: fixed; inset: 0; z-index: 95000;
            background: rgba(8,6,20,0.96); backdrop-filter: blur(20px);
            display: flex; align-items: center; justify-content: center;
            padding: 24px; font-family: 'Inter', sans-serif; color: #eef0f5;`;
        banner.innerHTML = `
            <div style="max-width:360px;width:100%;text-align:center;
                        background:rgba(18,16,36,0.96);
                        border:1px solid rgba(139,92,246,0.3);
                        border-radius:24px;padding:32px 24px;
                        box-shadow:0 40px 100px rgba(0,0,0,0.8);">
                <div style="font-size:2.4rem;margin-bottom:12px;">🚀</div>
                <div style="font-size:1.2rem;font-weight:700;margin-bottom:10px;">Update required</div>
                <div style="font-size:0.85rem;color:#a5b3d0;line-height:1.5;margin-bottom:22px;">
                    ${escapeHtml(message || 'A new version of Sandesai is available. Please refresh to continue.')}
                </div>
                <button id="forceUpdateBtn" style="${BTN_PRIMARY}padding:14px;">Refresh now</button>
            </div>`;
        document.body.appendChild(banner);
        $('forceUpdateBtn').addEventListener('click', () => location.reload());
    }

    async function checkForceUpdate() {
        try {
            const data = await fetchJson(SHEET_WEBHOOK_URL + '?type=health', 10000);
            if (!data.ok) return false;
            console.log('🩺 Backend', data.version, '| mail quota left:', data.mailQuotaRemaining, '| sessions:', data.counts && data.counts.sessions);
            const minV = data.minAppVersion;
            if (minV && versionLess(LOCAL_APP_VERSION, minV)) {
                console.warn('🚨 Force update required:', LOCAL_APP_VERSION, '<', minV);
                showForceUpdateBanner(data.updateMessage);
                return true;
            }
        } catch (e) {
            console.warn('Force update / health check failed:', e.message || e);
        }
        return false;
    }

    // ────────────────────────────────────────────────────────────
    // 3. BACKEND CALLS
    // ────────────────────────────────────────────────────────────
    async function logRegistrationToSheet(name, username, phone, email, provider) {
        if (!SHEET_WEBHOOK_URL) return { ok: false, error: 'no_url' };

        const uid = await waitForAuthUid(6000);

        let finalUsername = username || '';
        try {
            const stored = JSON.parse(localStorage.getItem('neonUser') || '{}');
            if (stored.userid) finalUsername = stored.userid;
        } catch (e) {}

        try {
            const res = await postJson({
                secret: SHEET_WEBHOOK_SECRET,
                type: 'registration',
                provider: provider || 'otp',
                name: name || '',
                username: finalUsername,
                phone: phone || '',
                email: email || '',
                uid: uid || ''
            });
            console.log('📊 Registration response:', res, '| UID sent:', uid || '(none)');
            return res || { ok: false, error: 'empty_response' };
        } catch (e) {
            console.warn('📊 Registration POST failed:', e.message || e);
            return { ok: false, error: 'network', message: e.message || 'Network error' };
        }
    }
    window.logRegistrationToSheet = logRegistrationToSheet;

    async function checkAvailability(username, phone) {
        try {
            const data = await fetchJson(
                SHEET_WEBHOOK_URL +
                '?type=checkAvailability' +
                '&username=' + encodeURIComponent(username || '') +
                '&phone=' + encodeURIComponent(phone || ''),
                12000
            );
            if (data && data.ok === false) console.warn('Availability check rejected:', data);
            return data;
        } catch (e) {
            console.warn('Availability check failed:', e.message || e);
            return { ok: true, unchecked: true };
        }
    }

    async function sendOtpEmail(phone, email) {
        try {
            const data = await fetchJson(
                SHEET_WEBHOOK_URL +
                '?type=sendOtp' +
                '&secret=' + encodeURIComponent(SHEET_WEBHOOK_SECRET) +
                '&phone=' + encodeURIComponent(phone) +
                '&email=' + encodeURIComponent(email)
            );
            console.log('📧 sendOtp response:', data);
            if (!data.ok) {
                let msg = data.message || data.error || 'unknown error';
                if (data.error === 'forbidden' || data.users) {
                    msg = 'Backend is outdated — redeploy Code.gs as a NEW version.';
                }
                return { ok: false, error: msg };
            }
            return { ok: true, sentTo: data.sentTo };
        } catch (e) {
            console.warn('sendOtp failed:', e);
            return {
                ok: false,
                error: e.name === 'AbortError' ? 'Request timed out' : (e.message || 'Network error')
            };
        }
    }

    async function verifyOtpEmail(phone, code) {
        try {
            return await fetchJson(
                SHEET_WEBHOOK_URL +
                '?type=checkOtp' +
                '&phone=' + encodeURIComponent(phone) +
                '&code=' + encodeURIComponent(code)
            );
        } catch (e) {
            console.warn('verifyOtp failed:', e);
            return { ok: false, error: 'network', message: 'Could not verify. Check your connection.' };
        }
    }

    async function checkUserExists(uid, email) {
        try {
            return await fetchJson(
                SHEET_WEBHOOK_URL +
                '?type=checkUser' +
                '&uid=' + encodeURIComponent(uid || '') +
                '&email=' + encodeURIComponent(email || ''),
                12000
            );
        } catch (e) {
            console.warn('checkUser failed:', e.message || e);
            return { ok: false, unchecked: true };
        }
    }

    // ── Shared "Send OTP" button wiring (email OTP — used by invite overlay) ──
    function otpFieldHtml(prefix) {
        return `
            <div style="display:flex;gap:8px;">
                <input id="${prefix}Otp" type="text" placeholder="Enter OTP"
                       inputmode="numeric" maxlength="6" autocomplete="one-time-code"
                       style="${INP}flex:1;min-width:0;letter-spacing:2px;" />
                <button id="${prefix}SendOtp" type="button" style="${BTN_OTP}">Send OTP</button>
            </div>
            <div id="${prefix}OtpStatus"
                 style="font-size:0.72rem;color:#7a89a8;margin-top:6px;min-height:1em;"></div>`;
    }

    function wireSendOtp(prefix, phoneId, emailId) {
        const btn = $(prefix + 'SendOtp');
        const status = $(prefix + 'OtpStatus');

        const setStatus = (text, color) => {
            if (!status) return;
            status.textContent = text;
            status.style.color = color || '#7a89a8';
        };

        btn.addEventListener('click', async () => {
            const phone = $(phoneId).value.trim();
            const email = $(emailId).value.trim();

            if (!PHONE_RE.test(phone)) return toast('Enter a valid 10-digit Indian mobile (starts 6–9)');
            if (!EMAIL_RE.test(email)) return toast('Please enter a valid email');

            btn.disabled = true;
            btn.textContent = 'Sending…';
            setStatus('');

            const res = await sendOtpEmail(phone, email);

            if (!res.ok) {
                toast('Could not send OTP: ' + res.error);
                setStatus('❌ ' + res.error, '#ef4444');
                btn.disabled = false;
                btn.textContent = 'Send OTP';
                return;
            }

            toast('📧 Code sent to ' + (res.sentTo || email));
            setStatus('✅ Sent to ' + (res.sentTo || email) + '. Check inbox & spam.', '#2fd992');

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
        });
    }

    // ────────────────────────────────────────────────────────────
    // 3b. GOOGLE SIGN-IN
    // ────────────────────────────────────────────────────────────
    function isMobileUA() {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    }

    // 🔧 Bootstrap Firebase if script.js hasn't done it yet
    function getAuthInstance() {
        // Already have it
        if (window.auth && window.auth.currentUser !== undefined) return window.auth;

        // Make sure the SDK is loaded
        if (typeof firebase === 'undefined') {
            console.error('❌ Firebase SDK not loaded — check index.html script tags');
            return null;
        }

        // Trigger script.js's Firebase init (idempotent, safe for unregistered users)
        try {
            if (typeof window.initFirebaseMessaging === 'function') {
                window.initFirebaseMessaging();
            }
        } catch (e) {
            console.warn('initFirebaseMessaging threw:', e);
        }

        // Now grab auth
        try {
            if (window.firebase && typeof window.firebase.auth === 'function') {
                window.auth = window.firebase.auth();
                console.log('🔧 Firebase Auth acquired via getAuthInstance()');
                return window.auth;
            }
        } catch (e) {
            console.error('firebase.auth() threw:', e);
        }
        return null;
    }

    async function signInWithGoogle() {
        const auth = getAuthInstance();
        if (!auth) {
            toast('⚠️ Auth not ready. Refresh and try again.');
            return null;
        }
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        try {
            if (isMobileUA()) {
                await auth.signInWithRedirect(provider);
                return null;
            }
            const result = await auth.signInWithPopup(provider);
            return result.user || null;
        } catch (e) {
            if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
                await auth.signInWithRedirect(provider);
                return null;
            }
            if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) {
                return null;
            }
            console.error('Google sign-in failed:', e);
            toast('⚠️ Google sign-in failed: ' + (e.message || 'unknown'));
            return null;
        }
    }

    async function handleGoogleRedirectResult() {
        const auth = getAuthInstance();
        if (!auth) return null;
        try {
            const result = await auth.getRedirectResult();
            if (result && result.user) return result.user;
        } catch (e) {
            console.warn('getRedirectResult failed:', e);
        }
        return null;
    }

    async function startGoogleRegistrationFlow(googleUser) {
        if (!googleUser) return;

        const uid   = googleUser.uid || '';
        const email = googleUser.email || '';
        const name  = googleUser.displayName || (email.split('@')[0] || '');

        console.log('🔵 Google user:', { uid, email, name });

        const check = await checkUserExists(uid, email);
        if (check && check.exists && check.registeredPhone) {
            console.log('🔵 Returning Google user — restoring session');
            const phone = check.registeredPhone;
            const userData = {
                name, userid: check.registeredUsername || name,
                phone, email, registered: true, status: 'online', provider: 'google'
            };
            localStorage.setItem('neonUser', JSON.stringify(userData));
            localStorage.setItem('premCallNumber', phone);
            localStorage.setItem('premCallVerified', 'true');
            localStorage.setItem('premCallRegisteredAt', String(Date.now()));

            registerSessionWithServer(phone);

            if (window.PremCall) {
                try {
                    if (window.PremCall.reinit) window.PremCall.reinit(phone);
                    else window.PremCall.init(phone);
                } catch (e) {}
            }
            if (typeof window.updateStatusBadge === 'function') window.updateStatusBadge(userData);
            if (typeof window.renderProfileView === 'function') window.renderProfileView();

            $('bootRegScreen')?.remove();
            $('inviteWelcomeOverlay')?.remove();
            $('googlePhoneStep')?.remove();
            toast('👋 Welcome back, ' + name + '!');
            setTimeout(() => {
                if (typeof window.renderChatList === 'function') window.renderChatList();
                if (typeof window.renderCallList === 'function') window.renderCallList();
            }, 400);

            const pending = window._pendingInvitePayload;
            if (pending) {
                window._pendingInvitePayload = null;
                const peer = pending.from || pending.chat;
                if (peer) setTimeout(() => openChatWhenReady(peer), 800);
            }
            return;
        }

        showGooglePhoneStep({ uid, email, name, photo: googleUser.photoURL || '' });
    }

    function showGooglePhoneStep(gUser) {
        $('googlePhoneStep')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'googlePhoneStep';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 100100;
            background: #07050e; overflow-y: auto; padding: 32px 24px;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #eef0f5;
            display: flex; flex-direction: column; align-items: center;`;

        overlay.innerHTML = `
            <div style="max-width:400px;width:100%;margin:auto 0;
                        background:rgba(18,16,36,0.92);
                        border:1px solid rgba(255,255,255,0.07);border-radius:28px;
                        padding:32px 26px 26px;
                        box-shadow:0 40px 100px rgba(0,0,0,0.7);">
                <div style="text-align:center;margin-bottom:22px;">
                    ${gUser.photo
                        ? `<img src="${escapeHtml(gUser.photo)}" alt=""
                                style="width:72px;height:72px;border-radius:50%;border:2px solid rgba(139,92,246,0.4);margin-bottom:10px;object-fit:cover;" />`
                        : `<div style="width:72px;height:72px;border-radius:50%;margin:0 auto 10px;
                                        background:linear-gradient(135deg,#7c3aed,#6ee7ff);
                                        display:flex;align-items:center;justify-content:center;
                                        font-size:1.8rem;font-weight:700;color:#fff;">
                                ${escapeHtml((gUser.name || '?').charAt(0).toUpperCase())}
                           </div>`}
                    <div style="font-size:1.15rem;font-weight:700;">Hi, ${escapeHtml(gUser.name || 'there')}!</div>
                    <div style="font-size:0.8rem;color:#7a89a8;margin-top:4px;">${escapeHtml(gUser.email || '')}</div>
                    <div style="font-size:0.85rem;color:#a5b3d0;margin-top:14px;line-height:1.5;">
                        One last step — add your phone number so friends can find you.
                    </div>
                </div>

                <div style="display:flex;flex-direction:column;gap:14px;">
                    <div>
                        <label style="${LBL}">Username</label>
                        <input id="gPhoneUserid" type="text" placeholder="3–20 letters, numbers, _ or ."
                               autocomplete="username" autocapitalize="none" style="${INP}" />
                        <div id="gPhoneUserStatus" style="font-size:0.72rem;color:#7a89a8;margin-top:4px;min-height:1em;"></div>
                    </div>
                    <div>
                        <label style="${LBL}">Phone Number</label>
                        <input id="gPhonePhone" type="tel" placeholder="10-digit number"
                               maxlength="10" inputmode="numeric" autocomplete="tel-national" style="${INP}" />
                    </div>
                </div>

                <div id="gPhoneError" style="display:none;font-size:0.78rem;color:#ef4444;
                            background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);
                            border-radius:12px;padding:10px 12px;margin-top:14px;"></div>

                <button id="gPhoneSubmit" style="${BTN_PRIMARY}margin-top:20px;">Complete sign-up</button>
                <button id="gPhoneBack"
                        style="width:100%;padding:10px;margin-top:8px;border-radius:14px;
                               border:1px solid rgba(255,255,255,0.06);background:transparent;
                               color:#7a89a8;font-size:0.82rem;cursor:pointer;font-family:inherit;">
                    Use a different account
                </button>
            </div>`;

        document.body.appendChild(overlay);

        const useridInput = $('gPhoneUserid');
        const userStatus = $('gPhoneUserStatus');
        const phoneInput = $('gPhonePhone');
        const submitBtn = $('gPhoneSubmit');
        const errBox = $('gPhoneError');

        const setUserStatus = (t, c) => { userStatus.textContent = t; userStatus.style.color = c || '#7a89a8'; };
        const showErr = (m) => { errBox.style.display = 'block'; errBox.textContent = m; };
        const clearErr = () => { errBox.style.display = 'none'; errBox.textContent = ''; };

        let checkTimer = null;
        useridInput.addEventListener('input', () => {
            const v = useridInput.value.trim();
            clearTimeout(checkTimer);
            if (v.length < 3) return setUserStatus('');
            if (!USERNAME_RE.test(v)) return setUserStatus('Use 3–20 letters, numbers, _ or .', '#f59e0b');
            checkTimer = setTimeout(async () => {
                const p = phoneInput.value.trim();
                const avail = await checkAvailability(v, PHONE_RE.test(p) ? p : '');
                if (avail && avail.usernameAvailable === false) setUserStatus('❌ Username is already taken', '#ef4444');
                else if (avail && avail.usernameAvailable === true) setUserStatus('✅ Username available', '#2fd992');
                else setUserStatus('');
            }, 500);
        });

        $('gPhoneBack').addEventListener('click', async () => {
            try { const a = getAuthInstance(); if (a) await a.signOut(); } catch (e) {}
            overlay.remove();
        });

        submitBtn.addEventListener('click', async () => {
            clearErr();
            const userid = useridInput.value.trim();
            const phone  = phoneInput.value.trim();

            if (!userid)                   return showErr('Pick a username');
            if (!USERNAME_RE.test(userid)) return showErr('Username: 3–20 letters, numbers, _ or .');
            if (!PHONE_RE.test(phone))     return showErr('Enter a valid 10-digit Indian mobile (starts 6–9)');

            submitBtn.disabled = true;
            submitBtn.textContent = 'Checking…';

            const avail = await checkAvailability(userid, phone);
            if (avail && avail.ok === false)                { submitBtn.disabled = false; submitBtn.textContent = 'Complete sign-up'; return showErr(avail.message || 'Availability check failed'); }
            if (avail && avail.usernameAvailable === false) { submitBtn.disabled = false; submitBtn.textContent = 'Complete sign-up'; return showErr('Username is already taken'); }
            if (avail && avail.phoneAvailable === false)    { submitBtn.disabled = false; submitBtn.textContent = 'Complete sign-up'; return showErr('This phone number is already registered.'); }

            submitBtn.textContent = 'Saving…';

            const uid = gUser.uid || getAuthUid();
            let regRes;
            try {
                regRes = await postJson({
                    secret: SHEET_WEBHOOK_SECRET,
                    type: 'registration',
                    provider: 'google',
                    name: gUser.name || '',
                    username: userid,
                    phone: phone,
                    email: gUser.email || '',
                    uid: uid
                });
            } catch (e) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Complete sign-up';
                return showErr('Network error. Please try again.');
            }

            if (regRes && regRes.ok === false) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Complete sign-up';
                return showErr(regRes.message || regRes.error || 'Registration failed');
            }

            const userData = {
                name: gUser.name, userid, phone,
                email: gUser.email, registered: true, status: 'online', provider: 'google'
            };
            localStorage.setItem('neonUser', JSON.stringify(userData));
            localStorage.setItem('premCallNumber', phone);
            localStorage.setItem('premCallVerified', 'true');
            localStorage.setItem('premCallRegisteredAt', String(Date.now()));

            registerSessionWithServer(phone);

            if (window.PremCall) {
                try {
                    if (window.PremCall.reinit) window.PremCall.reinit(phone);
                    else window.PremCall.init(phone);
                } catch (e) {}
            }
            if (!window.firebaseReady && typeof window.initFirebaseMessaging === 'function') {
                window.initFirebaseMessaging();
            }
            setTimeout(() => {
                if (window.db && phone) {
                    window.db.collection('profiles').doc(phone).set({
                        phone, name: gUser.name, username: userid,
                        email: gUser.email, updatedAt: Date.now()
                    }, { merge: true }).catch(() => {});
                }
                if (typeof window.initCallSignaling === 'function') window.initCallSignaling();
                if (typeof window.initCallLogSync === 'function') window.initCallLogSync();
                if (typeof window.renderChatList === 'function') window.renderChatList();
            }, 1200);

            overlay.remove();
            $('bootRegScreen')?.remove();
            $('inviteWelcomeOverlay')?.remove();
            toast('✅ Welcome to Sandesai, ' + (gUser.name || 'friend') + '!');
            showWelcomePopup(gUser.name);

            const pending = window._pendingInvitePayload;
            if (pending) {
                window._pendingInvitePayload = null;
                const peer = pending.from || pending.chat;
                if (peer) setTimeout(() => openChatWhenReady(peer), 800);
            }
        });

        setTimeout(() => useridInput.focus(), 400);
    }

    window.signInWithGoogle = signInWithGoogle;
    window.startGoogleRegistrationFlow = startGoogleRegistrationFlow;

    // ────────────────────────────────────────────────────────────
    // 3c. PHONE AUTH (Firebase Phone Auth — real SMS OTP)
    // ────────────────────────────────────────────────────────────
    let _recaptchaVerifier = null;
    let _phoneConfirmation = null;

    function ensureRecaptcha(buttonId) {
        const auth = getAuthInstance();
        if (!auth) return null;
        if (_recaptchaVerifier) {
            try { _recaptchaVerifier.clear(); } catch (e) {}
            _recaptchaVerifier = null;
        }
        let container = document.getElementById('recaptcha-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'recaptcha-container';
            container.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:99999;';
            document.body.appendChild(container);
        }
        try {
            _recaptchaVerifier = new firebase.auth.RecaptchaVerifier(buttonId || 'recaptcha-container', {
                size: 'invisible',
                callback: () => {}
            });
            return _recaptchaVerifier;
        } catch (e) {
            console.error('RecaptchaVerifier creation failed:', e);
            return null;
        }
    }

    async function sendPhoneOtp(phone, buttonId) {
        const auth = getAuthInstance();
        if (!auth) return { ok: false, error: 'auth_not_ready', message: 'Auth not ready. Refresh and try again.' };

        const verifier = ensureRecaptcha(buttonId);
        if (!verifier) return { ok: false, error: 'recaptcha_failed', message: 'Could not start verification.' };

        const e164 = phone.startsWith('+') ? phone : '+91' + phone;

        try {
            _phoneConfirmation = await auth.signInWithPhoneNumber(e164, verifier);
            console.log('📱 Phone OTP sent to', e164);
            return { ok: true, sentTo: e164 };
        } catch (e) {
            console.error('sendPhoneOtp failed:', e);
            let msg = e.message || 'Could not send SMS.';
            if (e.code === 'auth/invalid-phone-number') msg = 'Invalid phone number format.';
            if (e.code === 'auth/too-many-requests')    msg = 'Too many attempts. Try again in a while.';
            if (e.code === 'auth/quota-exceeded')       msg = 'SMS quota exceeded for today.';
            if (e.code === 'auth/captcha-check-failed') msg = 'ReCAPTCHA check failed. Refresh and retry.';
            if (e.code === 'auth/operation-not-allowed') msg = 'SMS region not enabled. Enable India in Firebase Console → Authentication → Settings → SMS region policy.';
            return { ok: false, error: e.code || 'phone_auth_failed', message: msg };
        }
    }

    async function verifyPhoneOtp(code) {
        if (!_phoneConfirmation) {
            return { ok: false, error: 'no_pending', message: 'Request a new code first.' };
        }
        try {
            const result = await _phoneConfirmation.confirm(code);
            const user = result.user;
            console.log('📱 Phone verified. UID:', user.uid, '| phone:', user.phoneNumber);
            _phoneConfirmation = null;
            return { ok: true, user: user, phone: user.phoneNumber };
        } catch (e) {
            console.error('verifyPhoneOtp failed:', e);
            let msg = e.message || 'Invalid code.';
            if (e.code === 'auth/invalid-verification-code') msg = 'Wrong code. Please try again.';
            if (e.code === 'auth/code-expired')              msg = 'Code expired. Request a new one.';
            return { ok: false, error: e.code || 'invalid_code', message: msg };
        }
    }

    function cleanupPhoneAuth() {
        try { if (_recaptchaVerifier) _recaptchaVerifier.clear(); } catch (e) {}
        _recaptchaVerifier = null;
        _phoneConfirmation = null;
    }

    window.sendPhoneOtp = sendPhoneOtp;
    window.verifyPhoneOtp = verifyPhoneOtp;

    // ────────────────────────────────────────────────────────────
    // 4. SHARE INVITE
    // ────────────────────────────────────────────────────────────
    async function shareInviteForPeer(peer) {
        if (!peer) { toast('No contact selected'); return; }

        const userData = JSON.parse(localStorage.getItem('neonUser') || '{}');
        const me = localStorage.getItem('premCallNumber') || '';
        const senderName = userData.name || 'Someone';

        const url = buildInviteURL(createInviteToken({ from: me, to: peer, chat: peer, name: senderName }));
        const text = `👋 ${senderName} invited you to Sandesai.\n\nTap to open the chat:\n${url}`;

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
                toast('📋 Invite copied — paste it anywhere');
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

        const url = buildInviteURL(createInviteToken({ from: me, to: '', chat: me, name: senderName }));
        const text = `👋 Join me on Sandesai — a messenger with AI superpowers!\n\n${url}`;

        if (navigator.share) {
            try {
                await navigator.share({ title: 'Join Sandesai', text });
                return;
            } catch (e) { if (e.name === 'AbortError') return; }
        }
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            toast('📋 Invite copied to clipboard');
        }
    }

    window.shareInviteForPeer = shareInviteForPeer;
    window.shareInviteOpen = shareInviteOpen;

    // ────────────────────────────────────────────────────────────
    // 5. SHARED REGISTRATION CORE
    // ────────────────────────────────────────────────────────────
    async function _finishRegistration(name, phone, preferredUserid, email, provider) {
        const userid = preferredUserid ||
            ((name.toLowerCase().replace(/\s+/g, '') || 'user') +
             '_' + Math.floor(1000 + Math.random() * 9000));

        const regRes = await logRegistrationToSheet(name, userid, phone, email || '', provider || 'otp');

        if (regRes && regRes.ok === false) {
            return {
                ok: false,
                error: regRes.error || 'registration_failed',
                message: regRes.message || 'Registration failed on the server.'
            };
        }
        if (regRes && regRes.error === 'network') {
            console.warn('⚠️ Server unreachable — continuing offline. Will retry on next boot.');
        }

        const userData = { name, userid, phone, email: email || '', registered: true, status: 'online' };
        localStorage.setItem('neonUser', JSON.stringify(userData));
        localStorage.setItem('premCallNumber', phone);
        localStorage.setItem('premCallVerified', 'true');
        localStorage.setItem('premCallRegisteredAt', String(Date.now()));

        registerSessionWithServer(phone);

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
                    phone, name, username: userid, email: email || '', updatedAt: Date.now()
                }, { merge: true }).catch(() => {});
            }
            if (typeof window.initCallSignaling === 'function') window.initCallSignaling();
            if (typeof window.initCallLogSync === 'function') window.initCallLogSync();
        }, 1200);

        const mn = $('myNumberDisplay');
        if (mn) mn.textContent = phone;
        const dot = $('headerStatusDot');
        if (dot) dot.className = 'status-dot connecting';
        if (typeof window.updateStatusBadge === 'function') window.updateStatusBadge(userData);
        if (typeof window.renderProfileView === 'function') window.renderProfileView();
        const link = document.querySelector('.registration-link');
        if (link) link.style.display = 'none';

        return { ok: true, userid: userid };
    }

    // ────────────────────────────────────────────────────────────
    // 6. INVITE WELCOME OVERLAY (with Google + email OTP)
    // ────────────────────────────────────────────────────────────
    function showInviteWelcomeOverlay(payload) {
        $('inviteWelcomeOverlay')?.remove();

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
            background: rgba(8,6,20,0.94); backdrop-filter: blur(20px);
            display: flex; align-items: center; justify-content: center;
            padding: 24px; font-family: 'Inter', sans-serif; color: #eef0f5;
            overflow-y: auto;`;
        overlay.innerHTML = `
            <div style="max-width:380px;width:100%;background:rgba(18,16,36,0.96);
                        border:1px solid rgba(255,255,255,0.06);border-radius:28px;
                        padding:32px 24px;text-align:center;
                        box-shadow:0 40px 80px rgba(0,0,0,0.7);margin:auto;">
                <img src="sandesai-logo.png" alt="Sandesai"
                     style="width:64px;height:64px;border-radius:50%;margin-bottom:12px;" />
                <div style="font-size:1.3rem;font-weight:700;margin-bottom:4px;">You're invited to Sandesai</div>
                <div style="font-size:0.85rem;color:#7a89a8;margin-bottom:20px;">${subtitle}</div>

                <button id="inviteGoogleBtn" type="button" style="width:100%;padding:13px 16px;border-radius:14px;border:1px solid rgba(255,255,255,0.1);background:#fff;color:#1f1f1f;font-weight:600;font-size:0.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:inherit;margin-bottom:16px;">
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/>
                        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 5.1 29.3 3 24 3 16 3 9.1 7.6 6.3 14.7z"/>
                        <path fill="#4CAF50" d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 36.1 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-6.9l-6.6 5.1C9 41.4 16 45 24 45z"/>
                        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C41.6 35.4 45 30.2 45 24c0-1.2-.1-2.4-.4-3.5z"/>
                    </svg>
                    Continue with Google
                </button>

                <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                    <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
                    <div style="font-size:0.7rem;color:#5a6885;letter-spacing:0.08em;text-transform:uppercase;">or use email</div>
                    <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
                </div>

                <div style="display:flex;flex-direction:column;gap:14px;text-align:left;">
                    <div>
                        <label style="${LBL}">Your number</label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="padding:13px 14px;border-radius:14px;background:rgba(255,255,255,0.04);
                                         border:1px solid rgba(255,255,255,0.08);color:#a5b3d0;
                                         font-size:1rem;font-weight:600;white-space:nowrap;">+91</span>
                            <input id="invitePhone" type="tel" inputmode="numeric" maxlength="10"
                                   placeholder="10-digit number" value="${escapeHtml(payload.to || '')}"
                                   autocomplete="tel-national"
                                   style="${INP}flex:1;min-width:0;letter-spacing:1px;" />
                        </div>
                    </div>
                    <div>
                        <label style="${LBL}">Email</label>
                        <input id="inviteEmail" type="email" placeholder="you@example.com"
                               autocomplete="email" inputmode="email" style="${INP}" />
                    </div>
                    <div>
                        <label style="${LBL}">OTP</label>
                        ${otpFieldHtml('invite')}
                    </div>
                    <div>
                        <label style="${LBL}">Your name</label>
                        <input id="inviteName" type="text" placeholder="e.g. Ananya"
                               autocomplete="name" style="${INP}" />
                    </div>
                </div>

                <button id="inviteJoinBtn" style="${BTN_PRIMARY}margin-top:20px;">🚀 Join &amp; open chat</button>
                <div style="margin-top:12px;font-size:0.7rem;color:#5a6885;">
                    By joining you agree to the Sandesai terms.
                </div>
            </div>`;
        document.body.appendChild(overlay);

        wireSendOtp('invite', 'invitePhone', 'inviteEmail');

        // Google button on invite overlay
        $('inviteGoogleBtn').addEventListener('click', async () => {
            const btn = $('inviteGoogleBtn');
            btn.disabled = true;
            btn.innerHTML = '<span style="color:#666;">Opening Google…</span>';

            const user = await signInWithGoogle();
            if (!user) {
                btn.disabled = false;
                btn.innerHTML = 'Continue with Google';
                return;
            }

            window._pendingInvitePayload = payload;
            await startGoogleRegistrationFlow(user);
        });

        // Email OTP join button
        $('inviteJoinBtn').addEventListener('click', async () => {
            const name  = $('inviteName').value.trim();
            const phone = $('invitePhone').value.trim();
            const email = $('inviteEmail').value.trim();
            const otp   = $('inviteOtp').value.trim();

            if (!PHONE_RE.test(phone)) return toast('Enter a valid 10-digit Indian mobile (starts 6–9)');
            if (!EMAIL_RE.test(email)) return toast('Please enter a valid email');
            if (!otp)                  return toast('Please enter the OTP');
            if (!name)                 return toast('Please enter your name');

            const joinBtn = $('inviteJoinBtn');
            const reset = () => { joinBtn.disabled = false; joinBtn.textContent = '🚀 Join & open chat'; };
            joinBtn.disabled = true;
            joinBtn.textContent = 'Verifying…';

            const verify = await verifyOtpEmail(phone, otp);
            if (!verify.ok) {
                toast('⚠️ ' + (verify.message || 'Invalid OTP'));
                return reset();
            }

            const isIntendedRecipient = !isTargeted || phone === payload.to;
            if (isIntendedRecipient) autoRegisterFromInvite(payload, name, phone, email, payload.from || payload.chat);
            else autoRegisterAsNewUser(name, phone, email);
        });

        setTimeout(() => $('invitePhone')?.focus(), 400);
    }

    // ────────────────────────────────────────────────────────────
    // 7. AUTO-REGISTER PATHS
    // ────────────────────────────────────────────────────────────
    async function autoRegisterFromInvite(payload, name, phone, email, openChatWith) {
        if (!phone) { toast('Missing phone number'); return; }
        const res = await _finishRegistration(name, phone, null, email, 'otp');
        if (!res.ok) return toast('⚠️ ' + res.message);
        $('inviteWelcomeOverlay')?.remove();
        showWelcomePopup(name);
        if (openChatWith) openChatWhenReady(openChatWith);
    }

    async function autoRegisterAsNewUser(name, phone, email) {
        if (!phone) return;
        const res = await _finishRegistration(name, phone, null, email, 'otp');
        if (!res.ok) return toast('⚠️ ' + res.message);
        $('inviteWelcomeOverlay')?.remove();
        showWrongInvitePopup(name);
        setTimeout(() => {
            if (typeof window.switchTab === 'function') window.switchTab('chat');
            if (typeof window.renderChatList === 'function') window.renderChatList();
        }, 400);
    }

    // ────────────────────────────────────────────────────────────
    // 8. OPEN CHAT WHEN READY
    // ────────────────────────────────────────────────────────────
    function openChatWhenReady(peer, maxWaitMs = 10000) {
        const start = Date.now();
        (function attempt() {
            const ready = window.firebaseReady && window.myNumber;
            if (ready || Date.now() - start > maxWaitMs) {
                if (typeof window.switchTab === 'function') window.switchTab('chat');
                if (typeof window.openChat === 'function') window.openChat(peer);
                console.log('💬 Opened chat with', peer, '(ready:', ready, ')');
                return;
            }
            setTimeout(attempt, 250);
        })();
    }
    window.openChatWhenReady = openChatWhenReady;

    // ────────────────────────────────────────────────────────────
    // 9. WELCOME / WRONG-INVITE POPUP
    // ────────────────────────────────────────────────────────────
    function showJoinWelcomePopup(name, variant) {
        $('welcomePopup')?.remove();

        if (!$('welcomePopupStyles')) {
            const s = document.createElement('style');
            s.id = 'welcomePopupStyles';
            s.textContent = `
                @keyframes wpopHeartBeat {0%,100%{transform:scale(1)}20%{transform:scale(1.25)}35%{transform:scale(1.08)}50%{transform:scale(1.28)}70%{transform:scale(1)}}
                @keyframes wpopGlowPulse {0%,100%{opacity:.45;transform:scale(.9)}50%{opacity:.95;transform:scale(1.15)}}
                @keyframes wpopArrowBounce {0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
                @keyframes wpopSparkle {0%{transform:translateY(0) scale(.5);opacity:0}25%{opacity:1}100%{transform:translateY(-38px) scale(1);opacity:0}}
                @keyframes wpopShimmer {0%{background-position:-200% center}100%{background-position:200% center}}
                .wpop-shimmer{
                    background:linear-gradient(90deg,#a78bfa 0%,#ffffff 50%,#a78bfa 100%);
                    background-size:200% auto;
                    -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
                    animation:wpopShimmer 3s linear infinite;
                }`;
            document.head.appendChild(s);
        }

        const isWelcome = variant === 'welcome';
        const safeName = escapeHtml(name || 'friend');
        const heading = isWelcome ? `Welcome, ${safeName}!` : `Welcome aboard, ${safeName}!`;

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
            backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
            display: flex; align-items: center; justify-content: center;
            padding: 24px; font-family: 'Inter', sans-serif; color: #eef0f5;
            opacity: 0; transition: opacity 0.35s ease;`;

        popup.innerHTML = `
            <div style="max-width:340px;width:100%;background:rgba(18,16,36,0.96);
                        border:1px solid rgba(255,255,255,0.07);border-radius:24px;
                        padding:28px 24px 24px;text-align:center;
                        box-shadow:0 40px 100px rgba(0,0,0,0.75);
                        position:relative;overflow:hidden;">
                ${isWelcome ? `
                    <div style="position:relative;height:30px;margin-bottom:2px;">
                        <div style="position:absolute;top:0;right:4px;font-size:22px;line-height:1;
                                    animation:wpopArrowBounce 1.4s ease-in-out infinite;">☝️</div>
                    </div>` : ''}

                <div style="position:relative;width:132px;height:132px;margin:6px auto 10px;">
                    <div style="position:absolute;inset:0;border-radius:50%;
                                background:radial-gradient(circle,${logoGlow} 0%,transparent 72%);
                                animation:wpopGlowPulse 1.8s ease-in-out infinite;filter:blur(10px);"></div>
                    <span style="position:absolute;left:-6px;top:24%;font-size:13px;color:#c4b5fd;
                                 animation:wpopSparkle 2.6s ease-in-out infinite;">✦</span>
                    <span style="position:absolute;right:-4px;bottom:30%;font-size:11px;color:#6ee7ff;
                                 animation:wpopSparkle 2.6s ease-in-out infinite;animation-delay:.8s;">✦</span>
                    <span style="position:absolute;left:18%;bottom:-2px;font-size:12px;color:#a78bfa;
                                 animation:wpopSparkle 2.6s ease-in-out infinite;animation-delay:1.6s;">✦</span>

                    <img src="sandesai-logo.png" alt="Sandesai"
                         style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
                                width:100px;height:100px;border-radius:50%;
                                border:2px solid rgba(139,92,246,0.35);
                                box-shadow:0 0 40px ${logoGlow},0 10px 30px rgba(0,0,0,0.55);
                                object-fit:cover;" />

                    <div style="position:absolute;right:6px;bottom:6px;width:38px;height:38px;
                                border-radius:50%;background:linear-gradient(135deg,#ec4899,#7c3aed);
                                display:flex;align-items:center;justify-content:center;
                                font-size:19px;line-height:1;border:2px solid rgba(18,16,36,0.95);
                                box-shadow:0 4px 18px ${heartGlow};
                                animation:wpopHeartBeat 1.5s ease-in-out infinite;">
                        ${isWelcome ? '💜' : '🤍'}
                    </div>
                </div>

                <div class="wpop-shimmer" style="font-size:1.35rem;font-weight:700;margin-bottom:10px;">${heading}</div>
                <div style="font-size:0.85rem;color:#a5b3d0;line-height:1.55;margin-bottom:22px;">${bodyText}</div>

                <button id="welcomeGotItBtn"
                        style="width:100%;padding:13px;border-radius:14px;border:none;
                               background:linear-gradient(135deg,#7c3aed,#6d28d9);
                               color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;
                               font-family:inherit;box-shadow:0 8px 24px rgba(139,92,246,0.4);">
                    Got it →
                </button>
            </div>`;

        document.body.appendChild(popup);
        requestAnimationFrame(() => { popup.style.opacity = '1'; });

        const dismiss = () => {
            popup.style.opacity = '0';
            setTimeout(() => popup.remove(), 350);
        };
        $('welcomeGotItBtn').addEventListener('click', dismiss);
        setTimeout(() => { if (popup.parentNode) dismiss(); }, isWelcome ? 7500 : 9000);
    }

    function showWelcomePopup(name) { showJoinWelcomePopup(name, 'welcome'); }
    function showWrongInvitePopup(name) { showJoinWelcomePopup(name, 'wrong-invite'); }
    window.showJoinWelcomePopup = showJoinWelcomePopup;
    window.showWelcomePopup = showWelcomePopup;
    window.showWrongInvitePopup = showWrongInvitePopup;

    // ────────────────────────────────────────────────────────────
    // 10. INVITE URL HANDLER
    // ────────────────────────────────────────────────────────────
    async function handleInviteFromURL() {
        const params = new URLSearchParams(location.search);
        const token = params.get('join');
        if (!token) return;

        const payload = decodeInviteToken(token);
        if (!payload) {
            toast('⚠️ Invite link expired or invalid');
            history.replaceState({}, '', location.pathname);
            return;
        }

        console.log('🎟️ Valid invite token:', payload);

        if (localStorage.getItem('premCallRegisteredAt')) {
            const myNum = localStorage.getItem('premCallNumber');
            if (myNum && payload.chat) {
                toast(`Opening chat with ${payload.name || payload.from}…`);
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
    // 11. REFRESH CONNECTION
    // ────────────────────────────────────────────────────────────
    if (typeof window.refreshConnection !== 'function') {
        window.refreshConnection = async function () {
            const btn = $('refreshConnectionBtn');
            if (btn) btn.classList.add('spinning');
            toast('🔄 Reconnecting…');
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

                if (storedNum) registerSessionWithServer(storedNum);

                setTimeout(() => {
                    toast('✅ Connection refreshed');
                    if (btn) btn.classList.remove('spinning');
                }, 900);
            } catch (e) {
                console.error('Refresh failed:', e);
                toast('Refresh failed: ' + e.message);
                if (btn) btn.classList.remove('spinning');
            }
        };
    }

    // ────────────────────────────────────────────────────────────
    // 12. CALL LOG SYNC
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
    // 13. PROFILE LOOKUP
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
    // 14. INJECT INVITE BUTTON INTO CONTACT PROFILE
    // ────────────────────────────────────────────────────────────
    function injectInviteButton() {
        const profileOverlay = $('contactProfileOverlay');
        if (!profileOverlay || profileOverlay.style.display === 'none') return;
        if ($('contactProfileInvite')) return;
        const msgBtn = $('contactProfileMessage');
        if (!msgBtn || !msgBtn.parentNode) return;

        const inviteBtn = document.createElement('button');
        inviteBtn.id = 'contactProfileInvite';
        inviteBtn.style.cssText = 'padding:0.6rem 1.5rem;border-radius:30px;border:1px solid rgba(110,231,255,0.2);background:rgba(110,231,255,0.08);color:#6ee7ff;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:0.5rem;';
        inviteBtn.innerHTML = '<i class="fas fa-share-nodes"></i> Invite';
        inviteBtn.addEventListener('click', () => {
            let peer = window.currentProfilePeer;
            if (!peer) {
                const phoneEl = $('contactProfilePhone');
                const m = phoneEl && phoneEl.textContent.match(/(\d{10})/);
                if (m) peer = m[1];
            }
            if (peer) shareInviteForPeer(peer);
        });
        msgBtn.parentNode.appendChild(inviteBtn);
    }

    new MutationObserver(() => {
        const overlay = $('contactProfileOverlay');
        if (overlay && overlay.style.display === 'flex') injectInviteButton();
    }).observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });
    setTimeout(injectInviteButton, 500);

    // ────────────────────────────────────────────────────────────
    // 15. INJECT SETTINGS ROWS
    // ────────────────────────────────────────────────────────────
    function addSettingRow(section, before, html, id) {
        if ($(id)) return null;
        const row = document.createElement('div');
        row.className = 'setting-item';
        row.innerHTML = html;
        section.insertBefore(row, before);
        return row;
    }

    function toggleHtml(icon, label, id, checked) {
        return `
            <span><i class="fas ${icon}"></i> ${label}</span>
            <label class="toggle-switch">
                <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} />
                <span class="toggle-slider"></span>
            </label>`;
    }

    function injectSettingsButtons() {
        const section = document.querySelector('.settings-section');
        if (!section) return;
        const logoutBtn = section.querySelector('.logout-btn');
        if (!logoutBtn) return;

        addSettingRow(section, logoutBtn, `
            <span><i class="fas fa-user-group"></i> Invite friends</span>
            <button class="reg-btn" id="inviteFriendsBtn" title="Share Sandesai">
                <i class="fas fa-share-nodes"></i>
            </button>`, 'inviteFriendsBtn')
            ?.querySelector('#inviteFriendsBtn').addEventListener('click', shareInviteOpen);

        addSettingRow(section, logoutBtn, `
            <span><i class="fas fa-sync-alt"></i> Refresh connection</span>
            <button class="reg-btn" id="refreshConnectionBtn" title="Reconnect to network">
                <i class="fas fa-rotate-right"></i>
            </button>`, 'refreshConnectionBtn')
            ?.querySelector('#refreshConnectionBtn').addEventListener('click', window.refreshConnection);

        const getConsent = () => (window.RaginaMemory && window.RaginaMemory.getConsent()) || {};
        const setConsent = (patch) => {
            const c = Object.assign({}, getConsent(), patch, { at: Date.now() });
            if (window.RaginaMemory) window.RaginaMemory.setConsent(c);
        };

        addSettingRow(section, logoutBtn,
            toggleHtml('fa-brain', 'RAGina memory', 'raginaMemoryToggle', getConsent().memory),
            'raginaMemoryToggle')
            ?.querySelector('#raginaMemoryToggle').addEventListener('change', function () {
                setConsent({ memory: this.checked });
                toast(this.checked ? '🧠 RAGina will remember' : '🧠 Memory off');
            });

        addSettingRow(section, logoutBtn,
            toggleHtml('fa-comments', 'Use chats as context', 'raginaChatContextToggle', getConsent().chats),
            'raginaChatContextToggle')
            ?.querySelector('#raginaChatContextToggle').addEventListener('change', function () {
                setConsent({ chats: this.checked });
                toast(this.checked ? '💬 Chat context enabled' : '💬 Chat context off');
            });

        const saved = localStorage.getItem('debugConsoleVisible');
        const visible = saved === null ? true : saved === 'true';
        const debugRow = addSettingRow(section, logoutBtn,
            toggleHtml('fa-terminal', 'Debug console', 'debugConsoleToggle', visible),
            'debugConsoleToggle');
        if (debugRow) {
            const debugFab = $('debugToggle');
            if (debugFab) debugFab.style.display = visible ? '' : 'none';
            debugRow.querySelector('#debugConsoleToggle').addEventListener('change', function () {
                const v = this.checked;
                if (debugFab) debugFab.style.display = v ? '' : 'none';
                localStorage.setItem('debugConsoleVisible', String(v));
                if (!v) {
                    const c = $('debugConsole');
                    if (c) c.style.transform = 'translateY(100%)';
                    if (debugFab) debugFab.innerHTML = '<i class="fas fa-terminal"></i>';
                }
                toast(v ? '🐞 Debug button shown' : '🐞 Debug button hidden');
            });
        }

        addSettingRow(section, logoutBtn, `
            <span style="color:#ef4444;"><i class="fas fa-trash-alt" style="color:#ef4444;"></i> Delete account</span>
            <button class="reg-btn" id="deleteAccountBtn" title="Delete my account"
                    style="border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.12);color:#ef4444;">
                <i class="fas fa-trash-alt"></i>
            </button>`, 'deleteAccountBtn')
            ?.querySelector('#deleteAccountBtn').addEventListener('click', showDeleteAccountDialog);
    }

    // ────────────────────────────────────────────────────────────
    // 16. COPY BUTTON IN DEBUG CONSOLE
    // ────────────────────────────────────────────────────────────
    function injectConsoleCopyButton() {
        const clearBtn = $('consoleClear');
        if (!clearBtn) return;
        const actions = clearBtn.parentNode;
        if (!actions || $('consoleCopy')) return;

        const copyBtn = document.createElement('button');
        copyBtn.id = 'consoleCopy';
        copyBtn.textContent = '📋 Copy';
        copyBtn.style.cssText = 'background:rgba(255,255,255,0.04);border:none;color:#a5b3d0;padding:2px 10px;border-radius:8px;font-size:10px;cursor:pointer;font-family:inherit;';
        copyBtn.addEventListener('click', async () => {
            const body = $('consoleBody');
            if (!body) return;
            const text = (body.innerText || body.textContent || '').trim();
            if (!text) return toast('Console is empty');
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
                toast('📋 Console copied');
            } catch (e) {
                toast('Copy failed: ' + e.message);
            }
        });
        actions.insertBefore(copyBtn, clearBtn);
    }

    // ────────────────────────────────────────────────────────────
    // 17. AUTO-LOAD raginaMemory.js
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
            if (tab === 'me') setTimeout(() => { injectSettingsButtons(); injectConsoleCopyButton(); }, 150);
            return result;
        };
    }

    // ────────────────────────────────────────────────────────────
    // 18. DELETE ACCOUNT FLOW
    // ────────────────────────────────────────────────────────────
    function showDeleteAccountDialog() {
        $('deleteAccountDialog')?.remove();

        const phone = localStorage.getItem('premCallNumber') || '';
        const userData = JSON.parse(localStorage.getItem('neonUser') || '{}');
        const userName = userData.name || 'friend';

        const overlay = document.createElement('div');
        overlay.id = 'deleteAccountDialog';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 9600;
            background: rgba(8,6,20,0.94);
            backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
            display: flex; align-items: center; justify-content: center;
            padding: 24px; font-family: 'Inter', sans-serif; color: #eef0f5;`;
        overlay.innerHTML = `
            <div style="max-width:400px;width:100%;background:rgba(18,16,36,0.98);
                        border:1px solid rgba(239,68,68,0.25);border-radius:24px;
                        padding:28px 24px 22px;box-shadow:0 40px 100px rgba(0,0,0,0.8);">
                <div style="text-align:center;margin-bottom:18px;">
                    <div style="font-size:2.4rem;margin-bottom:8px;">⚠️</div>
                    <div style="font-size:1.2rem;font-weight:700;color:#ef4444;">Delete your account?</div>
                    <div style="font-size:0.85rem;color:#a5b3d0;margin-top:8px;line-height:1.55;">
                        This will permanently delete:
                    </div>
                    <div style="font-size:0.8rem;color:#7a89a8;margin-top:10px;line-height:1.7;text-align:left;
                                background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);
                                border-radius:14px;padding:14px 16px;">
                        • Your account &amp; profile<br>
                        • All voice call history<br>
                        • All concierge conversations<br>
                        • All push notification tokens<br>
                        • All device sessions<br>
                        • Local data on this device
                    </div>
                    <div style="font-size:0.78rem;color:#a5b3d0;margin-top:12px;line-height:1.5;">
                        <b style="color:#ef4444;">This cannot be undone.</b>
                    </div>
                </div>

                <div style="margin-bottom:14px;">
                    <label style="${LBL}">Type your phone number to confirm</label>
                    <input id="deleteConfirmPhone" type="tel" inputmode="numeric" maxlength="10"
                           placeholder="${escapeHtml(phone.slice(0, 2) + '*'.repeat(Math.max(0, phone.length - 2)))}"
                           style="${INP}border-color:rgba(239,68,68,0.2);letter-spacing:2px;text-align:center;" />
                </div>

                <div id="deleteError" style="display:none;font-size:0.78rem;color:#ef4444;
                            background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);
                            border-radius:12px;padding:10px 12px;margin-bottom:12px;"></div>

                <button id="deleteAccountConfirm"
                        style="width:100%;padding:14px;border-radius:14px;border:none;
                               background:linear-gradient(135deg,#ef4444,#dc2626);
                               color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;
                               font-family:inherit;box-shadow:0 8px 24px rgba(239,68,68,0.4);
                               opacity:0.4;pointer-events:none;transition:opacity 0.2s;">
                    Permanently delete
                </button>
                <button id="deleteAccountCancel"
                        style="width:100%;padding:11px;margin-top:8px;border-radius:14px;
                               border:1px solid rgba(255,255,255,0.06);background:transparent;
                               color:#7a89a8;font-weight:500;font-size:0.85rem;cursor:pointer;font-family:inherit;">
                    Cancel
                </button>
            </div>`;
        document.body.appendChild(overlay);

        const input = $('deleteConfirmPhone');
        const confirmBtn = $('deleteAccountConfirm');
        setTimeout(() => input.focus(), 300);

        const checkMatch = () => {
            const ok = input.value.trim() === phone && !!phone;
            confirmBtn.style.opacity = ok ? '1' : '0.4';
            confirmBtn.style.pointerEvents = ok ? 'auto' : 'none';
        };
        input.addEventListener('input', checkMatch);
        checkMatch();

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim() === phone) confirmBtn.click();
        });
        $('deleteAccountCancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        confirmBtn.addEventListener('click', async () => {
            if (input.value.trim() !== phone) return;

            const errEl = $('deleteError');
            const showErr = (m) => {
                errEl.style.display = 'block';
                errEl.textContent = m;
            };
            errEl.style.display = 'none';

            const uid = getAuthUid();
            if (!uid) {
                showErr('We could not verify this device. Please refresh the page and sign in again.');
                return;
            }

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Deleting…';

            const res = await performAccountDeletion(phone, userName, uid);

            if (!res.ok) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Permanently delete';
                showErr(res.message || 'Server could not delete the account. Please try again.');
                return;
            }

            overlay.remove();
        });
    }

    async function performAccountDeletion(phone, name, uid) {
        $('deleteProgressOverlay')?.remove();
        const progress = document.createElement('div');
        progress.id = 'deleteProgressOverlay';
        progress.style.cssText = `
            position: fixed; inset: 0; z-index: 9700;
            background: rgba(8,6,20,0.96);
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            display: flex; align-items: center; justify-content: center;
            flex-direction: column; gap: 20px;
            font-family: 'Inter', sans-serif; color: #a5b3d0;`;
        progress.innerHTML = `
            <div style="font-size:2rem;animation:spin 1s linear infinite;">⏳</div>
            <div style="font-size:0.95rem;">Deleting your account…</div>
            <div style="font-size:0.75rem;color:#5a6885;">This may take a few seconds</div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>`;
        document.body.appendChild(progress);

        let serverRes = null;
        try {
            serverRes = await postJson({
                type: 'deleteAccount',
                secret: SHEET_WEBHOOK_SECRET,
                phone: phone,
                uid: uid || ''
            });
            console.log('🗑️ Backend deletion response:', serverRes);
        } catch (e) {
            console.warn('Backend deletion network error:', e);
            progress.remove();
            return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
        }

        if (!serverRes || serverRes.ok !== true) {
            progress.remove();
            const msg = (serverRes && (serverRes.message || serverRes.error)) || 'Server rejected the request.';
            console.warn('🗑️ Deletion rejected:', msg);
            return { ok: false, message: msg };
        }

        try {
            if (window.db && phone) {
                await window.db.collection('profiles').doc(phone).delete();
                console.log('🗑️ Firestore profile deleted');
            }
        } catch (e) { console.warn('Firestore delete failed:', e); }

        try { if (window.auth && window.auth.currentUser) await window.auth.signOut(); } catch (e) {}

        try {
            localStorage.clear();
            sessionStorage.clear();
            console.log('🗑️ Local storage cleared');
        } catch (e) {}

        try {
            if (window.indexedDB && indexedDB.deleteDatabase) {
                indexedDB.deleteDatabase('sandesaiMedia');
                console.log('🗑️ Media IndexedDB deleted');
            }
        } catch (e) {}

        progress.innerHTML = `
            <div style="font-size:2.6rem;">✅</div>
            <div style="font-size:1rem;color:#2fd992;font-weight:600;">Account deleted</div>
            <div style="font-size:0.8rem;color:#7a89a8;text-align:center;max-width:280px;">
                ${name ? 'Goodbye, ' + escapeHtml(name) + '.' : 'Goodbye.'} Thanks for using Sandesai.
            </div>
            <div style="font-size:0.7rem;color:#5a6885;margin-top:8px;">Reloading…</div>`;

        setTimeout(() => location.reload(), 2200);
        return { ok: true };
    }

    window.showDeleteAccountDialog = showDeleteAccountDialog;

    // ────────────────────────────────────────────────────────────
    // 19. FIRST-RUN REGISTRATION GATE (Phone Auth + Google)
    // ────────────────────────────────────────────────────────────
    function isRegistered() {
        return !!localStorage.getItem('premCallRegisteredAt') &&
               localStorage.getItem('premCallVerified') === 'true' &&
               !!localStorage.getItem('premCallNumber');
    }

    function showBootRegistrationScreen() {
        if ($('bootRegScreen')) return;
        if ($('inviteWelcomeOverlay')) return;
        if ($('googlePhoneStep')) return;

        if (!$('bootRegStyles')) {
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
                .gbtn {
                    width:100%;padding:13px 16px;border-radius:14px;
                    border:1px solid rgba(255,255,255,0.1);
                    background:#fff;color:#1f1f1f;
                    font-weight:600;font-size:0.95rem;cursor:pointer;
                    display:flex;align-items:center;justify-content:center;gap:10px;
                    font-family:inherit;transition:transform 0.1s;
                }
                .gbtn:hover { background:#f5f5f5; }
                .gbtn svg { flex-shrink:0; }`;
            document.head.appendChild(style);
        }

        const screen = document.createElement('div');
        screen.id = 'bootRegScreen';
        screen.style.cssText = `
            position: fixed; inset: 0; z-index: 100000;
            background: #07050e; overflow-y: auto; padding: 32px 24px;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #eef0f5;
            display: flex; flex-direction: column; align-items: center;`;

        const bg = document.createElement('div');
        bg.style.cssText = `
            position: fixed; inset: 0; z-index: -1; pointer-events: none;
            background:
                radial-gradient(circle at 20% 15%, rgba(139,92,246,0.20), transparent 55%),
                radial-gradient(circle at 80% 85%, rgba(110,231,255,0.15), transparent 55%),
                radial-gradient(circle at 50% 50%, rgba(124,58,237,0.08), transparent 70%);`;
        screen.appendChild(bg);

        const card = document.createElement('div');
        card.style.cssText = `
            max-width: 400px; width: 100%; margin: auto 0;
            background: rgba(18,16,36,0.88);
            backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
            border: 1px solid rgba(255,255,255,0.07); border-radius: 28px;
            padding: 32px 26px 26px;
            box-shadow: 0 40px 100px rgba(0,0,0,0.7);
            animation: bootCardIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);`;

        card.innerHTML = `
            <div style="text-align:center;margin-bottom:22px;">
                <img src="sandesai-logo.png" alt="Sandesai"
                     style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px;display:block;
                            border:2px solid rgba(139,92,246,0.3);
                            box-shadow:0 0 60px rgba(139,92,246,0.4),0 0 100px rgba(110,231,255,0.15);" />
                <div style="font-size:1.65rem;font-weight:700;letter-spacing:-0.02em;
                            background:linear-gradient(135deg,#a78bfa,#6ee7ff);
                            -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                    Sandesai
                </div>
                <div style="font-size:0.83rem;color:#7a89a8;margin-top:4px;">Sign up to get started</div>
            </div>

            <button id="bootRegGoogleBtn" class="gbtn" type="button">
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/>
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 5.1 29.3 3 24 3 16 3 9.1 7.6 6.3 14.7z"/>
                    <path fill="#4CAF50" d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 36.1 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-6.9l-6.6 5.1C9 41.4 16 45 24 45z"/>
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C41.6 35.4 45 30.2 45 24c0-1.2-.1-2.4-.4-3.5z"/>
                </svg>
                Continue with Google
            </button>

            <div style="display:flex;align-items:center;gap:12px;margin:18px 0 14px;">
                <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
                <div style="font-size:0.7rem;color:#5a6885;letter-spacing:0.08em;text-transform:uppercase;">or use SMS OTP</div>
                <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
            </div>

            <div style="display:flex;flex-direction:column;gap:12px;">
                <div>
                    <label style="${LBL}">Name</label>
                    <input id="bootRegName" type="text" placeholder="Your name" autocomplete="name" style="${INP}" />
                </div>
                <div>
                    <label style="${LBL}">Username</label>
                    <input id="bootRegUserid" type="text" placeholder="3–20 letters, numbers, _ or ."
                           autocomplete="username" autocapitalize="none" style="${INP}" />
                    <div id="bootRegUserStatus" style="font-size:0.72rem;color:#7a89a8;margin-top:4px;min-height:1em;"></div>
                </div>
                <div>
                    <label style="${LBL}">Phone Number</label>
                    <input id="bootRegPhone" type="tel" placeholder="10-digit number"
                           maxlength="10" inputmode="numeric" autocomplete="tel-national" style="${INP}" />
                </div>
                <div>
                    <label style="${LBL}">Email <span style="text-transform:none;color:#5a6885;font-weight:400;">(optional)</span></label>
                    <input id="bootRegEmail" type="email" placeholder="you@example.com"
                           autocomplete="email" inputmode="email" style="${INP}" />
                </div>
                <div>
                    <label style="${LBL}">SMS OTP</label>
                    <div style="display:flex;gap:8px;">
                        <input id="bootRegOtp" type="text" placeholder="Enter OTP"
                               inputmode="numeric" maxlength="6" autocomplete="one-time-code"
                               style="${INP}flex:1;min-width:0;letter-spacing:2px;" />
                        <button id="bootRegSendOtp" type="button" style="${BTN_OTP}">Send OTP</button>
                    </div>
                    <div id="bootRegOtpStatus"
                         style="font-size:0.72rem;color:#7a89a8;margin-top:6px;min-height:1em;"></div>
                </div>
            </div>

            <div id="bootRegError" style="display:none;font-size:0.78rem;color:#ef4444;
                        background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);
                        border-radius:12px;padding:10px 12px;margin-top:14px;"></div>

            <button id="bootRegSubmit" type="button" style="${BTN_PRIMARY}margin-top:20px;">Register</button>

            <div style="margin-top:14px;text-align:center;font-size:0.7rem;color:#5a6885;line-height:1.5;">
                By registering you agree to Sandesai's terms<br />and privacy policy.
            </div>`;
        screen.appendChild(card);
        document.body.appendChild(screen);

        // ── Phone OTP via Firebase Phone Auth ──
        (function wirePhoneOtp() {
            const btn = $('bootRegSendOtp');
            const status = $('bootRegOtpStatus');
            const setStatus = (t, c) => { if (status) { status.textContent = t; status.style.color = c || '#7a89a8'; } };

            btn.addEventListener('click', async () => {
                const phone = $('bootRegPhone').value.trim();
                if (!PHONE_RE.test(phone)) return toast('Enter a valid 10-digit Indian mobile (starts 6–9)');

                btn.disabled = true;
                btn.textContent = 'Sending…';
                setStatus('');

                const res = await sendPhoneOtp(phone, 'bootRegSendOtp');
                if (!res.ok) {
                    toast('⚠️ ' + res.message);
                    setStatus('❌ ' + res.message, '#ef4444');
                    btn.disabled = false;
                    btn.textContent = 'Send OTP';
                    return;
                }

                toast('📱 SMS sent to ' + res.sentTo);
                setStatus('✅ Code sent by SMS. Check your messages.', '#2fd992');

                let cd = 60;
                btn.textContent = 'Resend (' + cd + 's)';
                const tick = setInterval(() => {
                    cd--;
                    if (cd <= 0) { clearInterval(tick); btn.disabled = false; btn.textContent = 'Send OTP'; }
                    else btn.textContent = 'Resend (' + cd + 's)';
                }, 1000);
            });
        })();

        // ── Google button ──
        $('bootRegGoogleBtn').addEventListener('click', async () => {
            const btn = $('bootRegGoogleBtn');
            btn.disabled = true;
            btn.style.opacity = '0.7';
            btn.innerHTML = '<span style="color:#666;">Opening Google…</span>';

            const user = await signInWithGoogle();
            if (!user) {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.innerHTML = 'Continue with Google';
                return;
            }
            await startGoogleRegistrationFlow(user);
        });

        // ── Username live check ──
        const useridInput = $('bootRegUserid');
        const userStatus = $('bootRegUserStatus');
        let useridCheckTimer = null;
        const setUserStatus = (t, c) => { userStatus.textContent = t; userStatus.style.color = c || '#7a89a8'; };

        useridInput.addEventListener('input', () => {
            const v = useridInput.value.trim();
            clearTimeout(useridCheckTimer);
            if (v.length < 3) return setUserStatus('');
            if (!USERNAME_RE.test(v)) return setUserStatus('Use 3–20 letters, numbers, _ or .', '#f59e0b');
            useridCheckTimer = setTimeout(async () => {
                const phoneVal = $('bootRegPhone').value.trim();
                const avail = await checkAvailability(v, PHONE_RE.test(phoneVal) ? phoneVal : '');
                if (avail && avail.usernameAvailable === false) setUserStatus('❌ Username is already taken', '#ef4444');
                else if (avail && avail.usernameAvailable === true) setUserStatus('✅ Username available', '#2fd992');
                else setUserStatus('');
            }, 500);
        });

        // ── Register button ──
        const submitBtn = $('bootRegSubmit');
        const errBox = $('bootRegError');
        const showErr = (m) => { errBox.style.display = 'block'; errBox.textContent = m; };
        const clearErr = () => { errBox.style.display = 'none'; errBox.textContent = ''; };
        const resetSubmit = () => { submitBtn.disabled = false; submitBtn.style.opacity = '1'; submitBtn.textContent = 'Register'; };
        const fail = (msg) => { showErr(msg); resetSubmit(); };

        submitBtn.addEventListener('click', async () => {
            clearErr();
            const name   = $('bootRegName').value.trim();
            const userid = $('bootRegUserid').value.trim();
            const phone  = $('bootRegPhone').value.trim();
            const email  = $('bootRegEmail').value.trim();
            const otp    = $('bootRegOtp').value.trim();

            if (!name)                     return showErr('Please enter your name');
            if (!userid)                   return showErr('Please choose a username');
            if (!USERNAME_RE.test(userid)) return showErr('Username: 3–20 letters, numbers, _ or .');
            if (!PHONE_RE.test(phone))     return showErr('Enter a valid 10-digit Indian mobile (starts 6–9)');
            if (email && !EMAIL_RE.test(email)) return showErr('Please enter a valid email or leave it blank');
            if (!otp)                      return showErr('Please enter the SMS OTP');

            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.7';
            submitBtn.textContent = 'Checking…';

            const avail = await checkAvailability(userid, phone);
            if (avail && avail.ok === false)                return fail(avail.message || 'Could not check availability');
            if (avail && avail.usernameAvailable === false) return fail('Username is already taken');
            if (avail && avail.phoneAvailable === false)    return fail('This phone number is already registered. Try signing in instead.');

            submitBtn.textContent = 'Verifying…';
            const verify = await verifyPhoneOtp(otp);
            if (!verify.ok) return fail(verify.message || 'Invalid OTP');

            submitBtn.textContent = 'Registering…';
            const res = await _finishRegistration(name, phone, userid, email, 'phone');
            if (!res.ok) return fail(res.message || 'Registration failed');

            const screenEl = $('bootRegScreen');
            if (screenEl) {
                screenEl.style.transition = 'opacity 0.45s ease';
                screenEl.style.opacity = '0';
                setTimeout(() => screenEl.remove(), 500);
            }
            toast('✅ Welcome to Sandesai, ' + name + '!');
            setTimeout(() => {
                if (typeof window.renderChatList === 'function') window.renderChatList();
                if (typeof window.renderCallList === 'function') window.renderCallList();
            }, 600);
        });

        $('bootRegOtp').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitBtn.click();
        });

        setTimeout(() => $('bootRegName')?.focus(), 400);
    }

    function bootRegistrationGate() {
        if ($('inviteWelcomeOverlay')) return;
        if ($('googlePhoneStep')) return;
        if (isRegistered()) return;
        if (forceUpdateShown) return;

        if (bootHadInvite) {
            setTimeout(() => {
                if ($('inviteWelcomeOverlay') || isRegistered() || forceUpdateShown || $('googlePhoneStep')) return;
                showBootRegistrationScreen();
            }, 1500);
            return;
        }
        showBootRegistrationScreen();
    }

    window.showBootRegistrationScreen = showBootRegistrationScreen;

    // ────────────────────────────────────────────────────────────
    // 20. BOOT — Google redirect check FIRST, before any anonymous sign-in
    // ────────────────────────────────────────────────────────────
    async function onBoot() {
        // ── STEP 1: Handle Google redirect result BEFORE anything else ──
        // This must run before ensureWindowAuth() / initFirebaseMessaging(),
        // because script.js calls signInAnonymously() which would overwrite
        // the pending Google redirect session.
        if (typeof firebase !== 'undefined' && window.firebase && typeof window.firebase.auth === 'function') {
            try {
                const authInstance = window.firebase.auth();
                window.auth = authInstance;
                const result = await authInstance.getRedirectResult();
                if (result && result.user) {
                    console.log('🔵 Google redirect result caught:', result.user.email);
                    setTimeout(() => startGoogleRegistrationFlow(result.user), 400);
                    return;
                }
            } catch (e) {
                console.warn('getRedirectResult check failed:', e);
            }
        }

        // ── STEP 2: No pending redirect — bootstrap Firebase normally ──
        ensureWindowAuth();

        const params = new URLSearchParams(location.search);
        bootHadInvite = params.has('join') || params.has('invite');

        const needsUpdate = await checkForceUpdate();
        if (needsUpdate) return;

        if (isRegistered()) {
            const phone = localStorage.getItem('premCallNumber');
            if (phone) {
                setTimeout(() => {
                    verifySessionWithServer(phone).then((r) => {
                        if (r && r.ok) registerSessionWithServer(phone);
                        else if (r && (r.error === 'not_found' || r.error === 'expired')) {
                            registerSessionWithServer(phone);
                        }
                    });
                }, 1500);
            }
        }

        setTimeout(handleInviteFromURL, 700);
        setTimeout(bootRegistrationGate, 1300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onBoot);
    } else {
        onBoot();
    }

    console.log('✨ enhancements.js v14 loaded — Google redirect ordering fix, Phone Auth, Firebase bootstrap');
})();