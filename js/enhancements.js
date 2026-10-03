// ================================================================
// js/enhancements.js  (v19 – TOTP lock, unlock, disable, logout-all)
// ================================================================
(function () {
    'use strict';

    const INVITE_SECRET = 'sandesai-invite-v1-2026';
    const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    const CFG = window.SANDESAI || {};
    const SHEET_WEBHOOK_URL = CFG.SHEET_API_URL;
    const SHEET_WEBHOOK_SECRET = CFG.SHEET_WEBHOOK_SECRET;

    if (!window.SANDESAI) console.warn('⚠️ window.SANDESAI missing — is config.js loaded first?');
    console.log('🔗 Backend URL:', SHEET_WEBHOOK_URL);

    const LOCAL_APP_VERSION = '0.9';

    let bootHadInvite = false;
    let forceUpdateShown = false;

    // ────────────────────────────────────────────────────────────
    // 0. HELPERS
    // ────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const toast = (m) => { if (window.showToast) window.showToast(m); };

    const PHONE_RE    = /^[6-9]\d{9}$/;
    const EMAIL_RE    = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

    const LBL = 'font-size:0.72rem;color:#7a89a8;text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:6px;font-weight:500;';
    const INP = 'width:100%;padding:13px 16px;border-radius:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#eef0f5;font-size:16px;outline:none;font-family:inherit;';
    const BTN_PRIMARY = 'width:100%;padding:15px;border-radius:16px;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-weight:700;font-size:1rem;cursor:pointer;font-family:inherit;box-shadow:0 8px 24px rgba(139,92,246,0.35);';
    const BTN_OTP = 'padding:13px 18px;border-radius:14px;border:1px solid rgba(139,92,246,0.25);background:rgba(139,92,246,0.12);color:#a78bfa;font-weight:600;font-size:0.8rem;cursor:pointer;white-space:nowrap;font-family:inherit;';
    const BTN_SECONDARY = 'width:100%;padding:12px;margin-top:10px;border-radius:14px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:#a78bfa;font-weight:500;font-size:0.85rem;cursor:pointer;font-family:inherit;';

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
            catch (e) { throw new Error('Backend returned non-JSON'); }
        } finally { clearTimeout(timer); }
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
            catch (e) { throw new Error('Backend returned non-JSON (redeploy?)'); }
        } finally { clearTimeout(timer); }
    }

    // ────────────────────────────────────────────────────────────
    // 0b. FIREBASE AUTH
    // ────────────────────────────────────────────────────────────
    function getAuthUid() {
        try {
            if (window.auth && window.auth.currentUser && window.auth.currentUser.uid) return window.auth.currentUser.uid;
        } catch (e) {}
        try {
            if (window.firebase && typeof window.firebase.auth === 'function') {
                const a = window.firebase.auth();
                if (a && a.currentUser && a.currentUser.uid) {
                    if (!window.auth) window.auth = a;
                    return a.currentUser.uid;
                }
            }
        } catch (e) {}
        return '';
    }

    function ensureWindowAuth() {
        if (window.auth) return;
        if (typeof firebase === 'undefined') return;
        try { if (typeof window.initFirebaseMessaging === 'function') window.initFirebaseMessaging(); } catch (e) {}
        try {
            if (window.firebase && typeof window.firebase.auth === 'function') {
                window.auth = window.firebase.auth();
            }
        } catch (e) {}
    }

    function getAuthInstance() {
        if (window.auth && window.auth.currentUser !== undefined) return window.auth;
        if (typeof firebase === 'undefined') return null;
        try { if (typeof window.initFirebaseMessaging === 'function') window.initFirebaseMessaging(); } catch (e) {}
        try {
            if (window.firebase && typeof window.firebase.auth === 'function') {
                window.auth = window.firebase.auth();
                return window.auth;
            }
        } catch (e) {}
        return null;
    }

    // ────────────────────────────────────────────────────────────
    // 0c. DEVICE SESSION
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
                secret: SHEET_WEBHOOK_SECRET, type: 'registerSession',
                phone: phone, token: getDeviceToken(),
                device: (navigator.userAgent || 'web').slice(0, 110)
            });
            if (res && res.ok) console.log('🔐 Session registered');
        } catch (e) { console.warn('Session failed:', e); }
    }

    async function verifySessionWithServer(phone) {
        if (!phone) return { ok: false };
        try {
            return await postJson({
                secret: SHEET_WEBHOOK_SECRET, type: 'verifySession',
                phone: phone, token: getDeviceToken()
            });
        } catch (e) { return { ok: false, error: 'network' }; }
    }

    // ────────────────────────────────────────────────────────────
    // 1. INVITE TOKENS
    // ────────────────────────────────────────────────────────────
    function signPayload(str) {
        let hash = 0;
        const s = INVITE_SECRET + '|' + str;
        for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash = hash & hash; }
        return Math.abs(hash).toString(36);
    }

    function createInviteToken({ from, to, chat, msg, name }) {
        const payload = { from, to, chat: chat || to, msg: msg || '', name: name || '', exp: Date.now() + INVITE_TTL_MS };
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
    // 2. FORCE UPDATE
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
        banner.style.cssText = 'position:fixed;inset:0;z-index:95000;background:rgba(8,6,20,0.96);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;color:#eef0f5;';
        banner.innerHTML = `
            <div style="max-width:360px;width:100%;text-align:center;background:rgba(18,16,36,0.96);border:1px solid rgba(139,92,246,0.3);border-radius:24px;padding:32px 24px;box-shadow:0 40px 100px rgba(0,0,0,0.8);">
                <div style="font-size:2.4rem;margin-bottom:12px;">🚀</div>
                <div style="font-size:1.2rem;font-weight:700;margin-bottom:10px;">Update required</div>
                <div style="font-size:0.85rem;color:#a5b3d0;line-height:1.5;margin-bottom:22px;">${escapeHtml(message || 'A new version is available.')}</div>
                <button id="forceUpdateBtn" style="${BTN_PRIMARY}padding:14px;">Refresh now</button>
            </div>`;
        document.body.appendChild(banner);
        $('forceUpdateBtn').addEventListener('click', () => location.reload());
    }

    async function checkForceUpdate() {
        try {
            const data = await fetchJson(SHEET_WEBHOOK_URL + '?type=health', 10000);
            if (!data.ok) return false;
            console.log('🩺 Backend', data.version);
            const minV = data.minAppVersion;
            if (minV && versionLess(LOCAL_APP_VERSION, minV)) { showForceUpdateBanner(data.updateMessage); return true; }
        } catch (e) { console.warn('Health check failed:', e.message || e); }
        return false;
    }

    // ────────────────────────────────────────────────────────────
    // 3. BACKEND CALLS
    // ────────────────────────────────────────────────────────────
    async function checkAvailability(username, phone) {
        try {
            return await fetchJson(
                SHEET_WEBHOOK_URL + '?type=checkAvailability' +
                '&username=' + encodeURIComponent(username || '') +
                '&phone=' + encodeURIComponent(phone || ''), 12000);
        } catch (e) { return { ok: true, unchecked: true }; }
    }

    async function sendOtpEmail(phone, email) {
        try {
            const data = await fetchJson(
                SHEET_WEBHOOK_URL + '?type=sendOtp' +
                '&secret=' + encodeURIComponent(SHEET_WEBHOOK_SECRET) +
                '&phone=' + encodeURIComponent(phone) +
                '&email=' + encodeURIComponent(email));
            if (!data.ok) return { ok: false, error: data.message || data.error || 'unknown' };
            return { ok: true, sentTo: data.sentTo };
        } catch (e) { return { ok: false, error: e.message || 'Network error' }; }
    }

    async function verifyOtpEmail(phone, code) {
        try {
            return await fetchJson(
                SHEET_WEBHOOK_URL + '?type=checkOtp' +
                '&phone=' + encodeURIComponent(phone) +
                '&code=' + encodeURIComponent(code));
        } catch (e) { return { ok: false, error: 'network' }; }
    }

    async function checkUserExists(uid, email) {
        try {
            return await fetchJson(
                SHEET_WEBHOOK_URL + '?type=checkUser' +
                '&uid=' + encodeURIComponent(uid || '') +
                '&email=' + encodeURIComponent(email || ''), 12000);
        } catch (e) { return { ok: false, unchecked: true }; }
    }

    function otpFieldHtml(prefix) {
        return `
            <div style="display:flex;gap:8px;">
                <input id="${prefix}Otp" type="text" placeholder="Enter OTP"
                       inputmode="numeric" maxlength="6" autocomplete="one-time-code"
                       style="${INP}flex:1;min-width:0;letter-spacing:2px;" />
                <button id="${prefix}SendOtp" type="button" style="${BTN_OTP}">Send OTP</button>
            </div>
            <div id="${prefix}OtpStatus" style="font-size:0.72rem;color:#7a89a8;margin-top:6px;min-height:1em;"></div>`;
    }

    function wireSendOtp(prefix, phoneId, emailId) {
        const btn = $(prefix + 'SendOtp');
        const status = $(prefix + 'OtpStatus');
        const setStatus = (t, c) => { if (status) { status.textContent = t; status.style.color = c || '#7a89a8'; } };

        btn.addEventListener('click', async () => {
            const phone = $(phoneId).value.trim();
            const email = $(emailId).value.trim();
            if (!PHONE_RE.test(phone)) return toast('Enter a valid 10-digit Indian mobile (starts 6–9)');
            if (!EMAIL_RE.test(email)) return toast('Please enter a valid email');
            btn.disabled = true; btn.textContent = 'Sending…'; setStatus('');
            const res = await sendOtpEmail(phone, email);
            if (!res.ok) {
                toast('Could not send OTP: ' + res.error);
                setStatus('❌ ' + res.error, '#ef4444');
                btn.disabled = false; btn.textContent = 'Send OTP';
                return;
            }
            toast('📧 Code sent to ' + (res.sentTo || email));
            setStatus('✅ Sent to ' + (res.sentTo || email) + '. Check inbox & spam.', '#2fd992');
            let cd = 60;
            btn.textContent = 'Resend (' + cd + 's)';
            const tick = setInterval(() => {
                cd--;
                if (cd <= 0) { clearInterval(tick); btn.disabled = false; btn.textContent = 'Send OTP'; }
                else btn.textContent = 'Resend (' + cd + 's)';
            }, 1000);
        });
    }

    // ────────────────────────────────────────────────────────────
    // 3b. GOOGLE
    // ────────────────────────────────────────────────────────────
    function isMobileUA() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent); }

    async function signInWithGoogle() {
        const auth = getAuthInstance();
        if (!auth) { toast('⚠️ Auth not ready. Refresh.'); return null; }
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try {
            if (isMobileUA()) { await auth.signInWithRedirect(provider); return null; }
            const result = await auth.signInWithPopup(provider);
            return result.user || null;
        } catch (e) {
            if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
                await auth.signInWithRedirect(provider); return null;
            }
            if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return null;
            console.error('Google sign-in failed:', e);
            toast('⚠️ Google sign-in failed');
            return null;
        }
    }

    async function handleGoogleRedirectResult() {
        const auth = getAuthInstance();
        if (!auth) return null;
        try {
            const result = await auth.getRedirectResult();
            if (result && result.user) return result.user;
        } catch (e) { console.warn('getRedirectResult failed:', e); }
        return null;
    }

    async function startGoogleRegistrationFlow(googleUser) {
        if (!googleUser) return;
        const uid = googleUser.uid || '';
        const email = googleUser.email || '';
        const name = googleUser.displayName || (email.split('@')[0] || '');
        console.log('🔵 Google user:', { uid, email, name });
        const check = await checkUserExists(uid, email);
        if (check && check.exists && check.registeredPhone) {
            const phone = check.registeredPhone;
            const userData = { name, userid: check.registeredUsername || name, phone, email, registered: true, status: 'online', provider: 'google' };
            activateApp(userData);
            $('bootRegScreen')?.remove(); $('loginScreen')?.remove(); $('googlePhoneStep')?.remove();
            toast('👋 Welcome back, ' + name + '!');
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
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100100;background:#07050e;overflow-y:auto;padding:32px 24px;font-family:Inter,sans-serif;color:#eef0f5;display:flex;flex-direction:column;align-items:center;';
        overlay.innerHTML = `
            <div style="max-width:400px;width:100%;margin:auto 0;background:rgba(18,16,36,0.92);border:1px solid rgba(255,255,255,0.07);border-radius:28px;padding:32px 26px 26px;box-shadow:0 40px 100px rgba(0,0,0,0.7);">
                <div style="text-align:center;margin-bottom:22px;">
                    ${gUser.photo ? `<img src="${escapeHtml(gUser.photo)}" style="width:72px;height:72px;border-radius:50%;border:2px solid rgba(139,92,246,0.4);margin-bottom:10px;object-fit:cover;" />` : `<div style="width:72px;height:72px;border-radius:50%;margin:0 auto 10px;background:linear-gradient(135deg,#7c3aed,#6ee7ff);display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;color:#fff;">${escapeHtml((gUser.name || '?').charAt(0).toUpperCase())}</div>`}
                    <div style="font-size:1.15rem;font-weight:700;">Hi, ${escapeHtml(gUser.name || 'there')}!</div>
                    <div style="font-size:0.8rem;color:#7a89a8;margin-top:4px;">${escapeHtml(gUser.email || '')}</div>
                    <div style="font-size:0.85rem;color:#a5b3d0;margin-top:14px;line-height:1.5;">One last step — add your phone number so friends can find you.</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:14px;">
                    <div>
                        <label style="${LBL}">Username</label>
                        <input id="gPhoneUserid" type="text" placeholder="3–20 letters, numbers, _ or ." autocapitalize="none" style="${INP}" />
                        <div id="gPhoneUserStatus" style="font-size:0.72rem;color:#7a89a8;margin-top:4px;min-height:1em;"></div>
                    </div>
                    <div>
                        <label style="${LBL}">Phone Number</label>
                        <input id="gPhonePhone" type="tel" placeholder="10-digit number" maxlength="10" inputmode="numeric" style="${INP}" />
                    </div>
                </div>
                <div id="gPhoneError" style="display:none;font-size:0.78rem;color:#ef4444;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:10px 12px;margin-top:14px;"></div>
                <button id="gPhoneSubmit" style="${BTN_PRIMARY}margin-top:20px;">Complete sign-up</button>
                <button id="gPhoneBack" style="${BTN_SECONDARY}">Use a different account</button>
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
                if (avail && avail.usernameAvailable === false) setUserStatus('❌ Username taken', '#ef4444');
                else if (avail && avail.usernameAvailable === true) setUserStatus('✅ Available', '#2fd992');
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
            const phone = phoneInput.value.trim();
            if (!userid) return showErr('Pick a username');
            if (!USERNAME_RE.test(userid)) return showErr('Username: 3–20 letters, numbers, _ or .');
            if (!PHONE_RE.test(phone)) return showErr('Enter a valid 10-digit Indian mobile');

            submitBtn.disabled = true;
            submitBtn.textContent = 'Checking…';
            const avail = await checkAvailability(userid, phone);
            if (avail && avail.ok === false) { submitBtn.disabled = false; submitBtn.textContent = 'Complete sign-up'; return showErr(avail.message); }
            if (avail && avail.usernameAvailable === false) { submitBtn.disabled = false; submitBtn.textContent = 'Complete sign-up'; return showErr('Username taken'); }
            if (avail && avail.phoneAvailable === false) { submitBtn.disabled = false; submitBtn.textContent = 'Complete sign-up'; return showErr('Phone already registered'); }

            submitBtn.textContent = 'Saving…';
            let regRes;
            try {
                regRes = await postJson({
                    secret: SHEET_WEBHOOK_SECRET, type: 'registration', provider: 'google', authMethod: 'google',
                    name: gUser.name || '', username: userid, phone: phone, email: gUser.email || '', uid: gUser.uid
                });
            } catch (e) { submitBtn.disabled = false; submitBtn.textContent = 'Complete sign-up'; return showErr('Network error.'); }
            if (regRes && regRes.ok === false) { submitBtn.disabled = false; submitBtn.textContent = 'Complete sign-up'; return showErr(regRes.message || 'Registration failed'); }

            const userData = { name: gUser.name, userid, phone, email: gUser.email, registered: true, status: 'online', provider: 'google' };
            activateApp(userData);
            overlay.remove(); $('bootRegScreen')?.remove(); $('loginScreen')?.remove();
            toast('✅ Welcome to Sandesai, ' + (gUser.name || 'friend') + '!');
            showWelcomePopup(gUser.name);
            const pending = window._pendingInvitePayload;
            if (pending) {
                window._pendingInvitePayload = null;
                const peer = pending.from || pending.chat;
                if (peer) setTimeout(() => openChatWhenReady(peer), 800);
            }
        });

        setTimeout(() => useridInput?.focus(), 400);
    }

    window.signInWithGoogle = signInWithGoogle;
    window.startGoogleRegistrationFlow = startGoogleRegistrationFlow;

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
        if (navigator.share) { try { await navigator.share({ title: 'Sandesai Invite', text }); return; } catch (err) { if (err.name === 'AbortError') return; } }
        if (navigator.clipboard) { try { await navigator.clipboard.writeText(text); toast('📋 Invite copied'); return; } catch (e) {} }
    }

    async function shareInviteOpen() {
        const userData = JSON.parse(localStorage.getItem('neonUser') || '{}');
        const me = localStorage.getItem('premCallNumber') || '';
        const senderName = userData.name || 'Someone';
        const url = buildInviteURL(createInviteToken({ from: me, to: '', chat: me, name: senderName }));
        const text = `👋 Join me on Sandesai!\n\n${url}`;
        if (navigator.share) { try { await navigator.share({ title: 'Join Sandesai', text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
        if (navigator.clipboard) { await navigator.clipboard.writeText(text); toast('📋 Invite copied'); }
    }

    window.shareInviteForPeer = shareInviteForPeer;
    window.shareInviteOpen = shareInviteOpen;

    // ────────────────────────────────────────────────────────────
    // 5. LOCAL SESSION
    // ────────────────────────────────────────────────────────────
    function activateApp(userData) {
        localStorage.setItem('neonUser', JSON.stringify(userData));
        localStorage.setItem('premCallNumber', userData.phone);
        localStorage.setItem('premCallVerified', 'true');
        localStorage.setItem('premCallRegisteredAt', String(Date.now()));
        registerSessionWithServer(userData.phone);
        if (window.PremCall) { try { window.PremCall.reinit ? window.PremCall.reinit(userData.phone) : window.PremCall.init(userData.phone); } catch (e) {} }
        if (!window.firebaseReady && typeof window.initFirebaseMessaging === 'function') window.initFirebaseMessaging();
        setTimeout(() => {
            if (window.db && userData.phone) {
                window.db.collection('profiles').doc(userData.phone).set({
                    phone: userData.phone, name: userData.name, username: userData.userid,
                    email: userData.email || '', updatedAt: Date.now()
                }, { merge: true }).catch(() => {});
            }
            if (typeof window.initCallSignaling === 'function') window.initCallSignaling();
            if (typeof window.initCallLogSync === 'function') window.initCallLogSync();
            if (typeof window.renderChatList === 'function') window.renderChatList();
            if (typeof window.renderCallList === 'function') window.renderCallList();
        }, 1200);
        const mn = $('myNumberDisplay'); if (mn) mn.textContent = userData.phone;
        const dot = $('headerStatusDot'); if (dot) dot.className = 'status-dot connecting';
        if (typeof window.updateStatusBadge === 'function') window.updateStatusBadge(userData);
        if (typeof window.renderProfileView === 'function') window.renderProfileView();
        const link = document.querySelector('.registration-link'); if (link) link.style.display = 'none';
    }

    // ────────────────────────────────────────────────────────────
    // 6. INVITE OVERLAY
    // ────────────────────────────────────────────────────────────
    function showInviteWelcomeOverlay(payload) {
        $('inviteWelcomeOverlay')?.remove();
        const isTargeted = !!(payload.to && payload.to.length === 10);
        const subtitle = isTargeted ? 'Someone invited you to Sandesai'
            : (payload.name ? `<b style="color:#c4b5fd">${escapeHtml(payload.name)}</b> wants to chat with you.` : 'Join the conversation.');

        const overlay = document.createElement('div');
        overlay.id = 'inviteWelcomeOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(8,6,20,0.94);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;color:#eef0f5;overflow-y:auto;';
        overlay.innerHTML = `
            <div style="max-width:380px;width:100%;background:rgba(18,16,36,0.96);border:1px solid rgba(255,255,255,0.06);border-radius:28px;padding:32px 24px;text-align:center;box-shadow:0 40px 80px rgba(0,0,0,0.7);margin:auto;">
                <img src="sandesai-logo.png" alt="Sandesai" style="width:64px;height:64px;border-radius:50%;margin-bottom:12px;" />
                <div style="font-size:1.3rem;font-weight:700;margin-bottom:4px;">You're invited to Sandesai</div>
                <div style="font-size:0.85rem;color:#7a89a8;margin-bottom:20px;">${subtitle}</div>

                <button id="inviteGoogleBtn" type="button" style="width:100%;padding:13px 16px;border-radius:14px;border:1px solid rgba(255,255,255,0.1);background:#fff;color:#1f1f1f;font-weight:600;font-size:0.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:inherit;margin-bottom:16px;">
                    <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 5.1 29.3 3 24 3 16 3 9.1 7.6 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 36.1 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-6.9l-6.6 5.1C9 41.4 16 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C41.6 35.4 45 30.2 45 24c0-1.2-.1-2.4-.4-3.5z"/></svg>
                    Continue with Google
                </button>

                <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                    <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
                    <div style="font-size:0.7rem;color:#5a6885;text-transform:uppercase;">or use email</div>
                    <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
                </div>

                <div style="display:flex;flex-direction:column;gap:14px;text-align:left;">
                    <div>
                        <label style="${LBL}">Your number</label>
                        <input id="invitePhone" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit number" value="${escapeHtml(payload.to || '')}" style="${INP}" />
                    </div>
                    <div>
                        <label style="${LBL}">Email</label>
                        <input id="inviteEmail" type="email" placeholder="you@example.com" style="${INP}" />
                    </div>
                    <div>
                        <label style="${LBL}">OTP</label>
                        ${otpFieldHtml('invite')}
                    </div>
                    <div>
                        <label style="${LBL}">Your name</label>
                        <input id="inviteName" type="text" placeholder="Your name" style="${INP}" />
                    </div>
                </div>

                <button id="inviteJoinBtn" style="${BTN_PRIMARY}margin-top:20px;">🚀 Join & open chat</button>
            </div>`;
        document.body.appendChild(overlay);
        wireSendOtp('invite', 'invitePhone', 'inviteEmail');

        $('inviteGoogleBtn').addEventListener('click', async () => {
            const btn = $('inviteGoogleBtn');
            btn.disabled = true;
            btn.innerHTML = '<span style="color:#666;">Opening Google…</span>';
            const user = await signInWithGoogle();
            if (!user) { btn.disabled = false; btn.innerHTML = 'Continue with Google'; return; }
            window._pendingInvitePayload = payload;
            await startGoogleRegistrationFlow(user);
        });

        $('inviteJoinBtn').addEventListener('click', async () => {
            const name = $('inviteName').value.trim();
            const phone = $('invitePhone').value.trim();
            const email = $('inviteEmail').value.trim();
            const otp = $('inviteOtp').value.trim();
            if (!PHONE_RE.test(phone)) return toast('Enter a valid 10-digit Indian mobile');
            if (!EMAIL_RE.test(email)) return toast('Enter a valid email');
            if (!otp) return toast('Enter the OTP');
            if (!name) return toast('Enter your name');

            const joinBtn = $('inviteJoinBtn');
            joinBtn.disabled = true;
            joinBtn.textContent = 'Verifying…';
            const verify = await verifyOtpEmail(phone, otp);
            if (!verify.ok) { toast('⚠️ ' + (verify.message || 'Invalid OTP')); joinBtn.disabled = false; joinBtn.textContent = '🚀 Join & open chat'; return; }

            let regRes;
            try {
                regRes = await postJson({
                    secret: SHEET_WEBHOOK_SECRET, type: 'registration', provider: 'otp', authMethod: 'totp',
                    name: name, username: name.toLowerCase().replace(/\s/g, ''), phone: phone, email: email
                });
            } catch (e) { regRes = { ok: false, message: 'Network error' }; }
            if (!regRes || regRes.ok === false) { toast('⚠️ ' + ((regRes && regRes.message) || 'Registration failed')); joinBtn.disabled = false; joinBtn.textContent = '🚀 Join & open chat'; return; }

            const userData = { name, userid: name.toLowerCase().replace(/\s/g, ''), phone, email, registered: true, status: 'online' };
            activateApp(userData);
            overlay.remove();
            showWelcomePopup(name);
            const isIntendedRecipient = !isTargeted || phone === payload.to;
            if (isIntendedRecipient && (payload.from || payload.chat)) setTimeout(() => openChatWhenReady(payload.from || payload.chat), 800);
        });
    }

    // ────────────────────────────────────────────────────────────
    // 7. OPEN CHAT WHEN READY
    // ────────────────────────────────────────────────────────────
    function openChatWhenReady(peer, maxWaitMs = 10000) {
        const start = Date.now();
        (function attempt() {
            const ready = window.firebaseReady && window.myNumber;
            if (ready || Date.now() - start > maxWaitMs) {
                if (typeof window.switchTab === 'function') window.switchTab('chat');
                if (typeof window.openChat === 'function') window.openChat(peer);
                return;
            }
            setTimeout(attempt, 250);
        })();
    }
    window.openChatWhenReady = openChatWhenReady;

    // ────────────────────────────────────────────────────────────
    // 8. WELCOME POPUP
    // ────────────────────────────────────────────────────────────
    function showJoinWelcomePopup(name, variant) {
        $('welcomePopup')?.remove();
        const isWelcome = variant === 'welcome';
        const safeName = escapeHtml(name || 'friend');
        const heading = isWelcome ? `Welcome, ${safeName}!` : `Welcome aboard, ${safeName}!`;
        const bodyText = isWelcome
            ? `You're all set. Tap the ⋮ menu to invite friends, refresh your connection, or explore settings.`
            : `That invite was for a different number, but you're all set. Enjoy Sandesai!`;

        const popup = document.createElement('div');
        popup.id = 'welcomePopup';
        popup.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(8,6,20,0.85);backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;color:#eef0f5;opacity:0;transition:opacity 0.35s ease;';
        popup.innerHTML = `
            <div style="max-width:340px;width:100%;background:rgba(18,16,36,0.96);border:1px solid rgba(255,255,255,0.07);border-radius:24px;padding:28px 24px 24px;text-align:center;box-shadow:0 40px 100px rgba(0,0,0,0.75);">
                <img src="sandesai-logo.png" alt="Sandesai" style="width:100px;height:100px;border-radius:50%;border:2px solid rgba(139,92,246,0.35);margin-bottom:14px;" />
                <div style="font-size:1.35rem;font-weight:700;margin-bottom:10px;">${heading}</div>
                <div style="font-size:0.85rem;color:#a5b3d0;line-height:1.55;margin-bottom:22px;">${bodyText}</div>
                <button id="welcomeGotItBtn" style="${BTN_PRIMARY}">Got it →</button>
            </div>`;
        document.body.appendChild(popup);
        requestAnimationFrame(() => { popup.style.opacity = '1'; });
        const dismiss = () => { popup.style.opacity = '0'; setTimeout(() => popup.remove(), 350); };
        $('welcomeGotItBtn').addEventListener('click', dismiss);
        setTimeout(() => { if (popup.parentNode) dismiss(); }, 7500);
    }

    function showWelcomePopup(name) { showJoinWelcomePopup(name, 'welcome'); }
    function showWrongInvitePopup(name) { showJoinWelcomePopup(name, 'wrong-invite'); }
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
        if (!payload) { toast('⚠️ Invite link expired or invalid'); history.replaceState({}, '', location.pathname); return; }
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
    // 10. REFRESH CONNECTION
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
                if (!window.firebaseReady && typeof window.initFirebaseMessaging === 'function') window.initFirebaseMessaging();
                else {
                    if (typeof window.initCallSignaling === 'function') window.initCallSignaling();
                    if (typeof window.initCallLogSync === 'function') window.initCallLogSync();
                }
                if (typeof window.renderChatList === 'function') window.renderChatList();
                if (typeof window.renderCallList === 'function') window.renderCallList();
                if (storedNum) registerSessionWithServer(storedNum);
                setTimeout(() => { toast('✅ Connection refreshed'); if (btn) btn.classList.remove('spinning'); }, 900);
            } catch (e) { toast('Refresh failed: ' + e.message); if (btn) btn.classList.remove('spinning'); }
        };
    }

    // ────────────────────────────────────────────────────────────
    // 11. CALL LOG SYNC
    // ────────────────────────────────────────────────────────────
    if (typeof window.initCallLogSync !== 'function') {
        window.callLogsUnsub = null;
        window.initCallLogSync = function () {
            if (!window.db || !window.myNumber) return;
            if (window.callLogsUnsub) { try { window.callLogsUnsub(); } catch (e) {} window.callLogsUnsub = null; }
            window.callLogsUnsub = window.db.collection('call_logs').where('owner', '==', window.myNumber).onSnapshot(snapshot => {
                try {
                    const remoteLogs = snapshot.docs.map(doc => doc.data());
                    const localLogs = JSON.parse(localStorage.getItem('premCallLogs')) || [];
                    const byId = new Map();
                    localLogs.forEach(l => byId.set(l.id, l));
                    remoteLogs.forEach(l => byId.set(l.id, l));
                    const merged = Array.from(byId.values()).sort((a, b) => (b.started || 0) - (a.started || 0)).slice(0, 100);
                    localStorage.setItem('premCallLogs', JSON.stringify(merged));
                    if (typeof window.renderCallList === 'function') window.renderCallList();
                } catch (e) {}
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
            if (window.userProfileCache[phone] && window.userProfileCache[phone].loaded) return window.userProfileCache[phone];
            if (!window.db) return null;
            try {
                const doc = await window.db.collection('profiles').doc(phone).get();
                if (doc.exists) {
                    const data = doc.data();
                    window.userProfileCache[phone] = { name: data.name || null, username: data.username || null, loaded: true };
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
    // 13. INJECT INVITE BUTTON
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
    // 14. LIVE TOKEN CARD
    // ────────────────────────────────────────────────────────────
    let _liveTokenTimer = null;

    async function showLiveTokenCard() {
        const phone = localStorage.getItem('premCallNumber');
        if (!phone) { toast('Sign in first'); return; }
        $('liveTokenModal')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'liveTokenModal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100300;background:rgba(8,6,20,0.96);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;color:#eef0f5;';
        overlay.innerHTML = `
            <div style="max-width:420px;width:100%;background:rgba(18,16,36,0.98);border:1px solid rgba(139,92,246,.25);border-radius:24px;padding:28px 24px 22px;box-shadow:0 40px 100px rgba(0,0,0,.8);">
                <div style="text-align:center;margin-bottom:18px;">
                    <img src="sandesai-logo.png" alt="Sandesai" style="width:56px;height:56px;border-radius:50%;border:1px solid rgba(139,92,246,.3);margin-bottom:10px;" />
                    <div style="font-size:1.05rem;font-weight:700;">Your live token</div>
                    <div style="font-size:0.78rem;color:#7a89a8;margin-top:4px;">Refreshes every minute</div>
                </div>

                <div style="background:rgba(139,92,246,.10);border:1px solid rgba(139,92,246,.32);border-radius:20px;padding:22px 18px;text-align:center;margin-bottom:16px;">
                    <div id="liveCodeValue" style="display:inline-block;font-size:52px;font-weight:800;letter-spacing:14px;color:#ffffff;font-family:'SF Mono',Menlo,monospace;text-shadow:0 0 28px rgba(139,92,246,.7);padding-left:14px;">••••</div>
                    <div style="margin-top:14px;">
                        <div style="height:4px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden;">
                            <div id="liveCodeBar" style="height:100%;width:100%;background:linear-gradient(90deg,#7c3aed,#6ee7ff);transition:width 1s linear;"></div>
                        </div>
                        <div id="liveCodeTimer" style="font-size:0.72rem;color:#7a89a8;margin-top:8px;">— s</div>
                    </div>
                </div>

                <div id="liveHintBox" style="font-size:0.82rem;color:#c4b5fd;background:rgba(139,92,246,.10);border:1px solid rgba(139,92,246,.25);border-radius:12px;padding:12px 14px;line-height:1.5;margin-bottom:16px;text-align:center;">—</div>

                <button id="liveChangeOffset" style="${BTN_PRIMARY}">Change my offset</button>
                <button id="liveDisableTotp" style="width:100%;padding:12px;margin-top:10px;border-radius:14px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.08);color:#ef4444;font-weight:600;font-size:0.85rem;cursor:pointer;font-family:inherit;">Turn off time code</button>
                <button id="liveClose" style="${BTN_SECONDARY}">Close</button>
            </div>`;
        document.body.appendChild(overlay);

        const codeEl = $('liveCodeValue');
        const barEl = $('liveCodeBar');
        const timerEl = $('liveCodeTimer');
        const hintEl = $('liveHintBox');

        async function refreshCode() {
            try {
                const res = await postJson({
                    secret: SHEET_WEBHOOK_SECRET, type: 'getMyCode',
                    phone: phone, token: getDeviceToken()
                });
                if (!res || !res.ok) {
                    codeEl.textContent = '••••';
                    hintEl.textContent = (res && res.message) || 'Could not load token.';
                    if (res && res.error === 'totp_disabled') {
                        // Hide the code card, show message
                        $('liveDisableTotp').style.display = 'none';
                    }
                    return;
                }
                codeEl.textContent = res.code;
                hintEl.textContent = res.hint;
                const pct = (res.secondsRemaining / 60) * 100;
                barEl.style.width = pct + '%';
                timerEl.textContent = res.secondsRemaining + 's';
            } catch (e) {
                hintEl.textContent = 'Network error.';
            }
        }

        refreshCode();
        if (_liveTokenTimer) clearInterval(_liveTokenTimer);
        _liveTokenTimer = setInterval(refreshCode, 1000);

        $('liveClose').addEventListener('click', () => {
            if (_liveTokenTimer) { clearInterval(_liveTokenTimer); _liveTokenTimer = null; }
            overlay.remove();
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                if (_liveTokenTimer) { clearInterval(_liveTokenTimer); _liveTokenTimer = null; }
                overlay.remove();
            }
        });
        $('liveChangeOffset').addEventListener('click', () => {
            if (_liveTokenTimer) { clearInterval(_liveTokenTimer); _liveTokenTimer = null; }
            overlay.remove();
            showChangeOffsetDialog(phone);
        });
        $('liveDisableTotp').addEventListener('click', () => {
            if (_liveTokenTimer) { clearInterval(_liveTokenTimer); _liveTokenTimer = null; }
            overlay.remove();
            showDisableTotpDialog(phone);
        });
    }

    // ────────────────────────────────────────────────────────────
    // 15. CHANGE OFFSET
    // ────────────────────────────────────────────────────────────
    function showChangeOffsetDialog(phone) {
        $('changeOffsetModal')?.remove();
        let currentOffset = 1;

        const overlay = document.createElement('div');
        overlay.id = 'changeOffsetModal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100400;background:rgba(8,6,20,0.96);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;color:#eef0f5;';
        overlay.innerHTML = `
            <div style="max-width:400px;width:100%;background:rgba(18,16,36,0.98);border:1px solid rgba(139,92,246,.25);border-radius:24px;padding:28px 24px 22px;box-shadow:0 40px 100px rgba(0,0,0,.8);">
                <div style="text-align:center;margin-bottom:18px;">
                    <div style="font-size:1.05rem;font-weight:700;">Change your offset</div>
                    <div style="font-size:0.78rem;color:#7a89a8;margin-top:4px;line-height:1.5;">Pick a new offset between -9 and +9. Zero is not allowed.</div>
                </div>
                <div style="display:flex;align-items:center;justify-content:center;gap:18px;margin:20px 0;">
                    <button id="offsetMinus" type="button" style="width:56px;height:56px;border-radius:50%;border:1px solid rgba(139,92,246,.4);background:rgba(139,92,246,.12);color:#a78bfa;font-size:24px;font-weight:700;cursor:pointer;font-family:inherit;line-height:1;">−</button>
                    <div style="min-width:120px;text-align:center;">
                        <div id="offsetValue" style="font-size:44px;font-weight:800;color:#ffffff;font-family:'SF Mono',Menlo,monospace;line-height:1;">+1</div>
                        <div id="offsetHint" style="font-size:0.75rem;color:#7a89a8;margin-top:6px;">1 step ahead</div>
                    </div>
                    <button id="offsetPlus" type="button" style="width:56px;height:56px;border-radius:50%;border:1px solid rgba(139,92,246,.4);background:rgba(139,92,246,.12);color:#a78bfa;font-size:24px;font-weight:700;cursor:pointer;font-family:inherit;line-height:1;">+</button>
                </div>
                <div style="margin-bottom:14px;">
                    <label style="${LBL}">Confirm with your password</label>
                    <input id="offsetPassword" type="password" placeholder="Your password" autocomplete="current-password" style="${INP}" />
                </div>
                <div id="offsetError" style="display:none;font-size:0.78rem;color:#ef4444;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:12px;padding:10px 12px;margin-bottom:12px;"></div>
                <button id="offsetSave" style="${BTN_PRIMARY}">Save new offset</button>
                <button id="offsetCancel" style="${BTN_SECONDARY}">Cancel</button>
            </div>`;
        document.body.appendChild(overlay);

        const valueEl = $('offsetValue');
        const hintEl = $('offsetHint');
        const errBox = $('offsetError');
        const showErr = (m) => { errBox.style.display = 'block'; errBox.textContent = m; };
        const clearErr = () => { errBox.style.display = 'none'; errBox.textContent = ''; };

        function render() {
            const sign = currentOffset >= 0 ? '+' : '';
            valueEl.textContent = sign + currentOffset;
            const abs = Math.abs(currentOffset);
            const steps = abs === 1 ? 'step' : 'steps';
            hintEl.textContent = abs + ' ' + steps + (currentOffset > 0 ? ' ahead' : ' behind');
        }

        $('offsetMinus').addEventListener('click', () => {
            let next = currentOffset - 1;
            if (next === 0) next = -1;
            if (next < -9) next = -9;
            currentOffset = next; render();
        });
        $('offsetPlus').addEventListener('click', () => {
            let next = currentOffset + 1;
            if (next === 0) next = 1;
            if (next > 9) next = 9;
            currentOffset = next; render();
        });

        $('offsetCancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        $('offsetSave').addEventListener('click', async () => {
            clearErr();
            const password = $('offsetPassword').value;
            if (!password) return showErr('Password is required.');
            const btn = $('offsetSave');
            btn.disabled = true; btn.textContent = 'Saving…';
            try {
                const res = await postJson({
                    secret: SHEET_WEBHOOK_SECRET, type: 'changeOffset',
                    phone: phone, token: getDeviceToken(),
                    password: password, newOffset: currentOffset
                });
                if (!res || !res.ok) {
                    showErr((res && res.message) || 'Could not save.');
                    btn.disabled = false; btn.textContent = 'Save new offset';
                    return;
                }
                toast('✅ Offset updated. Your next code will use it.');
                overlay.remove();
            } catch (e) {
                showErr('Network error.');
                btn.disabled = false; btn.textContent = 'Save new offset';
            }
        });

        render();
        setTimeout(() => $('offsetPassword')?.focus(), 200);
    }

    // ────────────────────────────────────────────────────────────
    // 16. DISABLE TOTP DIALOG
    // ────────────────────────────────────────────────────────────
    function showDisableTotpDialog(phone) {
        $('disableTotpModal')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'disableTotpModal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100500;background:rgba(8,6,20,0.96);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;color:#eef0f5;';
        overlay.innerHTML = `
            <div style="max-width:400px;width:100%;background:rgba(18,16,36,0.98);border:1px solid rgba(239,68,68,.25);border-radius:24px;padding:28px 24px 22px;box-shadow:0 40px 100px rgba(0,0,0,.8);">
                <div style="text-align:center;margin-bottom:18px;">
                    <div style="font-size:2.2rem;margin-bottom:8px;">⚠️</div>
                    <div style="font-size:1.05rem;font-weight:700;color:#ef4444;">Turn off time code?</div>
                    <div style="font-size:0.82rem;color:#a5b3d0;margin-top:8px;line-height:1.55;">
                        After this, you'll sign in using only your password. Your live token will stop working.
                    </div>
                </div>

                <div id="dtNoPassword" style="display:none;">
                    <div style="font-size:0.8rem;color:#f59e0b;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:12px;padding:12px;margin-bottom:14px;line-height:1.5;">
                        You don't have a password yet. Set one to turn off your time code.
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="${LBL}">New password</label>
                        <input id="dtNewPassword" type="password" placeholder="At least 6 characters" autocomplete="new-password" style="${INP}" />
                    </div>
                </div>

                <div id="dtHasPassword">
                    <div style="margin-bottom:14px;">
                        <label style="${LBL}">Confirm with your password</label>
                        <input id="dtPassword" type="password" placeholder="Your password" autocomplete="current-password" style="${INP}" />
                    </div>
                </div>

                <div id="dtError" style="display:none;font-size:0.78rem;color:#ef4444;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:12px;padding:10px 12px;margin-bottom:12px;"></div>

                <button id="dtConfirm" style="width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;font-family:inherit;box-shadow:0 8px 24px rgba(239,68,68,.35);">Turn off time code</button>
                <button id="dtCancel" style="${BTN_SECONDARY}">Cancel</button>
            </div>`;
        document.body.appendChild(overlay);

        const errBox = $('dtError');
        const showErr = (m) => { errBox.style.display = 'block'; errBox.textContent = m; };
        const clearErr = () => { errBox.style.display = 'none'; errBox.textContent = ''; };

        // Determine whether the user has a password by calling checkLogin
        (async () => {
            try {
                const res = await postJson({ secret: SHEET_WEBHOOK_SECRET, type: 'checkLogin', phone: phone });
                const hasPassword = !!(res && res.hasPassword);
                if (hasPassword) {
                    $('dtHasPassword').style.display = 'block';
                    $('dtNoPassword').style.display = 'none';
                } else {
                    $('dtHasPassword').style.display = 'none';
                    $('dtNoPassword').style.display = 'block';
                    setTimeout(() => $('dtNewPassword')?.focus(), 100);
                }
            } catch (e) {
                $('dtHasPassword').style.display = 'block';
            }
        })();

        $('dtCancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        $('dtConfirm').addEventListener('click', async () => {
            clearErr();
            const btn = $('dtConfirm');
            btn.disabled = true; btn.textContent = 'Disabling…';

            const payload = {
                secret: SHEET_WEBHOOK_SECRET, type: 'disableTotp',
                phone: phone, token: getDeviceToken()
            };
            const hasPwEl = $('dtPassword');
            const newPwEl = $('dtNewPassword');
            if (hasPwEl && hasPwEl.offsetParent !== null) payload.password = hasPwEl.value;
            if (newPwEl && newPwEl.offsetParent !== null) payload.newPassword = newPwEl.value;

            try {
                const res = await postJson(payload);
                if (!res || !res.ok) {
                    showErr((res && res.message) || 'Could not disable.');
                    btn.disabled = false; btn.textContent = 'Turn off time code';
                    return;
                }
                toast('✅ Time code is now off.');
                overlay.remove();
            } catch (e) {
                showErr('Network error.');
                btn.disabled = false; btn.textContent = 'Turn off time code';
            }
        });
    }

    // ────────────────────────────────────────────────────────────
    // 17. LOGOUT ALL DEVICES
    // ────────────────────────────────────────────────────────────
    async function confirmLogoutAllDevices() {
        const phone = localStorage.getItem('premCallNumber');
        if (!phone) return;

        if (!confirm('Log out of every device (including this one)?\n\nYou will need to sign in again.')) return;

        try {
            const res = await postJson({
                secret: SHEET_WEBHOOK_SECRET, type: 'logoutAllDevices',
                phone: phone, token: getDeviceToken()
            });
            if (res && res.ok) {
                toast('✅ Logged out of ' + (res.removed || 0) + ' device(s).');
                try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
                setTimeout(() => location.reload(), 1200);
            } else {
                toast('⚠️ ' + ((res && res.message) || 'Could not log out.'));
            }
        } catch (e) {
            toast('Network error.');
        }
    }

    window.showLiveTokenCard = showLiveTokenCard;
    window.showChangeOffsetDialog = showChangeOffsetDialog;
    window.showDisableTotpDialog = showDisableTotpDialog;

    // ────────────────────────────────────────────────────────────
    // 18. SETTINGS
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
        return `<span><i class="fas ${icon}"></i> ${label}</span>
            <label class="toggle-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} /><span class="toggle-slider"></span></label>`;
    }

    function injectSettingsButtons() {
        const section = document.querySelector('.settings-section');
        if (!section) return;
        const logoutBtn = section.querySelector('.logout-btn');
        if (!logoutBtn) return;

        addSettingRow(section, logoutBtn, `<span><i class="fas fa-user-group"></i> Invite friends</span><button class="reg-btn" id="inviteFriendsBtn"><i class="fas fa-share-nodes"></i></button>`, 'inviteFriendsBtn')
            ?.querySelector('#inviteFriendsBtn').addEventListener('click', shareInviteOpen);

        addSettingRow(section, logoutBtn, `<span><i class="fas fa-sync-alt"></i> Refresh connection</span><button class="reg-btn" id="refreshConnectionBtn"><i class="fas fa-rotate-right"></i></button>`, 'refreshConnectionBtn')
            ?.querySelector('#refreshConnectionBtn').addEventListener('click', window.refreshConnection);

        // Live token
        addSettingRow(section, logoutBtn, `
            <span><i class="fas fa-key"></i> My live token</span>
            <button class="reg-btn" id="liveTokenBtn" title="Show my current code">
                <i class="fas fa-eye"></i>
            </button>`, 'liveTokenBtn')
            ?.querySelector('#liveTokenBtn').addEventListener('click', showLiveTokenCard);

        // Change offset
        addSettingRow(section, logoutBtn, `
            <span><i class="fas fa-sliders"></i> Change my offset</span>
            <button class="reg-btn" id="changeOffsetBtn" title="Adjust your secret offset">
                <i class="fas fa-pen"></i>
            </button>`, 'changeOffsetBtn')
            ?.querySelector('#changeOffsetBtn').addEventListener('click', () => {
                const phone = localStorage.getItem('premCallNumber');
                if (!phone) return toast('Sign in first');
                showChangeOffsetDialog(phone);
            });

        // Log out all devices
        addSettingRow(section, logoutBtn, `
            <span><i class="fas fa-right-from-bracket"></i> Log out all devices</span>
            <button class="reg-btn" id="logoutAllBtn" title="Sign out everywhere">
                <i class="fas fa-power-off"></i>
            </button>`, 'logoutAllBtn')
            ?.querySelector('#logoutAllBtn').addEventListener('click', confirmLogoutAllDevices);

        const getConsent = () => (window.RaginaMemory && window.RaginaMemory.getConsent()) || {};
        const setConsent = (patch) => {
            const c = Object.assign({}, getConsent(), patch, { at: Date.now() });
            if (window.RaginaMemory) window.RaginaMemory.setConsent(c);
        };

        addSettingRow(section, logoutBtn, toggleHtml('fa-brain', 'RAGina memory', 'raginaMemoryToggle', getConsent().memory), 'raginaMemoryToggle')
            ?.querySelector('#raginaMemoryToggle').addEventListener('change', function () {
                setConsent({ memory: this.checked });
                toast(this.checked ? '🧠 Memory on' : '🧠 Memory off');
            });

        addSettingRow(section, logoutBtn, toggleHtml('fa-comments', 'Use chats as context', 'raginaChatContextToggle', getConsent().chats), 'raginaChatContextToggle')
            ?.querySelector('#raginaChatContextToggle').addEventListener('change', function () {
                setConsent({ chats: this.checked });
                toast(this.checked ? '💬 Chat context on' : '💬 Chat context off');
            });

        const saved = localStorage.getItem('debugConsoleVisible');
        const visible = saved === null ? true : saved === 'true';
        const debugRow = addSettingRow(section, logoutBtn, toggleHtml('fa-terminal', 'Debug console', 'debugConsoleToggle', visible), 'debugConsoleToggle');
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
                toast(v ? '🐞 Debug shown' : '🐞 Debug hidden');
            });
        }

        addSettingRow(section, logoutBtn, `<span style="color:#ef4444;"><i class="fas fa-trash-alt"></i> Delete account</span><button class="reg-btn" id="deleteAccountBtn" style="border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.12);color:#ef4444;"><i class="fas fa-trash-alt"></i></button>`, 'deleteAccountBtn')
            ?.querySelector('#deleteAccountBtn').addEventListener('click', showDeleteAccountDialog);
    }

    // ────────────────────────────────────────────────────────────
    // 19. CONSOLE COPY
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
            if (!text) return toast('Console empty');
            try {
                if (navigator.clipboard) await navigator.clipboard.writeText(text);
                else {
                    const ta = document.createElement('textarea');
                    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                }
                copyBtn.textContent = '✅ Copied';
                setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
                toast('📋 Copied');
            } catch (e) { toast('Copy failed'); }
        });
        actions.insertBefore(copyBtn, clearBtn);
    }

    // ────────────────────────────────────────────────────────────
    // 20. AUTO-LOAD raginaMemory.js
    // ────────────────────────────────────────────────────────────
    (function loadRaginaMemory() {
        if (document.querySelector('script[src*="raginaMemory.js"]')) return;
        const s = document.createElement('script');
        s.src = 'js/raginaMemory.js';
        s.onload = () => console.log('✅ raginaMemory.js loaded');
        s.onerror = () => console.warn('⚠️ raginaMemory.js failed');
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
    // 21. DELETE ACCOUNT
    // ────────────────────────────────────────────────────────────
    function showDeleteAccountDialog() {
        $('deleteAccountDialog')?.remove();
        const phone = localStorage.getItem('premCallNumber') || '';
        const userData = JSON.parse(localStorage.getItem('neonUser') || '{}');
        const userName = userData.name || 'friend';

        const overlay = document.createElement('div');
        overlay.id = 'deleteAccountDialog';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(8,6,20,0.94);backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;color:#eef0f5;';
        overlay.innerHTML = `
            <div style="max-width:400px;width:100%;background:rgba(18,16,36,0.98);border:1px solid rgba(239,68,68,0.25);border-radius:24px;padding:28px 24px 22px;box-shadow:0 40px 100px rgba(0,0,0,0.8);">
                <div style="text-align:center;margin-bottom:18px;">
                    <div style="font-size:2.4rem;margin-bottom:8px;">⚠️</div>
                    <div style="font-size:1.2rem;font-weight:700;color:#ef4444;">Delete your account?</div>
                    <div style="font-size:0.8rem;color:#7a89a8;margin-top:10px;line-height:1.7;text-align:left;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:14px;padding:14px 16px;">
                        • Account &amp; profile<br>• Call history<br>• Conversations<br>• Push tokens<br>• Sessions<br>• Local data
                    </div>
                    <div style="font-size:0.78rem;color:#a5b3d0;margin-top:12px;"><b style="color:#ef4444;">Cannot be undone.</b></div>
                </div>
                <div style="margin-bottom:14px;">
                    <label style="${LBL}">Type your phone number</label>
                    <input id="deleteConfirmPhone" type="tel" inputmode="numeric" maxlength="10" placeholder="${escapeHtml(phone.slice(0, 2) + '*'.repeat(Math.max(0, phone.length - 2)))}" style="${INP}border-color:rgba(239,68,68,0.2);letter-spacing:2px;text-align:center;" />
                </div>
                <div id="deleteError" style="display:none;font-size:0.78rem;color:#ef4444;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:10px 12px;margin-bottom:12px;"></div>
                <button id="deleteAccountConfirm" style="width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;font-family:inherit;opacity:0.4;pointer-events:none;transition:opacity 0.2s;">Permanently delete</button>
                <button id="deleteAccountCancel" style="${BTN_SECONDARY}">Cancel</button>
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
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim() === phone) confirmBtn.click(); });
        $('deleteAccountCancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        confirmBtn.addEventListener('click', async () => {
            if (input.value.trim() !== phone) return;
            const errEl = $('deleteError');
            const showErr = (m) => { errEl.style.display = 'block'; errEl.textContent = m; };
            errEl.style.display = 'none';
            const uid = getAuthUid();
            if (!uid) { showErr('Cannot verify device. Refresh and try again.'); return; }

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Deleting…';
            let serverRes;
            try {
                serverRes = await postJson({ type: 'deleteAccount', secret: SHEET_WEBHOOK_SECRET, phone: phone, uid: uid });
            } catch (e) { confirmBtn.disabled = false; confirmBtn.textContent = 'Permanently delete'; return showErr('Could not reach server.'); }
            if (!serverRes || serverRes.ok !== true) { confirmBtn.disabled = false; confirmBtn.textContent = 'Permanently delete'; return showErr((serverRes && (serverRes.message || serverRes.error)) || 'Server rejected.'); }

            try { if (window.db && phone) await window.db.collection('profiles').doc(phone).delete(); } catch (e) {}
            try { if (window.auth && window.auth.currentUser) await window.auth.signOut(); } catch (e) {}
            try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
            try { if (window.indexedDB) indexedDB.deleteDatabase('sandesaiMedia'); } catch (e) {}

            overlay.remove();
            toast('✅ Account deleted');
            setTimeout(() => location.reload(), 1500);
        });
    }

    window.showDeleteAccountDialog = showDeleteAccountDialog;

    // ────────────────────────────────────────────────────────────
    // 22. RECOVERY MODAL
    // ────────────────────────────────────────────────────────────
    function showRecoveryModal(phone, method) {
        $('recoveryModal')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'recoveryModal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100200;background:rgba(8,6,20,0.96);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;color:#eef0f5;';
        const isPassword = method === 'password';

        overlay.innerHTML = `
            <div style="max-width:400px;width:100%;background:rgba(18,16,36,0.98);border:1px solid rgba(139,92,246,.25);border-radius:24px;padding:28px 24px 22px;box-shadow:0 40px 100px rgba(0,0,0,.8);">
                <div style="text-align:center;margin-bottom:20px;">
                    <div style="font-size:2.2rem;margin-bottom:8px;">${isPassword ? '🔑' : '🕐'}</div>
                    <div style="font-size:1.15rem;font-weight:700;">${isPassword ? 'Reset password' : 'Recover your code'}</div>
                    <div style="font-size:0.83rem;color:#7a89a8;margin-top:6px;line-height:1.5;">
                        ${isPassword
                            ? "We'll email a 6-digit reset code to your registered address."
                            : "We'll resend your welcome email with your secret time offset."}
                    </div>
                </div>
                <div style="background:rgba(110,231,255,.06);border:1px solid rgba(110,231,255,.18);border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:0.78rem;color:#a5b3d0;line-height:1.5;">
                    <b style="color:#6ee7ff;">Sending to:</b> +91 ${escapeHtml(phone)}
                </div>
                ${isPassword ? `
                    <div id="recoveryStep1"><button id="recoverySendCode" style="${BTN_PRIMARY}">Send reset code</button></div>
                    <div id="recoveryStep2" style="display:none;">
                        <div style="margin-bottom:12px;">
                            <label style="${LBL}">Reset code (6 digits)</label>
                            <input id="recoveryCode" type="text" maxlength="6" inputmode="numeric" placeholder="123456" style="${INP}letter-spacing:6px;text-align:center;font-family:monospace;" />
                        </div>
                        <div style="margin-bottom:14px;">
                            <label style="${LBL}">New password</label>
                            <input id="recoveryNewPassword" type="password" placeholder="At least 6 characters" autocomplete="new-password" style="${INP}" />
                        </div>
                        <button id="recoverySubmit" style="${BTN_PRIMARY}">Set new password</button>
                    </div>` : `
                    <button id="recoveryResend" style="${BTN_PRIMARY}">Resend welcome email</button>`}
                <div id="recoveryStatus" style="display:none;font-size:0.78rem;color:#2fd992;background:rgba(47,217,146,.08);border:1px solid rgba(47,217,146,.2);border-radius:12px;padding:10px 12px;margin-top:14px;line-height:1.5;"></div>
                <div id="recoveryError" style="display:none;font-size:0.78rem;color:#ef4444;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:12px;padding:10px 12px;margin-top:14px;line-height:1.5;"></div>
                <button id="recoveryClose" style="${BTN_SECONDARY}">Cancel</button>
            </div>`;
        document.body.appendChild(overlay);

        const statusBox = $('recoveryStatus');
        const errorBox = $('recoveryError');
        const setStatus = (m) => { statusBox.style.display = 'block'; statusBox.textContent = m; };
        const showErr = (m) => { errorBox.style.display = 'block'; errorBox.textContent = m; };
        const clearErr = () => { errorBox.style.display = 'none'; errorBox.textContent = ''; };

        $('recoveryClose').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        if (!isPassword) {
            $('recoveryResend').addEventListener('click', async () => {
                clearErr();
                const btn = $('recoveryResend');
                btn.disabled = true; btn.textContent = 'Sending…';
                try {
                    const res = await postJson({ secret: SHEET_WEBHOOK_SECRET, type: 'resendWelcome', phone: phone });
                    if (res && res.ok) { setStatus('✅ Email sent to ' + res.sentTo + '. Check your inbox and spam folder.'); btn.textContent = 'Resend again'; }
                    else { showErr((res && res.message) || 'Could not resend.'); btn.textContent = 'Resend welcome email'; }
                } catch (e) { showErr('Network error.'); btn.textContent = 'Resend welcome email'; }
                btn.disabled = false;
            });
        }

        if (isPassword) {
            $('recoverySendCode').addEventListener('click', async () => {
                clearErr();
                const btn = $('recoverySendCode');
                btn.disabled = true; btn.textContent = 'Sending…';
                try {
                    const res = await postJson({ secret: SHEET_WEBHOOK_SECRET, type: 'requestPasswordReset', phone: phone });
                    if (res && res.ok) {
                        setStatus('✅ Reset code sent to ' + res.sentTo + '. Check your inbox.');
                        $('recoveryStep1').style.display = 'none';
                        $('recoveryStep2').style.display = 'block';
                        setTimeout(() => $('recoveryCode').focus(), 100);
                    } else {
                        showErr((res && res.message) || 'Could not send reset code.');
                        btn.disabled = false; btn.textContent = 'Send reset code';
                    }
                } catch (e) { showErr('Network error.'); btn.disabled = false; btn.textContent = 'Send reset code'; }
            });

            $('recoverySubmit').addEventListener('click', async () => {
                clearErr();
                const code = $('recoveryCode').value.trim();
                const newPassword = $('recoveryNewPassword').value;
                if (!/^\d{6}$/.test(code)) return showErr('Enter the 6-digit code.');
                if (newPassword.length < 6) return showErr('Password must be at least 6 characters.');

                const btn = $('recoverySubmit');
                btn.disabled = true; btn.textContent = 'Updating…';
                try {
                    const res = await postJson({
                        secret: SHEET_WEBHOOK_SECRET, type: 'resetPassword',
                        phone: phone, code: code, newPassword: newPassword
                    });
                    if (res && res.ok) {
                        setStatus('✅ Password updated. You can now sign in.');
                        setTimeout(() => {
                            overlay.remove();
                            toast('🔑 Password updated.');
                        }, 1500);
                    } else {
                        showErr((res && res.message) || 'Could not reset password.');
                        btn.disabled = false; btn.textContent = 'Set new password';
                    }
                } catch (e) { showErr('Network error.'); btn.disabled = false; btn.textContent = 'Set new password'; }
            });
        }

        setTimeout(() => {
            if (isPassword) $('recoverySendCode')?.focus();
            else $('recoveryResend')?.focus();
        }, 200);
    }

    window.showRecoveryModal = showRecoveryModal;

    // ────────────────────────────────────────────────────────────
    // 23. TOTP UNLOCK MODAL (when locked)
    // ────────────────────────────────────────────────────────────
    function showTotpUnlockModal(phone, opts) {
        $('totpUnlockModal')?.remove();
        opts = opts || {};
        const hasPassword = !!opts.hasPassword;

        const overlay = document.createElement('div');
        overlay.id = 'totpUnlockModal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100600;background:rgba(8,6,20,0.96);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;color:#eef0f5;';
        overlay.innerHTML = `
            <div style="max-width:400px;width:100%;background:rgba(18,16,36,0.98);border:1px solid rgba(239,68,68,.25);border-radius:24px;padding:28px 24px 22px;box-shadow:0 40px 100px rgba(0,0,0,.8);">
                <div style="text-align:center;margin-bottom:20px;">
                    <div style="font-size:2.2rem;margin-bottom:8px;">🔒</div>
                    <div style="font-size:1.15rem;font-weight:700;color:#ef4444;">Too many wrong codes</div>
                    <div style="font-size:0.83rem;color:#a5b3d0;margin-top:6px;line-height:1.5;">
                        Your time code is locked. Unlock it via email or sign in with your password.
                    </div>
                </div>

                <div id="unlockStep1">
                    <button id="unlockRequest" style="${BTN_PRIMARY}">Email me an unlock code</button>
                </div>

                <div id="unlockStep2" style="display:none;">
                    <div style="margin-bottom:12px;">
                        <label style="${LBL}">Unlock code (6 digits)</label>
                        <input id="unlockCode" type="text" maxlength="6" inputmode="numeric" placeholder="123456" style="${INP}letter-spacing:6px;text-align:center;font-family:monospace;" />
                    </div>
                    <button id="unlockSubmit" style="${BTN_PRIMARY}">Unlock</button>
                </div>

                ${hasPassword ? `
                    <button id="unlockUsePassword" style="${BTN_SECONDARY}">Use my password instead</button>
                ` : ''}

                <div id="unlockStatus" style="display:none;font-size:0.78rem;color:#2fd992;background:rgba(47,217,146,.08);border:1px solid rgba(47,217,146,.2);border-radius:12px;padding:10px 12px;margin-top:14px;line-height:1.5;"></div>
                <div id="unlockError" style="display:none;font-size:0.78rem;color:#ef4444;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:12px;padding:10px 12px;margin-top:14px;line-height:1.5;"></div>

                <button id="unlockCancel" style="${BTN_SECONDARY}">Cancel</button>
            </div>`;
        document.body.appendChild(overlay);

        const statusBox = $('unlockStatus');
        const errorBox = $('unlockError');
        const setStatus = (m) => { statusBox.style.display = 'block'; statusBox.textContent = m; };
        const showErr = (m) => { errorBox.style.display = 'block'; errorBox.textContent = m; };
        const clearErr = () => { errorBox.style.display = 'none'; errorBox.textContent = ''; };

        $('unlockCancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        $('unlockRequest').addEventListener('click', async () => {
            clearErr();
            const btn = $('unlockRequest');
            btn.disabled = true; btn.textContent = 'Sending…';
            try {
                const res = await postJson({ secret: SHEET_WEBHOOK_SECRET, type: 'requestTotpUnlock', phone: phone });
                if (res && res.ok) {
                    setStatus('✅ Code sent to ' + res.sentTo);
                    $('unlockStep1').style.display = 'none';
                    $('unlockStep2').style.display = 'block';
                    setTimeout(() => $('unlockCode')?.focus(), 100);
                } else {
                    showErr((res && res.message) || 'Could not send unlock code.');
                    btn.disabled = false; btn.textContent = 'Email me an unlock code';
                }
            } catch (e) { showErr('Network error.'); btn.disabled = false; btn.textContent = 'Email me an unlock code'; }
        });

        $('unlockSubmit').addEventListener('click', async () => {
            clearErr();
            const code = $('unlockCode').value.trim();
            if (!/^\d{6}$/.test(code)) return showErr('Enter the 6-digit code.');
            const btn = $('unlockSubmit');
            btn.disabled = true; btn.textContent = 'Unlocking…';
            try {
                const res = await postJson({ secret: SHEET_WEBHOOK_SECRET, type: 'unlockTotp', phone: phone, code: code });
                if (res && res.ok) {
                    setStatus('✅ Unlocked. You can try signing in again.');
                    setTimeout(() => overlay.remove(), 1500);
                } else {
                    showErr((res && res.message) || 'Invalid code.');
                    btn.disabled = false; btn.textContent = 'Unlock';
                }
            } catch (e) { showErr('Network error.'); btn.disabled = false; btn.textContent = 'Unlock'; }
        });

        if (hasPassword) {
            $('unlockUsePassword').addEventListener('click', () => {
                overlay.remove();
                if (typeof opts.onUsePassword === 'function') opts.onUsePassword();
            });
        }

        setTimeout(() => $('unlockRequest')?.focus(), 200);
    }

    window.showTotpUnlockModal = showTotpUnlockModal;

    // ────────────────────────────────────────────────────────────
    // 24. REGISTRATION SCREEN
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
        if ($('loginScreen')) return;

        const screen = document.createElement('div');
        screen.id = 'bootRegScreen';
        screen.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#07050e;overflow-y:auto;padding:32px 24px;font-family:Inter,sans-serif;color:#eef0f5;display:flex;flex-direction:column;align-items:center;';

        const bg = document.createElement('div');
        bg.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(circle at 20% 15%,rgba(139,92,246,0.20),transparent 55%),radial-gradient(circle at 80% 85%,rgba(110,231,255,0.15),transparent 55%);';
        screen.appendChild(bg);

        const card = document.createElement('div');
        card.style.cssText = 'max-width:420px;width:100%;margin:auto 0;background:rgba(18,16,36,0.88);backdrop-filter:blur(28px);border:1px solid rgba(255,255,255,0.07);border-radius:28px;padding:32px 26px 26px;box-shadow:0 40px 100px rgba(0,0,0,0.7);';

        card.innerHTML = `
            <div style="text-align:center;margin-bottom:22px;">
                <img src="sandesai-logo.png" alt="Sandesai" style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px;display:block;border:2px solid rgba(139,92,246,0.3);box-shadow:0 0 60px rgba(139,92,246,0.4);" />
                <div style="font-size:1.65rem;font-weight:700;background:linear-gradient(135deg,#a78bfa,#6ee7ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Sandesai</div>
                <div style="font-size:0.83rem;color:#7a89a8;margin-top:4px;">Sign up to get started</div>
            </div>

            <button id="bootRegGoogleBtn" type="button" style="width:100%;padding:13px 16px;border-radius:14px;border:1px solid rgba(255,255,255,0.1);background:#fff;color:#1f1f1f;font-weight:600;font-size:0.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:inherit;">
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 5.1 29.3 3 24 3 16 3 9.1 7.6 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 36.1 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-6.9l-6.6 5.1C9 41.4 16 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C41.6 35.4 45 30.2 45 24c0-1.2-.1-2.4-.4-3.5z"/></svg>
                Continue with Google
            </button>

            <div style="display:flex;align-items:center;gap:12px;margin:18px 0 14px;">
                <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
                <div style="font-size:0.7rem;color:#5a6885;letter-spacing:0.08em;text-transform:uppercase;">or sign up with</div>
                <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
            </div>

            <div style="display:flex;flex-direction:column;gap:12px;">
                <div>
                    <label style="${LBL}">Name</label>
                    <input id="bootRegName" type="text" placeholder="Your name" style="${INP}" />
                </div>
                <div>
                    <label style="${LBL}">Username</label>
                    <input id="bootRegUserid" type="text" placeholder="3–20 letters, numbers, _ or ." autocapitalize="none" style="${INP}" />
                    <div id="bootRegUserStatus" style="font-size:0.72rem;color:#7a89a8;margin-top:4px;min-height:1em;"></div>
                </div>
                <div>
                    <label style="${LBL}">Phone Number</label>
                    <input id="bootRegPhone" type="tel" placeholder="10-digit number" maxlength="10" inputmode="numeric" style="${INP}" />
                </div>
                <div>
                    <label style="${LBL}">Email</label>
                    <input id="bootRegEmail" type="email" placeholder="you@example.com" style="${INP}" />
                </div>
            </div>

            <div id="bootRegPasswordWrap" style="margin-top:14px;">
                <label style="${LBL}">Password <span style="text-transform:none;color:#5a6885;font-weight:400;">(optional)</span></label>
                <input id="bootRegPassword" type="password" placeholder="At least 6 characters" autocomplete="new-password" style="${INP}" />
                <div style="font-size:0.72rem;color:#5a6885;margin-top:6px;line-height:1.5;">
                    You'll also receive a time-based code by email. Set a password if you'd like an alternative way to sign in.
                </div>
            </div>

            <div id="bootRegError" style="display:none;font-size:0.78rem;color:#ef4444;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:10px 12px;margin-top:14px;"></div>

            <button id="bootRegSubmit" type="button" style="${BTN_PRIMARY}margin-top:20px;">Create account</button>
            <button id="bootRegLogin" type="button" style="${BTN_SECONDARY}">Already have an account? Sign in</button>

            <div style="margin-top:14px;text-align:center;font-size:0.7rem;color:#5a6885;line-height:1.5;">
                By registering you agree to Sandesai's terms<br />and privacy policy.
            </div>`;
        screen.appendChild(card);
        document.body.appendChild(screen);

        $('bootRegGoogleBtn').addEventListener('click', async () => {
            const btn = $('bootRegGoogleBtn');
            btn.disabled = true; btn.style.opacity = '0.7';
            btn.innerHTML = '<span style="color:#666;">Opening Google…</span>';
            const user = await signInWithGoogle();
            if (!user) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = 'Continue with Google'; return; }
            await startGoogleRegistrationFlow(user);
        });

        const useridInput = $('bootRegUserid');
        const userStatus = $('bootRegUserStatus');
        let timer = null;
        const setUserStatus = (t, c) => { userStatus.textContent = t; userStatus.style.color = c || '#7a89a8'; };
        useridInput.addEventListener('input', () => {
            const v = useridInput.value.trim();
            clearTimeout(timer);
            if (v.length < 3) return setUserStatus('');
            if (!USERNAME_RE.test(v)) return setUserStatus('Use 3–20 letters, numbers, _ or .', '#f59e0b');
            timer = setTimeout(async () => {
                const phoneVal = $('bootRegPhone').value.trim();
                const avail = await checkAvailability(v, PHONE_RE.test(phoneVal) ? phoneVal : '');
                if (avail && avail.usernameAvailable === false) setUserStatus('❌ Username taken', '#ef4444');
                else if (avail && avail.usernameAvailable === true) setUserStatus('✅ Available', '#2fd992');
                else setUserStatus('');
            }, 500);
        });

        $('bootRegLogin').addEventListener('click', () => {
            const phoneVal = $('bootRegPhone').value.trim();
            screen.remove();
            showLoginScreen(PHONE_RE.test(phoneVal) ? phoneVal : '');
        });

        const submitBtn = $('bootRegSubmit');
        const errBox = $('bootRegError');
        const showErr = (m) => { errBox.style.display = 'block'; errBox.textContent = m; };
        const clearErr = () => { errBox.style.display = 'none'; errBox.textContent = ''; };
        const resetSubmit = () => { submitBtn.disabled = false; submitBtn.style.opacity = '1'; submitBtn.textContent = 'Create account'; };
        const fail = (msg) => { showErr(msg); resetSubmit(); };

        submitBtn.addEventListener('click', async () => {
            clearErr();
            const name = $('bootRegName').value.trim();
            const userid = $('bootRegUserid').value.trim();
            const phone = $('bootRegPhone').value.trim();
            const email = $('bootRegEmail').value.trim();
            const password = $('bootRegPassword').value.trim();

            if (!name) return showErr('Please enter your name');
            if (!userid) return showErr('Please choose a username');
            if (!USERNAME_RE.test(userid)) return showErr('Username: 3–20 letters, numbers, _ or .');
            if (!PHONE_RE.test(phone)) return showErr('Enter a valid 10-digit Indian mobile (starts 6–9)');
            if (!EMAIL_RE.test(email)) return showErr('Please enter a valid email');
            if (password && password.length < 6) return showErr('Password must be at least 6 characters.');

            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.7';
            submitBtn.textContent = 'Checking…';

            const avail = await checkAvailability(userid, phone);
            if (avail && avail.ok === false) return fail(avail.message || 'Availability check failed');
            if (avail && avail.usernameAvailable === false) return fail('Username is already taken');
            if (avail && avail.phoneAvailable === false) return fail('This phone is already registered. Try signing in.');

            submitBtn.textContent = 'Creating…';

            const payload = {
                authMethod: password ? 'both' : 'totp',
                name: name, username: userid, phone: phone, email: email
            };
            if (password) payload.password = password;

            let regRes;
            try {
                regRes = await postJson({
                    secret: SHEET_WEBHOOK_SECRET, type: 'registration', provider: 'otp',
                    ...payload, uid: getAuthUid() || ''
                });
            } catch (e) { return fail('Network error. Please try again.'); }
            if (regRes && regRes.ok === false) return fail(regRes.message || regRes.error || 'Registration failed');

            const userData = { name, userid, phone, email, registered: true, status: 'online', provider: password ? 'both' : 'totp' };
            activateApp(userData);
            screen.remove();
            toast('✅ Welcome to Sandesai, ' + name + '!');
            setTimeout(() => toast('📧 Check your email for your live token'), 1200);
        });

        setTimeout(() => $('bootRegName')?.focus(), 400);
    }

    // ────────────────────────────────────────────────────────────
    // 25. LOGIN SCREEN
    // ────────────────────────────────────────────────────────────
    function showLoginScreen(prefillPhone) {
        $('loginScreen')?.remove();
        if ($('googlePhoneStep')) return;

        const screen = document.createElement('div');
        screen.id = 'loginScreen';
        screen.style.cssText = 'position:fixed;inset:0;z-index:100001;background:#07050e;overflow-y:auto;padding:32px 24px;font-family:Inter,sans-serif;color:#eef0f5;display:flex;flex-direction:column;align-items:center;';

        screen.innerHTML = `
            <div style="max-width:400px;width:100%;margin:auto 0;background:rgba(18,16,36,0.92);border:1px solid rgba(255,255,255,0.07);border-radius:28px;padding:32px 26px 26px;box-shadow:0 40px 100px rgba(0,0,0,0.7);">
                <div style="text-align:center;margin-bottom:22px;">
                    <img src="sandesai-logo.png" alt="Sandesai" style="width:72px;height:72px;border-radius:50%;margin:0 auto 12px;display:block;border:2px solid rgba(139,92,246,0.3);" />
                    <div style="font-size:1.5rem;font-weight:700;">Welcome back</div>
                    <div style="font-size:0.85rem;color:#7a89a8;margin-top:4px;">Sign in to your Sandesai account</div>
                </div>

                <div>
                    <label style="${LBL}">Phone Number</label>
                    <input id="loginPhone" type="tel" placeholder="10-digit number" maxlength="10" inputmode="numeric" value="${escapeHtml(prefillPhone || '')}" style="${INP}" />
                </div>

                <div id="loginStep2" style="display:none;margin-top:14px;">
                    <div id="loginMethodLabel" style="font-size:0.78rem;color:#a5b3d0;margin-bottom:12px;"></div>
                    <div id="loginMethodToggle" style="display:none;gap:8px;margin-bottom:14px;"></div>

                    <div id="loginTotpBlock" style="display:none;">
                        <label style="${LBL}">
                            Enter your code
                            <button id="loginInfoBtn" type="button" style="display:none;vertical-align:middle;margin-left:6px;width:18px;height:18px;border-radius:50%;border:1px solid rgba(139,92,246,0.4);background:rgba(139,92,246,0.12);color:#a78bfa;font-size:11px;font-weight:700;cursor:pointer;font-family:serif;line-height:1;padding:0;align-items:center;justify-content:center;">i</button>
                        </label>
                        <input id="loginTotpCode" type="text" placeholder="0000" maxlength="4" inputmode="numeric" style="${INP}letter-spacing:6px;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:1.4rem;" />
                        <div id="loginHintBox" style="display:none;margin-top:10px;font-size:0.78rem;color:#c4b5fd;background:rgba(139,92,246,0.10);border:1px solid rgba(139,92,246,0.25);border-radius:12px;padding:10px 12px;line-height:1.5;"></div>
                        <div style="text-align:right;margin-top:6px;">
                            <button id="loginForgotCode" type="button" style="background:none;border:none;color:#a78bfa;font-size:0.75rem;cursor:pointer;font-family:inherit;text-decoration:underline;padding:4px 0;">Forgot your code? Resend welcome email</button>
                        </div>
                    </div>

                    <div id="loginPasswordBlock" style="display:none;">
                        <label style="${LBL}">Password</label>
                        <input id="loginPassword" type="password" placeholder="Your password" autocomplete="current-password" style="${INP}" />
                        <div style="text-align:right;margin-top:6px;">
                            <button id="loginForgotPassword" type="button" style="background:none;border:none;color:#a78bfa;font-size:0.75rem;cursor:pointer;font-family:inherit;text-decoration:underline;padding:4px 0;">Forgot password?</button>
                        </div>
                    </div>
                </div>

                <div id="loginError" style="display:none;font-size:0.78rem;color:#ef4444;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:10px 12px;margin-top:14px;"></div>

                <button id="loginSubmit" type="button" style="${BTN_PRIMARY}margin-top:20px;">Continue</button>
                <button id="loginSwitch" type="button" style="${BTN_SECONDARY}">New to Sandesai? Create an account</button>
            </div>`;
        document.body.appendChild(screen);

        const phoneInput = $('loginPhone');
        const submitBtn = $('loginSubmit');
        const errBox = $('loginError');
        const step2 = $('loginStep2');
        const methodLabel = $('loginMethodLabel');
        const toggleRow = $('loginMethodToggle');
        const totpBlock = $('loginTotpBlock');
        const pwBlock = $('loginPasswordBlock');

        let userMethods = [];
        let userHint = '';
        let activeMethod = null;
        let userHasPassword = false;

        const showErr = (m) => { errBox.style.display = 'block'; errBox.textContent = m; };
        const clearErr = () => { errBox.style.display = 'none'; errBox.textContent = ''; };

        function updateLoginFields() {
            totpBlock.style.display = activeMethod === 'totp' ? 'block' : 'none';
            pwBlock.style.display = activeMethod === 'password' ? 'block' : 'none';
            if (activeMethod === 'totp') {
                const infoBtn = $('loginInfoBtn');
                const hintBox = $('loginHintBox');
                if (infoBtn) {
                    infoBtn.style.display = userHint ? 'inline-flex' : 'none';
                    infoBtn.onclick = (e) => {
                        e.preventDefault();
                        if (!userHint || !hintBox) return;
                        const showing = hintBox.style.display !== 'none';
                        if (showing) { hintBox.style.display = 'none'; infoBtn.style.opacity = '1'; }
                        else { hintBox.textContent = userHint; hintBox.style.display = 'block'; infoBtn.style.opacity = '0.6'; }
                    };
                }
                if (hintBox) hintBox.style.display = 'none';
                setTimeout(() => $('loginTotpCode')?.focus(), 100);
            } else {
                setTimeout(() => $('loginPassword')?.focus(), 100);
            }
        }

        $('loginSwitch').addEventListener('click', () => {
            screen.remove();
            showBootRegistrationScreen();
        });

        submitBtn.addEventListener('click', async () => {
            clearErr();

            if (!userMethods.length) {
                // STEP 1: lookup
                const phone = phoneInput.value.trim();
                if (!PHONE_RE.test(phone)) return showErr('Enter a valid 10-digit Indian mobile (starts 6–9)');
                submitBtn.disabled = true;
                submitBtn.textContent = 'Looking up…';

                let res;
                try {
                    res = await postJson({ secret: SHEET_WEBHOOK_SECRET, type: 'checkLogin', phone: phone });
                } catch (e) {
                    submitBtn.disabled = false; submitBtn.textContent = 'Continue';
                    return showErr('Network error.');
                }
                if (!res || !res.ok) {
                    submitBtn.disabled = false; submitBtn.textContent = 'Continue';
                    return showErr((res && res.message) || 'Could not find this number.');
                }

                // If TOTP is locked → show unlock modal
                if (res.totpLocked) {
                    submitBtn.disabled = false; submitBtn.textContent = 'Continue';
                    return showTotpUnlockModal(phone, {
                        hasPassword: !!res.hasPassword,
                        onUsePassword: () => {
                            // Reset and show password-only flow
                            userMethods = ['password'];
                            activeMethod = 'password';
                            userHint = '';
                            userHasPassword = true;
                            methodLabel.textContent = 'Hi ' + (res.name || 'there') + '! Sign in with your password.';
                            toggleRow.style.display = 'none';
                            updateLoginFields();
                            step2.style.display = 'block';
                            phoneInput.disabled = true;
                            submitBtn.textContent = 'Sign in';
                        }
                    });
                }

                userMethods = res.methods || ['totp'];
                userHint = res.hint || '';
                userHasPassword = !!res.hasPassword;
                methodLabel.textContent = 'Hi ' + (res.name || 'there') + '! Choose how to sign in.';
                activeMethod = userMethods[0];

                const showToggle = userMethods.indexOf('totp') !== -1 && userMethods.indexOf('password') !== -1;
                if (showToggle) {
                    toggleRow.style.display = 'flex';
                    toggleRow.innerHTML = userMethods.map(m =>
                        `<button data-method="${m}" type="button" style="flex:1;padding:10px;border-radius:12px;border:1.5px solid ${m === activeMethod ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'};background:${m === activeMethod ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.03)'};color:${m === activeMethod ? '#a78bfa' : '#a5b3d0'};font-weight:600;font-size:0.85rem;cursor:pointer;font-family:inherit;">${m === 'totp' ? '🕐 Time code' : '🔑 Password'}</button>`
                    ).join('');
                    toggleRow.querySelectorAll('button').forEach(btn => {
                        btn.addEventListener('click', () => {
                            activeMethod = btn.dataset.method;
                            toggleRow.querySelectorAll('button').forEach(b => {
                                const active = b.dataset.method === activeMethod;
                                b.style.borderColor = active ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)';
                                b.style.background = active ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.03)';
                                b.style.color = active ? '#a78bfa' : '#a5b3d0';
                            });
                            updateLoginFields();
                        });
                    });
                } else {
                    toggleRow.style.display = 'none';
                }

                updateLoginFields();
                step2.style.display = 'block';
                phoneInput.disabled = true;
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign in';
                return;
            }

            // STEP 2: verify
            submitBtn.disabled = true;
            submitBtn.textContent = 'Verifying…';
            const phone = phoneInput.value.trim();
            const payload = { secret: SHEET_WEBHOOK_SECRET, type: 'login', phone: phone, method: activeMethod, clientTime: Date.now() };

            if (activeMethod === 'totp') {
                const code = $('loginTotpCode').value.trim();
                if (!/^\d{4}$/.test(code)) {
                    submitBtn.disabled = false; submitBtn.textContent = 'Sign in';
                    return showErr('Code must be 4 digits.');
                }
                payload.code = code;
            } else {
                const pw = $('loginPassword').value;
                if (!pw) {
                    submitBtn.disabled = false; submitBtn.textContent = 'Sign in';
                    return showErr('Enter your password.');
                }
                payload.password = pw;
            }

            let res;
            try { res = await postJson(payload); }
            catch (e) {
                submitBtn.disabled = false; submitBtn.textContent = 'Sign in';
                return showErr('Network error.');
            }
            if (!res || !res.ok) {
                submitBtn.disabled = false; submitBtn.textContent = 'Sign in';
                if (res && res.error === 'totp_locked') {
                    return showTotpUnlockModal(phone, {
                        hasPassword: !!res.hasPassword,
                        onUsePassword: () => {
                            userMethods = ['password'];
                            activeMethod = 'password';
                            userHint = '';
                            methodLabel.textContent = 'Sign in with your password.';
                            toggleRow.style.display = 'none';
                            updateLoginFields();
                            submitBtn.textContent = 'Sign in';
                        }
                    });
                }
                if (res && res.error === 'wrong_code') return showErr('Wrong code. ' + ((res.triesLeft != null) ? res.triesLeft + ' tries left.' : ''));
                if (res && res.error === 'wrong_password') return showErr('Wrong password. Try again.');
                if (res && res.error === 'totp_disabled') {
                    return showErr('Time code is disabled. Use your password.');
                }
                return showErr((res && res.message) || 'Sign in failed.');
            }

            const u = res.user || {};
            const userData = { name: u.name, userid: u.username, phone: u.phone, email: u.email, registered: true, status: 'online', provider: activeMethod };
            activateApp(userData);
            screen.remove();
            toast('👋 Welcome back, ' + (u.name || 'friend') + '!');
        });

        phoneInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !userMethods.length) submitBtn.click(); });
        $('loginTotpCode')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
        $('loginPassword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });

        setTimeout(() => {
            $('loginForgotCode')?.addEventListener('click', () => {
                const phone = phoneInput.value.trim();
                if (!PHONE_RE.test(phone)) return showErr('Enter your phone number first.');
                showRecoveryModal(phone, 'totp');
            });
            $('loginForgotPassword')?.addEventListener('click', () => {
                const phone = phoneInput.value.trim();
                if (!PHONE_RE.test(phone)) return showErr('Enter your phone number first.');
                showRecoveryModal(phone, 'password');
            });
        }, 100);

        setTimeout(() => phoneInput.focus(), 400);
    }

    window.showLoginScreen = showLoginScreen;

    // ────────────────────────────────────────────────────────────
    // 26. BOOT GATE
    // ────────────────────────────────────────────────────────────
    function bootRegistrationGate() {
        if ($('inviteWelcomeOverlay')) return;
        if ($('googlePhoneStep')) return;
        if ($('loginScreen')) return;
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
    // 27. BOOT
    // ────────────────────────────────────────────────────────────
    async function onBoot() {
        if (typeof firebase !== 'undefined' && window.firebase && typeof window.firebase.auth === 'function') {
            try {
                const authInstance = window.firebase.auth();
                window.auth = authInstance;
                const result = await authInstance.getRedirectResult();
                if (result && result.user) {
                    console.log('🔵 Google redirect caught:', result.user.email);
                    setTimeout(() => startGoogleRegistrationFlow(result.user), 400);
                    return;
                }
            } catch (e) {}
        }

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

    console.log('✨ enhancements.js v19 loaded — TOTP lock, unlock, disable, logout-all');
})();