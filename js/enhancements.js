// ================================================================
// js/enhancements.js  (v10 – sessions + magic link)
//
// New in v10
//   • Registration/login sends a device session token after OTP
//     verification; on later boots the app checks that session
//     instead of asking for OTP again (until it expires/is revoked).
//   • "I already have an account" link on the boot screen — lets a
//     returning user on a NEW device type just their phone number;
//     OTP goes to the email already on file (masked), not one they
//     type — this closes the phone-takeover gap.
//   • Magic-link support: while waiting, the screen polls the
//     backend and auto-advances if the person tapped the email link
//     instead of typing the code.
//   • Settings: "Log out other devices".
// ================================================================
(function () {
    'use strict';

    const INVITE_SECRET = 'sandesai-invite-v1-2026';
    const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    const CFG = window.SANDESAI || {};
    const SHEET_WEBHOOK_URL = CFG.SHEET_API_URL ||
        'https://script.google.com/macros/s/AKfycbxUWIDfjJ7XebOq8WGpDVWyw1De5OBgEPjWYTZEOxW8Eem4eTw4tGOds8pekkHKUGg/exec';
    const SHEET_WEBHOOK_SECRET = CFG.SHEET_WEBHOOK_SECRET || 'sandesai-webhook-2026';

    if (!window.SANDESAI) console.warn('⚠️ window.SANDESAI missing — is config.js loaded BEFORE enhancements.js?');
    console.log('🔗 Backend URL:', SHEET_WEBHOOK_URL);

    const LOCAL_APP_VERSION = '0.5';
    const SESSION_PHONE_KEY = 'premCallNumber';
    const SESSION_TOKEN_KEY = 'sandesaiSessionToken';

    let bootHadInvite = false;
    let forceUpdateShown = false;

    // ────────────────────────────────────────────────────────────
    // 0. HELPERS
    // ────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const toast = (m) => { if (window.showToast) window.showToast(m); };
    const PHONE_RE = /^\d{10}$/;
    const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

    const LBL = 'font-size:0.72rem;color:#7a89a8;text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:6px;font-weight:500;';
    const INP = 'width:100%;padding:13px 16px;border-radius:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#eef0f5;font-size:16px;outline:none;font-family:inherit;';
    const BTN_PRIMARY = 'width:100%;padding:15px;border-radius:16px;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-weight:700;font-size:1rem;cursor:pointer;font-family:inherit;box-shadow:0 8px 24px rgba(139,92,246,0.35);';
    const BTN_OTP = 'padding:13px 18px;border-radius:14px;border:1px solid rgba(139,92,246,0.25);background:rgba(139,92,246,0.12);color:#a78bfa;font-weight:600;font-size:0.8rem;cursor:pointer;white-space:nowrap;font-family:inherit;';
    const BTN_LINK = 'background:none;border:none;color:#a78bfa;font-size:0.82rem;cursor:pointer;font-family:inherit;text-decoration:underline;padding:4px;';

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    window.escapeHtml = escapeHtml;

    function deviceLabel() {
        const ua = navigator.userAgent || '';
        const platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Mac/i.test(ua) ? 'Mac' : /Win/i.test(ua) ? 'Windows' : 'Web';
        return platform + ' · ' + (navigator.language || '');
    }

    async function fetchJson(url, timeoutMs) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs || 25000);
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            const text = await r.text();
            try { return JSON.parse(text); }
            catch (e) { throw new Error('Backend returned non-JSON (check deployment access = "Anyone")'); }
        } finally { clearTimeout(timer); }
    }

    // ────────────────────────────────────────────────────────────
    // 1. INVITE TOKEN HELPERS
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
            if (!d || !s || signPayload(d) !== s) return null;
            const payload = JSON.parse(decodeURIComponent(escape(atob(d))));
            if (!payload.exp || payload.exp < Date.now()) return null;
            return payload;
        } catch (e) { return null; }
    }
    function buildInviteURL(token) { return location.origin + location.pathname + '?join=' + encodeURIComponent(token); }
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
        banner.style.cssText = `position:fixed;inset:0;z-index:95000;background:rgba(8,6,20,0.96);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Inter',sans-serif;color:#eef0f5;`;
        banner.innerHTML = `
            <div style="max-width:360px;width:100%;text-align:center;background:rgba(18,16,36,0.96);border:1px solid rgba(139,92,246,0.3);border-radius:24px;padding:32px 24px;box-shadow:0 40px 100px rgba(0,0,0,0.8);">
                <div style="font-size:2.4rem;margin-bottom:12px;">🚀</div>
                <div style="font-size:1.2rem;font-weight:700;margin-bottom:10px;">Update required</div>
                <div style="font-size:0.85rem;color:#a5b3d0;line-height:1.5;margin-bottom:22px;">${escapeHtml(message || UPDATE_MSG_FALLBACK)}</div>
                <button id="forceUpdateBtn" style="${BTN_PRIMARY}padding:14px;">Refresh now</button>
            </div>`;
        document.body.appendChild(banner);
        $('forceUpdateBtn').addEventListener('click', () => location.reload());
    }
    const UPDATE_MSG_FALLBACK = 'A new version of Sandesai is available. Please refresh to continue.';

    async function checkForceUpdate() {
        try {
            const data = await fetchJson(SHEET_WEBHOOK_URL + '?type=health', 10000);
            if (!data.ok) return false;
            console.log('🩺 Backend', data.version, '| mail quota left:', data.mailQuotaRemaining);
            if (data.minAppVersion && versionLess(LOCAL_APP_VERSION, data.minAppVersion)) {
                showForceUpdateBanner(data.updateMessage);
                return true;
            }
        } catch (e) { console.warn('Force update / health check failed:', e.message || e); }
        return false;
    }

    // ────────────────────────────────────────────────────────────
    // 3. BACKEND CALLS
    // ────────────────────────────────────────────────────────────
    function waitForAuthUid(maxMs) {
        return new Promise((resolve) => {
            const start = Date.now();
            (function tick() {
                const u = window.auth && window.auth.currentUser;
                if (u && u.uid) return resolve(u.uid);
                if (Date.now() - start > maxMs) return resolve('');
                setTimeout(tick, 150);
            })();
        });
    }

    async function logRegistrationToSheet(name, username, phone, email) {
        if (!SHEET_WEBHOOK_URL) return;
        const uid = await waitForAuthUid(8000);
        let finalUsername = username || '';
        try {
            const stored = JSON.parse(localStorage.getItem('neonUser') || '{}');
            if (stored.userid) finalUsername = stored.userid;
        } catch (e) {}

        try {
            await fetch(SHEET_WEBHOOK_URL, {
                method: 'POST', mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ secret: SHEET_WEBHOOK_SECRET, name: name || '', username: finalUsername, phone: phone || '', email: email || '', uid: uid || '' }),
            });
            console.log('📊 Registration sent to Sheet. UID:', uid || '(none)');
        } catch (e) { console.warn('📊 Sheet notification failed:', e); }
    }
    window.logRegistrationToSheet = logRegistrationToSheet;

    async function checkAvailability(username, phone) {
        try {
            const data = await fetchJson(SHEET_WEBHOOK_URL + '?type=checkAvailability&username=' + encodeURIComponent(username || '') + '&phone=' + encodeURIComponent(phone || ''), 12000);
            if (data && data.ok === false) console.warn('Availability check rejected:', data);
            return data;
        } catch (e) { console.warn('Availability check failed:', e.message || e); return { ok: true, unchecked: true }; }
    }

    // NOTE: for a KNOWN phone the backend ignores the typed email and
    // uses the one on file — this is intentional (anti-takeover).
    async function sendOtpEmail(phone, email) {
        try {
            const data = await fetchJson(SHEET_WEBHOOK_URL + '?type=sendOtp&secret=' + encodeURIComponent(SHEET_WEBHOOK_SECRET) + '&phone=' + encodeURIComponent(phone) + '&email=' + encodeURIComponent(email));
            console.log('📧 sendOtp response:', data);
            if (!data.ok) {
                let msg = data.message || data.error || 'unknown error';
                if (data.error === 'forbidden' || data.users) msg = 'Backend is outdated — redeploy Code.gs as a NEW version.';
                return { ok: false, error: msg };
            }
            return { ok: true, sentTo: data.sentTo };
        } catch (e) {
            console.warn('sendOtp failed:', e);
            return { ok: false, error: e.name === 'AbortError' ? 'Request timed out' : (e.message || 'Network error') };
        }
    }

    async function verifyOtpEmail(phone, code) {
        try { return await fetchJson(SHEET_WEBHOOK_URL + '?type=checkOtp&phone=' + encodeURIComponent(phone) + '&code=' + encodeURIComponent(code)); }
        catch (e) { console.warn('verifyOtp failed:', e); return { ok: false, error: 'network', message: 'Could not verify. Check your connection.' }; }
    }

    async function checkVerifyStatus(phone) {
        try { return await fetchJson(SHEET_WEBHOOK_URL + '?type=checkVerifyStatus&phone=' + encodeURIComponent(phone), 8000); }
        catch (e) { return { ok: false }; }
    }

    // Poll for up to `maxMs` after an OTP was sent, in case the user taps
    // the emailed magic link instead of typing the code. Resolves true if
    // verified via the link.
    function pollForLinkVerification(phone, maxMs, onTick) {
        return new Promise((resolve) => {
            const start = Date.now();
            const iv = setInterval(async () => {
                if (Date.now() - start > maxMs) { clearInterval(iv); return resolve(false); }
                const res = await checkVerifyStatus(phone);
                if (res && res.verified) { clearInterval(iv); return resolve(true); }
                if (onTick) onTick();
            }, 3000);
        });
    }

    async function createSession(phone) {
        try {
            const r = await fetch(SHEET_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ type: 'createSession', secret: SHEET_WEBHOOK_SECRET, phone, device: deviceLabel() }),
            });
            const data = await r.json();
            if (data.ok && data.token) {
                localStorage.setItem(SESSION_TOKEN_KEY, data.token);
                console.log('🔑 Device session created, expires', new Date(data.expiresAt).toLocaleDateString());
            } else {
                console.warn('createSession failed:', data);
            }
            return data;
        } catch (e) { console.warn('createSession error:', e); return { ok: false }; }
    }

    async function checkSessionValid(phone, token) {
        if (!phone || !token) return false;
        try {
            const data = await fetchJson(SHEET_WEBHOOK_URL + '?type=checkSession&phone=' + encodeURIComponent(phone) + '&token=' + encodeURIComponent(token), 10000);
            return !!(data && data.ok);
        } catch (e) { return false; }
    }

    async function logoutOtherDevices(phone) {
        const token = localStorage.getItem(SESSION_TOKEN_KEY) || '';
        try {
            const r = await fetch(SHEET_WEBHOOK_URL, {
                method: 'POST', headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ type: 'logoutOtherSessions', secret: SHEET_WEBHOOK_SECRET, phone, keepToken: token }),
            });
            const data = await r.json();
            toast(data.ok ? `✅ Signed out ${data.removed} other device(s)` : 'Could not sign out other devices');
        } catch (e) { toast('Network error'); }
    }
    window.logoutOtherDevices = logoutOtherDevices;

    // ── Shared "Send OTP" wiring, now with link-polling status ──
    function otpFieldHtml(prefix) {
        return `
            <div style="display:flex;gap:8px;">
                <input id="${prefix}Otp" type="text" placeholder="Enter code" inputmode="numeric" maxlength="6"
                       autocomplete="one-time-code" style="${INP}flex:1;min-width:0;letter-spacing:2px;" />
                <button id="${prefix}SendOtp" type="button" style="${BTN_OTP}">Send OTP</button>
            </div>
            <div id="${prefix}OtpStatus" style="font-size:0.72rem;color:#7a89a8;margin-top:6px;min-height:1em;"></div>`;
    }

    function wireSendOtp(prefix, phoneId, emailId, onLinkVerified) {
        const btn = $(prefix + 'SendOtp');
        const status = $(prefix + 'OtpStatus');
        const setStatus = (text, color) => { if (status) { status.textContent = text; status.style.color = color || '#7a89a8'; } };

        btn.addEventListener('click', async () => {
            const phone = $(phoneId).value.trim();
            const email = $(emailId) ? $(emailId).value.trim() : '';

            if (!PHONE_RE.test(phone)) return toast('Please enter a valid 10-digit number');
            if ($(emailId) && !EMAIL_RE.test(email)) return toast('Please enter a valid email');

            btn.disabled = true; btn.textContent = 'Sending…'; setStatus('');

            const res = await sendOtpEmail(phone, email);
            if (!res.ok) {
                toast('Could not send OTP: ' + res.error);
                setStatus('❌ ' + res.error, '#ef4444');
                btn.disabled = false; btn.textContent = 'Send OTP';
                return;
            }

            toast('📧 Code sent to ' + (res.sentTo || email));
            setStatus('✅ Sent to ' + (res.sentTo || email) + '. Enter the code, or tap "Confirm my email" in that message.', '#2fd992');

            let cd = 60;
            btn.textContent = 'Resend (' + cd + 's)';
            const tick = setInterval(() => {
                cd--;
                if (cd <= 0) { clearInterval(tick); btn.disabled = false; btn.textContent = 'Send OTP'; }
                else btn.textContent = 'Resend (' + cd + 's)';
            }, 1000);

            if (onLinkVerified) {
                pollForLinkVerification(phone, 10 * 60 * 1000, () => setStatus('Waiting for confirmation…', '#7a89a8')).then((verified) => {
                    if (verified) { setStatus('✅ Confirmed via email link!', '#2fd992'); onLinkVerified(); }
                });
            }
        });
    }

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
            try { await navigator.share({ title: 'Sandesai Invite', text }); return; }
            catch (err) { if (err && err.name === 'AbortError') return; console.warn('navigator.share failed:', err); }
        }
        const isAndroid = /Android/i.test(navigator.userAgent);
        const smsHref = isAndroid ? `sms:${peer}?body=${encodeURIComponent(text)}` : `sms:${peer}&body=${encodeURIComponent(text)}`;
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
            try { await navigator.share({ title: 'Join Sandesai', text }); return; }
            catch (e) { if (e.name === 'AbortError') return; }
        }
        if (navigator.clipboard) { await navigator.clipboard.writeText(text); toast('📋 Invite copied to clipboard'); }
    }
    window.shareInviteForPeer = shareInviteForPeer;
    window.shareInviteOpen = shareInviteOpen;

    // ────────────────────────────────────────────────────────────
    // 5. SHARED REGISTRATION / LOGIN CORE
    // ────────────────────────────────────────────────────────────
    async function _finishRegistration(name, phone, preferredUserid, email) {
        const userid = preferredUserid || ((name.toLowerCase().replace(/\s+/g, '') || 'user') + '_' + Math.floor(1000 + Math.random() * 9000));

        const userData = { name, userid, phone, registered: true, status: 'online' };
        localStorage.setItem('neonUser', JSON.stringify(userData));
        localStorage.setItem(SESSION_PHONE_KEY, phone);
        localStorage.setItem('premCallVerified', 'true');
        localStorage.setItem('premCallRegisteredAt', String(Date.now()));

        // Device session — OTP won't be asked again on this device.
        await createSession(phone);

        if (window.PremCall) {
            try { window.PremCall.reinit ? window.PremCall.reinit(phone) : window.PremCall.init(phone); }
            catch (e) { console.warn('PremCall init failed:', e); }
        }
        if (!window.firebaseReady && typeof window.initFirebaseMessaging === 'function') window.initFirebaseMessaging();

        setTimeout(() => {
            if (window.db && phone) {
                window.db.collection('profiles').doc(phone).set({ phone, name, username: userid, updatedAt: Date.now() }, { merge: true }).catch(() => {});
            }
            if (typeof window.initCallSignaling === 'function') window.initCallSignaling();
            if (typeof window.initCallLogSync === 'function') window.initCallLogSync();
        }, 1200);

        logRegistrationToSheet(name, userid, phone, email);

        const mn = $('myNumberDisplay'); if (mn) mn.textContent = phone;
        const dot = $('headerStatusDot'); if (dot) dot.className = 'status-dot connecting';
        if (typeof window.updateStatusBadge === 'function') window.updateStatusBadge(userData);
        if (typeof window.renderProfileView === 'function') window.renderProfileView();
        const link = document.querySelector('.registration-link'); if (link) link.style.display = 'none';
    }

    // A RETURNING user logging in on a new/cleared device: same OTP flow,
    // but we don't re-run the full registration form — we just need name+
    // username, which we can fetch back... simplest: prompt is skipped and
    // we pull name/username from the backend via checkAvailability's
    // "phoneOwner"? (removed for privacy) — instead we ask the user once
    // more for name/username, pre-filling nothing. This keeps the backend
    // simple and avoids exposing another user's name to whoever has the
    // phone number.
    async function _finishLogin(phone, name, userid, email) {
        await _finishRegistration(name, phone, userid, email);
    }

    // ────────────────────────────────────────────────────────────
    // 6. INVITE WELCOME OVERLAY  (unchanged flow, shared OTP widget)
    // ────────────────────────────────────────────────────────────
    function showInviteWelcomeOverlay(payload) {
        $('inviteWelcomeOverlay')?.remove();
        const isTargeted = !!(payload.to && payload.to.length === 10);
        const subtitle = isTargeted ? 'Someone invited you to Sandesai'
            : (payload.name ? `<b style="color:#c4b5fd">${escapeHtml(payload.name)}</b> wants to chat with you.` : 'Join the conversation.');

        const overlay = document.createElement('div');
        overlay.id = 'inviteWelcomeOverlay';
        overlay.style.cssText = `position:fixed;inset:0;z-index:8000;background:rgba(8,6,20,0.94);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Inter',sans-serif;color:#eef0f5;overflow-y:auto;`;
        overlay.innerHTML = `
            <div style="max-width:380px;width:100%;background:rgba(18,16,36,0.96);border:1px solid rgba(255,255,255,0.06);border-radius:28px;padding:32px 24px;text-align:center;box-shadow:0 40px 80px rgba(0,0,0,0.7);margin:auto;">
                <img src="sandesai-logo.png" alt="Sandesai" style="width:64px;height:64px;border-radius:50%;margin-bottom:12px;" />
                <div style="font-size:1.3rem;font-weight:700;margin-bottom:4px;">You're invited to Sandesai</div>
                <div style="font-size:0.85rem;color:#7a89a8;margin-bottom:24px;">${subtitle}</div>
                <div style="display:flex;flex-direction:column;gap:14px;text-align:left;">
                    <div>
                        <label style="${LBL}">Your number</label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="padding:13px 14px;border-radius:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:#a5b3d0;font-size:1rem;font-weight:600;white-space:nowrap;">+91</span>
                            <input id="invitePhone" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit number"
                                   value="${escapeHtml(payload.to || '')}" autocomplete="tel-national" style="${INP}flex:1;min-width:0;letter-spacing:1px;" />
                        </div>
                    </div>
                    <div><label style="${LBL}">Email</label><input id="inviteEmail" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email" style="${INP}" /></div>
                    <div><label style="${LBL}">OTP</label>${otpFieldHtml('invite')}</div>
                    <div><label style="${LBL}">Your name</label><input id="inviteName" type="text" placeholder="e.g. Ananya" autocomplete="name" style="${INP}" /></div>
                </div>
                <button id="inviteJoinBtn" style="${BTN_PRIMARY}margin-top:20px;">🚀 Join &amp; open chat</button>
                <div style="margin-top:12px;font-size:0.7rem;color:#5a6885;">By joining you agree to the Sandesai terms.</div>
            </div>`;
        document.body.appendChild(overlay);

        wireSendOtp('invite', 'invitePhone', 'inviteEmail', () => { $('inviteOtp').value = '✓'; $('inviteOtp').disabled = true; });

        $('inviteJoinBtn').addEventListener('click', async () => {
            const name = $('inviteName').value.trim();
            const phone = $('invitePhone').value.trim();
            const email = $('inviteEmail').value.trim();
            const otp = $('inviteOtp').value.trim();

            if (!PHONE_RE.test(phone)) return toast('Please enter a valid 10-digit number');
            if (!EMAIL_RE.test(email)) return toast('Please enter a valid email');
            if (!name) return toast('Please enter your name');

            const joinBtn = $('inviteJoinBtn');
            const reset = () => { joinBtn.disabled = false; joinBtn.textContent = '🚀 Join & open chat'; };
            joinBtn.disabled = true; joinBtn.textContent = 'Verifying…';

            let verified = otp === '✓'; // already confirmed via magic link
            if (!verified) {
                if (!otp) { toast('Please enter the OTP'); return reset(); }
                const v = await verifyOtpEmail(phone, otp);
                verified = v.ok;
                if (!verified) { toast('⚠️ ' + (v.message || 'Invalid OTP')); return reset(); }
            }

            const isIntendedRecipient = !isTargeted || phone === payload.to;
            if (isIntendedRecipient) autoRegisterFromInvite(payload, name, phone, email, payload.from || payload.chat);
            else autoRegisterAsNewUser(name, phone, email);
        });

        setTimeout(() => $('invitePhone')?.focus(), 400);
    }

    async function autoRegisterFromInvite(payload, name, phone, email, openChatWith) {
        if (!phone) { toast('Missing phone number'); return; }
        await _finishRegistration(name, phone, null, email);
        $('inviteWelcomeOverlay')?.remove();
        showWelcomePopup(name);
        if (openChatWith) openChatWhenReady(openChatWith);
    }
    async function autoRegisterAsNewUser(name, phone, email) {
        if (!phone) return;
        await _finishRegistration(name, phone, null, email);
        $('inviteWelcomeOverlay')?.remove();
        showWrongInvitePopup(name);
        setTimeout(() => {
            if (typeof window.switchTab === 'function') window.switchTab('chat');
            if (typeof window.renderChatList === 'function') window.renderChatList();
        }, 400);
    }

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
    // 7. WELCOME / WRONG-INVITE POPUP (unchanged)
    // ────────────────────────────────────────────────────────────
    function showJoinWelcomePopup(name, variant) {
        $('welcomePopup')?.remove();
        if (!$('welcomePopupStyles')) {
            const s = document.createElement('style');
            s.id = 'welcomePopupStyles';
            s.textContent = `
                @keyframes wpopHeartBeat{0%,100%{transform:scale(1)}20%{transform:scale(1.25)}35%{transform:scale(1.08)}50%{transform:scale(1.28)}70%{transform:scale(1)}}
                @keyframes wpopGlowPulse{0%,100%{opacity:.45;transform:scale(.9)}50%{opacity:.95;transform:scale(1.15)}}
                @keyframes wpopArrowBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
                @keyframes wpopSparkle{0%{transform:translateY(0) scale(.5);opacity:0}25%{opacity:1}100%{transform:translateY(-38px) scale(1);opacity:0}}
                @keyframes wpopShimmer{0%{background-position:-200% center}100%{background-position:200% center}}
                .wpop-shimmer{background:linear-gradient(90deg,#a78bfa 0%,#fff 50%,#a78bfa 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:wpopShimmer 3s linear infinite;}`;
            document.head.appendChild(s);
        }
        const isWelcome = variant === 'welcome';
        const safeName = escapeHtml(name || 'friend');
        const heading = isWelcome ? `Welcome, ${safeName}!` : `Welcome aboard, ${safeName}!`;
        const bodyText = isWelcome
            ? `You're all set. Tap the <b style="color:#c4b5fd;">⋮ menu</b> at the top right anytime to invite friends, refresh your connection, or explore settings.`
            : `Heads up — that invite was created for a different number, so we didn't connect you with its sender. But you're all set. Enjoy Sandesai — start your own chats and invite friends anytime.`;
        const heartGlow = isWelcome ? 'rgba(236,72,153,0.55)' : 'rgba(110,231,255,0.5)';
        const logoGlow = isWelcome ? 'rgba(139,92,246,0.5)' : 'rgba(110,231,255,0.4)';

        const popup = document.createElement('div');
        popup.id = 'welcomePopup';
        popup.style.cssText = `position:fixed;inset:0;z-index:9000;background:rgba(8,6,20,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Inter',sans-serif;color:#eef0f5;opacity:0;transition:opacity 0.35s ease;`;
        popup.innerHTML = `
            <div style="max-width:340px;width:100%;background:rgba(18,16,36,0.96);border:1px solid rgba(255,255,255,0.07);border-radius:24px;padding:28px 24px 24px;text-align:center;box-shadow:0 40px 100px rgba(0,0,0,0.75);position:relative;overflow:hidden;">
                ${isWelcome ? `<div style="position:relative;height:30px;margin-bottom:2px;"><div style="position:absolute;top:0;right:4px;font-size:22px;line-height:1;animation:wpopArrowBounce 1.4s ease-in-out infinite;">☝️</div></div>` : ''}
                <div style="position:relative;width:132px;height:132px;margin:6px auto 10px;">
                    <div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,${logoGlow} 0%,transparent 72%);animation:wpopGlowPulse 1.8s ease-in-out infinite;filter:blur(10px);"></div>
                    <span style="position:absolute;left:-6px;top:24%;font-size:13px;color:#c4b5fd;animation:wpopSparkle 2.6s ease-in-out infinite;">✦</span>
                    <span style="position:absolute;right:-4px;bottom:30%;font-size:11px;color:#6ee7ff;animation:wpopSparkle 2.6s ease-in-out infinite;animation-delay:.8s;">✦</span>
                    <span style="position:absolute;left:18%;bottom:-2px;font-size:12px;color:#a78bfa;animation:wpopSparkle 2.6s ease-in-out infinite;animation-delay:1.6s;">✦</span>
                    <img src="sandesai-logo.png" alt="Sandesai" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:100px;height:100px;border-radius:50%;border:2px solid rgba(139,92,246,0.35);box-shadow:0 0 40px ${logoGlow},0 10px 30px rgba(0,0,0,0.55);object-fit:cover;" />
                    <div style="position:absolute;right:6px;bottom:6px;width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#ec4899,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:19px;line-height:1;border:2px solid rgba(18,16,36,0.95);box-shadow:0 4px 18px ${heartGlow};animation:wpopHeartBeat 1.5s ease-in-out infinite;">${isWelcome ? '💜' : '🤍'}</div>
                </div>
                <div class="wpop-shimmer" style="font-size:1.35rem;font-weight:700;margin-bottom:10px;">${heading}</div>
                <div style="font-size:0.85rem;color:#a5b3d0;line-height:1.55;margin-bottom:22px;">${bodyText}</div>
                <button id="welcomeGotItBtn" style="width:100%;padding:13px;border-radius:14px;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;font-family:inherit;box-shadow:0 8px 24px rgba(139,92,246,0.4);">Got it →</button>
            </div>`;
        document.body.appendChild(popup);
        requestAnimationFrame(() => { popup.style.opacity = '1'; });
        const dismiss = () => { popup.style.opacity = '0'; setTimeout(() => popup.remove(), 350); };
        $('welcomeGotItBtn').addEventListener('click', dismiss);
        setTimeout(() => { if (popup.parentNode) dismiss(); }, isWelcome ? 7500 : 9000);
    }
    function showWelcomePopup(name) { showJoinWelcomePopup(name, 'welcome'); }
    function showWrongInvitePopup(name) { showJoinWelcomePopup(name, 'wrong-invite'); }
    window.showJoinWelcomePopup = showJoinWelcomePopup;
    window.showWelcomePopup = showWelcomePopup;
    window.showWrongInvitePopup = showWrongInvitePopup;

    // ────────────────────────────────────────────────────────────
    // 8. INVITE URL HANDLER
    // ────────────────────────────────────────────────────────────
    async function handleInviteFromURL() {
        const params = new URLSearchParams(location.search);
        const token = params.get('join');
        if (!token) return;
        const payload = decodeInviteToken(token);
        if (!payload) { toast('⚠️ Invite link expired or invalid'); history.replaceState({}, '', location.pathname); return; }

        if (localStorage.getItem('premCallRegisteredAt')) {
            const myNum = localStorage.getItem(SESSION_PHONE_KEY);
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
    // 9. REFRESH CONNECTION
    // ────────────────────────────────────────────────────────────
    if (typeof window.refreshConnection !== 'function') {
        window.refreshConnection = async function () {
            const btn = $('refreshConnectionBtn');
            if (btn) btn.classList.add('spinning');
            toast('🔄 Reconnecting…');
            try {
                const storedNum = localStorage.getItem(SESSION_PHONE_KEY);
                const verified = localStorage.getItem('premCallVerified') === 'true';
                if (storedNum && verified && window.PremCall) {
                    window.PremCall.reinit ? window.PremCall.reinit(storedNum) : window.PremCall.init(storedNum);
                }
                if (!window.firebaseReady && typeof window.initFirebaseMessaging === 'function') window.initFirebaseMessaging();
                else {
                    if (typeof window.initCallSignaling === 'function') window.initCallSignaling();
                    if (typeof window.initCallLogSync === 'function') window.initCallLogSync();
                }
                if (typeof window.renderChatList === 'function') window.renderChatList();
                if (typeof window.renderCallList === 'function') window.renderCallList();
                setTimeout(() => { toast('✅ Connection refreshed'); if (btn) btn.classList.remove('spinning'); }, 900);
            } catch (e) {
                console.error('Refresh failed:', e);
                toast('Refresh failed: ' + e.message);
                if (btn) btn.classList.remove('spinning');
            }
        };
    }

    // ────────────────────────────────────────────────────────────
    // 10. CALL LOG SYNC / PROFILE LOOKUP  (unchanged)
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
            return (cached && cached.name) || phone;
        };
    }

    // ────────────────────────────────────────────────────────────
    // 11. INJECT INVITE BUTTON (unchanged)
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
    // 12. SETTINGS ROWS (adds "Log out other devices")
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
        return `<span><i class="fas ${icon}"></i> ${label}</span><label class="toggle-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} /><span class="toggle-slider"></span></label>`;
    }

    function injectSettingsButtons() {
        const section = document.querySelector('.settings-section');
        if (!section) return;
        const logoutBtn = section.querySelector('.logout-btn');
        if (!logoutBtn) return;

        addSettingRow(section, logoutBtn, `<span><i class="fas fa-user-group"></i> Invite friends</span><button class="reg-btn" id="inviteFriendsBtn" title="Share Sandesai"><i class="fas fa-share-nodes"></i></button>`, 'inviteFriendsBtn')
            ?.querySelector('#inviteFriendsBtn').addEventListener('click', shareInviteOpen);

        addSettingRow(section, logoutBtn, `<span><i class="fas fa-sync-alt"></i> Refresh connection</span><button class="reg-btn" id="refreshConnectionBtn" title="Reconnect to network"><i class="fas fa-rotate-right"></i></button>`, 'refreshConnectionBtn')
            ?.querySelector('#refreshConnectionBtn').addEventListener('click', window.refreshConnection);

        addSettingRow(section, logoutBtn, `<span><i class="fas fa-laptop-mobile"></i> Log out other devices</span><button class="reg-btn" id="logoutOtherDevicesBtn" title="Sign out everywhere else"><i class="fas fa-right-from-bracket"></i></button>`, 'logoutOtherDevicesBtn')
            ?.querySelector('#logoutOtherDevicesBtn').addEventListener('click', () => {
                const phone = localStorage.getItem(SESSION_PHONE_KEY);
                if (phone) logoutOtherDevices(phone);
            });

        const getConsent = () => (window.RaginaMemory && window.RaginaMemory.getConsent()) || {};
        const setConsent = (patch) => { if (window.RaginaMemory) window.RaginaMemory.setConsent(Object.assign({}, getConsent(), patch, { at: Date.now() })); };

        addSettingRow(section, logoutBtn, toggleHtml('fa-brain', 'RAGina memory', 'raginaMemoryToggle', getConsent().memory), 'raginaMemoryToggle')
            ?.querySelector('#raginaMemoryToggle').addEventListener('change', function () { setConsent({ memory: this.checked }); toast(this.checked ? '🧠 RAGina will remember' : '🧠 Memory off'); });

        addSettingRow(section, logoutBtn, toggleHtml('fa-comments', 'Use chats as context', 'raginaChatContextToggle', getConsent().chats), 'raginaChatContextToggle')
            ?.querySelector('#raginaChatContextToggle').addEventListener('change', function () { setConsent({ chats: this.checked }); toast(this.checked ? '💬 Chat context enabled' : '💬 Chat context off'); });

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
                if (!v) { const c = $('debugConsole'); if (c) c.style.transform = 'translateY(100%)'; if (debugFab) debugFab.innerHTML = '<i class="fas fa-terminal"></i>'; }
                toast(v ? '🐞 Debug button shown' : '🐞 Debug button hidden');
            });
        }

        addSettingRow(section, logoutBtn, `<span style="color:#ef4444;"><i class="fas fa-trash-alt" style="color:#ef4444;"></i> Delete account</span><button class="reg-btn" id="deleteAccountBtn" title="Delete my account" style="border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.12);color:#ef4444;"><i class="fas fa-trash-alt"></i></button>`, 'deleteAccountBtn')
            ?.querySelector('#deleteAccountBtn').addEventListener('click', showDeleteAccountDialog);
    }

    // ────────────────────────────────────────────────────────────
    // 13. DEBUG CONSOLE COPY BUTTON
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
                if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
                else { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
                copyBtn.textContent = '✅ Copied'; setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
                toast('📋 Console copied');
            } catch (e) { toast('Copy failed: ' + e.message); }
        });
        actions.insertBefore(copyBtn, clearBtn);
    }

    // ────────────────────────────────────────────────────────────
    // 14. AUTO-LOAD raginaMemory.js
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
    // 15. DELETE ACCOUNT FLOW (unchanged, clears session token too)
    // ────────────────────────────────────────────────────────────
    function showDeleteAccountDialog() {
        $('deleteAccountDialog')?.remove();
        const phone = localStorage.getItem(SESSION_PHONE_KEY) || '';
        const userData = JSON.parse(localStorage.getItem('neonUser') || '{}');
        const userName = userData.name || 'friend';

        const overlay = document.createElement('div');
        overlay.id = 'deleteAccountDialog';
        overlay.style.cssText = `position:fixed;inset:0;z-index:9600;background:rgba(8,6,20,0.94);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Inter',sans-serif;color:#eef0f5;`;
        overlay.innerHTML = `
            <div style="max-width:400px;width:100%;background:rgba(18,16,36,0.98);border:1px solid rgba(239,68,68,0.25);border-radius:24px;padding:28px 24px 22px;box-shadow:0 40px 100px rgba(0,0,0,0.8);">
                <div style="text-align:center;margin-bottom:18px;">
                    <div style="font-size:2.4rem;margin-bottom:8px;">⚠️</div>
                    <div style="font-size:1.2rem;font-weight:700;color:#ef4444;">Delete your account?</div>
                    <div style="font-size:0.85rem;color:#a5b3d0;margin-top:8px;line-height:1.55;">This will permanently delete:</div>
                    <div style="font-size:0.8rem;color:#7a89a8;margin-top:10px;line-height:1.7;text-align:left;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:14px;padding:14px 16px;">
                        • Your account &amp; profile<br>• All voice call history<br>• All concierge conversations<br>• All push notification tokens<br>• All device sessions<br>• Local data on this device
                    </div>
                    <div style="font-size:0.78rem;color:#a5b3d0;margin-top:12px;line-height:1.5;"><b style="color:#ef4444;">This cannot be undone.</b></div>
                </div>
                <div style="margin-bottom:14px;">
                    <label style="${LBL}">Type your phone number to confirm</label>
                    <input id="deleteConfirmPhone" type="tel" inputmode="numeric" maxlength="10"
                           placeholder="${escapeHtml(phone.slice(0, 2) + '*'.repeat(Math.max(0, phone.length - 2)))}"
                           style="${INP}border-color:rgba(239,68,68,0.2);letter-spacing:2px;text-align:center;" />
                </div>
                <button id="deleteAccountConfirm" style="width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;font-family:inherit;box-shadow:0 8px 24px rgba(239,68,68,0.4);opacity:0.4;pointer-events:none;transition:opacity 0.2s;">Permanently delete</button>
                <button id="deleteAccountCancel" style="width:100%;padding:11px;margin-top:8px;border-radius:14px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:#7a89a8;font-weight:500;font-size:0.85rem;cursor:pointer;font-family:inherit;">Cancel</button>
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
        input.addEventListener('input', checkMatch); checkMatch();
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim() === phone) confirmBtn.click(); });
        $('deleteAccountCancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        confirmBtn.addEventListener('click', async () => {
            if (input.value.trim() !== phone) return;
            overlay.remove();
            await performAccountDeletion(phone, userName);
        });
    }

    async function performAccountDeletion(phone, name) {
        $('deleteProgressOverlay')?.remove();
        const progress = document.createElement('div');
        progress.id = 'deleteProgressOverlay';
        progress.style.cssText = `position:fixed;inset:0;z-index:9700;background:rgba(8,6,20,0.96);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;font-family:'Inter',sans-serif;color:#a5b3d0;`;
        progress.innerHTML = `<div style="font-size:2rem;animation:spin 1s linear infinite;">⏳</div><div style="font-size:0.95rem;">Deleting your account…</div><div style="font-size:0.75rem;color:#5a6885;">This may take a few seconds</div><style>@keyframes spin{to{transform:rotate(360deg);}}</style>`;
        document.body.appendChild(progress);

        try {
            await fetch(SHEET_WEBHOOK_URL, {
                method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ type: 'deleteAccount', secret: SHEET_WEBHOOK_SECRET, phone, uid: (window.auth && window.auth.currentUser && window.auth.currentUser.uid) || '' }),
            });
        } catch (e) { console.warn('Backend deletion failed:', e); }

        try { if (window.db && phone) await window.db.collection('profiles').doc(phone).delete(); } catch (e) {}
        try { if (window.auth && window.auth.currentUser) await window.auth.signOut(); } catch (e) {}
        try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
        try { if (window.indexedDB && indexedDB.deleteDatabase) indexedDB.deleteDatabase('sandesaiMedia'); } catch (e) {}

        progress.innerHTML = `<div style="font-size:2.6rem;">✅</div><div style="font-size:1rem;color:#2fd992;font-weight:600;">Account deleted</div><div style="font-size:0.8rem;color:#7a89a8;text-align:center;max-width:280px;">${name ? 'Goodbye, ' + escapeHtml(name) + '.' : 'Goodbye.'} Thanks for using Sandesai.</div><div style="font-size:0.7rem;color:#5a6885;margin-top:8px;">Reloading…</div>`;
        setTimeout(() => location.reload(), 2200);
    }
    window.showDeleteAccountDialog = showDeleteAccountDialog;

    // ────────────────────────────────────────────────────────────
    // 16. BOOT REGISTRATION / LOGIN GATE
    // ────────────────────────────────────────────────────────────
    function isRegistered() {
        return !!localStorage.getItem('premCallRegisteredAt') && localStorage.getItem('premCallVerified') === 'true' && !!localStorage.getItem(SESSION_PHONE_KEY);
    }

    // "Already have an account?" sub-screen — phone only, OTP goes to
    // the email on file (server enforces this, ignores any email here).
    function showLoginScreen(nameInputForBack) {
        $('bootLoginScreen')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'bootLoginScreen';
        wrap.style.cssText = `position:fixed;inset:0;z-index:100010;background:#07050e;overflow-y:auto;padding:32px 24px;font-family:'Inter',sans-serif;color:#eef0f5;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;`;
        wrap.innerHTML = `
            <div style="max-width:400px;width:100%;margin:auto 0;background:rgba(18,16,36,0.88);backdrop-filter:blur(28px);border:1px solid rgba(255,255,255,0.07);border-radius:28px;padding:36px 28px 28px;">
                <div style="text-align:center;margin-bottom:24px;">
                    <div style="font-size:1.4rem;font-weight:700;">Log in</div>
                    <div style="font-size:0.85rem;color:#7a89a8;margin-top:6px;">We'll email a code to the address on file for this number.</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:14px;">
                    <div>
                        <label style="${LBL}">Phone Number</label>
                        <input id="loginPhone" type="tel" placeholder="10-digit number" maxlength="10" inputmode="numeric" autocomplete="tel-national" style="${INP}" />
                    </div>
                    <div>
                        <label style="${LBL}">OTP</label>
                        <div style="display:flex;gap:8px;">
                            <input id="loginOtp" type="text" placeholder="Enter code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="${INP}flex:1;min-width:0;letter-spacing:2px;" />
                            <button id="loginSendOtp" type="button" style="${BTN_OTP}">Send OTP</button>
                        </div>
                        <div id="loginOtpStatus" style="font-size:0.72rem;color:#7a89a8;margin-top:6px;min-height:1em;"></div>
                    </div>
                </div>
                <button id="loginSubmit" type="button" style="${BTN_PRIMARY}margin-top:22px;">Log in</button>
                <button id="loginBack" type="button" style="${BTN_LINK}display:block;margin:16px auto 0;">← Back to sign up</button>
            </div>`;
        document.body.appendChild(wrap);

        const btn = $('loginSendOtp');
        const status = $('loginOtpStatus');
        btn.addEventListener('click', async () => {
            const phone = $('loginPhone').value.trim();
            if (!PHONE_RE.test(phone)) return toast('Please enter a valid 10-digit number');
            btn.disabled = true; btn.textContent = 'Sending…';
            const res = await sendOtpEmail(phone, ''); // email ignored server-side for known phones
            if (!res.ok) {
                toast('Could not send OTP: ' + res.error);
                status.textContent = '❌ ' + res.error; status.style.color = '#ef4444';
                btn.disabled = false; btn.textContent = 'Send OTP';
                return;
            }
            toast('📧 Code sent to ' + res.sentTo);
            status.textContent = '✅ Sent to ' + res.sentTo; status.style.color = '#2fd992';
            let cd = 60;
            btn.textContent = 'Resend (' + cd + 's)';
            const tick = setInterval(() => { cd--; if (cd <= 0) { clearInterval(tick); btn.disabled = false; btn.textContent = 'Send OTP'; } else btn.textContent = 'Resend (' + cd + 's)'; }, 1000);
        });

        $('loginSubmit').addEventListener('click', async () => {
            const phone = $('loginPhone').value.trim();
            const otp = $('loginOtp').value.trim();
            if (!PHONE_RE.test(phone)) return toast('Please enter a valid 10-digit number');
            if (!otp) return toast('Please enter the OTP');

            const submitBtn = $('loginSubmit');
            submitBtn.disabled = true; submitBtn.textContent = 'Verifying…';

            const verify = await verifyOtpEmail(phone, otp);
            if (!verify.ok) {
                toast('⚠️ ' + (verify.message || 'Invalid OTP'));
                submitBtn.disabled = false; submitBtn.textContent = 'Log in';
                return;
            }

            // We still need a display name/username for this device's UI.
            // Ask once, minimally, without touching the server record.
            const name = prompt('Welcome back! What name should we show for you?') || 'User';
            await _finishLogin(phone, name, null, '');

            wrap.remove();
            toast('✅ Logged in');
            setTimeout(() => {
                if (typeof window.renderChatList === 'function') window.renderChatList();
                if (typeof window.renderCallList === 'function') window.renderCallList();
            }, 400);
        });

        $('loginBack').addEventListener('click', () => { wrap.remove(); });
        setTimeout(() => $('loginPhone')?.focus(), 300);
    }
    window.showLoginScreen = showLoginScreen;

    function showBootRegistrationScreen() {
        if ($('bootRegScreen')) return;
        if ($('inviteWelcomeOverlay')) return;

        if (!$('bootRegStyles')) {
            const style = document.createElement('style');
            style.id = 'bootRegStyles';
            style.textContent = `
                @keyframes bootCardIn { from { opacity:0; transform:translateY(24px) scale(0.98);} to { opacity:1; transform:translateY(0) scale(1);} }
                #bootRegScreen input:focus { border-color: rgba(139,92,246,0.5) !important; background: rgba(255,255,255,0.06) !important; }
                #bootRegScreen button:active { transform: scale(0.97); }`;
            document.head.appendChild(style);
        }

        const screen = document.createElement('div');
        screen.id = 'bootRegScreen';
        screen.style.cssText = `position:fixed;inset:0;z-index:100000;background:#07050e;overflow-y:auto;padding:32px 24px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#eef0f5;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;`;

        const bg = document.createElement('div');
        bg.style.cssText = `position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(circle at 20% 15%,rgba(139,92,246,0.20),transparent 55%),radial-gradient(circle at 80% 85%,rgba(110,231,255,0.15),transparent 55%),radial-gradient(circle at 50% 50%,rgba(124,58,237,0.08),transparent 70%);`;
        screen.appendChild(bg);

        const card = document.createElement('div');
        card.style.cssText = `max-width:400px;width:100%;margin:auto 0;background:rgba(18,16,36,0.88);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid rgba(255,255,255,0.07);border-radius:28px;padding:36px 28px 28px;box-shadow:0 40px 100px rgba(0,0,0,0.7);animation:bootCardIn 0.5s cubic-bezier(0.34,1.56,0.64,1);`;

        card.innerHTML = `
            <div style="text-align:center;margin-bottom:28px;">
                <img src="sandesai-logo.png" alt="Sandesai" style="width:88px;height:88px;border-radius:50%;margin:0 auto 14px;display:block;border:2px solid rgba(139,92,246,0.3);box-shadow:0 0 60px rgba(139,92,246,0.4),0 0 100px rgba(110,231,255,0.15);" />
                <div style="font-size:1.75rem;font-weight:700;letter-spacing:-0.02em;background:linear-gradient(135deg,#a78bfa,#6ee7ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">Sandesai</div>
                <div style="font-size:0.85rem;color:#7a89a8;margin-top:6px;">Sign up to get started</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:14px;">
                <div><label style="${LBL}">Name</label><input id="bootRegName" type="text" placeholder="Your name" autocomplete="name" style="${INP}" /></div>
                <div>
                    <label style="${LBL}">Username</label>
                    <input id="bootRegUserid" type="text" placeholder="3–20 letters, numbers, _ or ." autocomplete="username" autocapitalize="none" style="${INP}" />
                    <div id="bootRegUserStatus" style="font-size:0.72rem;color:#7a89a8;margin-top:4px;min-height:1em;"></div>
                </div>
                <div><label style="${LBL}">Phone Number</label><input id="bootRegPhone" type="tel" placeholder="10-digit number" maxlength="10" inputmode="numeric" autocomplete="tel-national" style="${INP}" /></div>
                <div><label style="${LBL}">Email</label><input id="bootRegEmail" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email" style="${INP}" /></div>
                <div><label style="${LBL}">OTP</label>${otpFieldHtml('bootReg')}</div>
            </div>
            <button id="bootRegSubmit" type="button" style="${BTN_PRIMARY}margin-top:22px;">Register</button>
            <button id="bootLoginLink" type="button" style="${BTN_LINK}display:block;margin:16px auto 0;">Already have an account? Log in</button>
            <div style="margin-top:12px;text-align:center;font-size:0.7rem;color:#5a6885;line-height:1.5;">By registering you agree to Sandesai's terms<br />and privacy policy.</div>`;
        screen.appendChild(card);
        document.body.appendChild(screen);

        $('bootLoginLink').addEventListener('click', () => showLoginScreen());

        let linkVerified = false;
        wireSendOtp('bootReg', 'bootRegPhone', 'bootRegEmail', () => {
            linkVerified = true;
            $('bootRegOtp').value = '✓';
            $('bootRegOtp').disabled = true;
        });

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

        const submitBtn = $('bootRegSubmit');
        const resetSubmit = () => { submitBtn.disabled = false; submitBtn.style.opacity = '1'; submitBtn.textContent = 'Register'; };
        const fail = (msg) => { toast('⚠️ ' + msg); resetSubmit(); };

        submitBtn.addEventListener('click', async () => {
            const name = $('bootRegName').value.trim();
            const userid = $('bootRegUserid').value.trim();
            const phone = $('bootRegPhone').value.trim();
            const email = $('bootRegEmail').value.trim();
            const otp = $('bootRegOtp').value.trim();

            if (!name) return toast('Please enter your name');
            if (!userid) return toast('Please choose a username');
            if (!USERNAME_RE.test(userid)) return toast('Username: 3–20 letters, numbers, _ or .');
            if (!PHONE_RE.test(phone)) return toast('Please enter a valid 10-digit number');
            if (!EMAIL_RE.test(email)) return toast('Please enter a valid email');
            if (!otp && !linkVerified) return toast('Please enter the OTP');

            submitBtn.disabled = true; submitBtn.style.opacity = '0.7';

            submitBtn.textContent = 'Checking…';
            const avail = await checkAvailability(userid, phone);
            if (avail && avail.ok === false) return fail(avail.message || 'Could not check availability');
            if (avail && avail.usernameAvailable === false) return fail('Username is already taken');

            if (!linkVerified) {
                submitBtn.textContent = 'Verifying…';
                const verify = await verifyOtpEmail(phone, otp);
                if (!verify.ok) return fail(verify.message || 'Invalid OTP');
            }

            submitBtn.textContent = 'Registering…';
            await _finishRegistration(name, phone, userid, email);

            const screenEl = $('bootRegScreen');
            if (screenEl) { screenEl.style.transition = 'opacity 0.45s ease'; screenEl.style.opacity = '0'; setTimeout(() => screenEl.remove(), 500); }

            toast('✅ Welcome to Sandesai, ' + name + '!');
            setTimeout(() => {
                if (typeof window.renderChatList === 'function') window.renderChatList();
                if (typeof window.renderCallList === 'function') window.renderCallList();
            }, 600);
        });

        $('bootRegOtp').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
        setTimeout(() => $('bootRegName')?.focus(), 400);
    }
    window.showBootRegistrationScreen = showBootRegistrationScreen;

    function bootRegistrationGate() {
        if ($('inviteWelcomeOverlay')) return;
        if (isRegistered()) return;
        if (forceUpdateShown) return;
        if (bootHadInvite) {
            setTimeout(() => {
                if ($('inviteWelcomeOverlay') || isRegistered() || forceUpdateShown) return;
                showBootRegistrationScreen();
            }, 1500);
            return;
        }
        showBootRegistrationScreen();
    }

    // ────────────────────────────────────────────────────────────
    // 17. BOOT — now checks an existing device session first
    // ────────────────────────────────────────────────────────────
    async function onBoot() {
        const params = new URLSearchParams(location.search);
        bootHadInvite = params.has('join') || params.has('invite');

        const needsUpdate = await checkForceUpdate();
        if (needsUpdate) return;

        // If we look registered locally, confirm the session is still
        // valid server-side (revoked / expired sessions fall back to OTP).
        if (isRegistered()) {
            const phone = localStorage.getItem(SESSION_PHONE_KEY);
            const token = localStorage.getItem(SESSION_TOKEN_KEY);
            const ok = await checkSessionValid(phone, token);
            if (!ok) {
                console.warn('Session invalid/expired — will need to re-verify.');
                localStorage.removeItem('premCallVerified');
                localStorage.removeItem('premCallRegisteredAt');
            }
        }

        setTimeout(handleInviteFromURL, 700);
        setTimeout(bootRegistrationGate, 1300);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onBoot);
    else onBoot();

    console.log('✨ enhancements.js v10 loaded — device sessions, magic link, returning-user login, OTP fixed');
})();
