// ═══════════════════════════════════════════════════════════════
// Sandesai Apps Script · v13-totp-auth
// ═══════════════════════════════════════════════════════════════

const CODE_VERSION = 'v13-totp-auth';

const APP_VERSION     = '0.8';
const MIN_APP_VERSION = '0.5';
const UPDATE_MESSAGE  = 'A new version of Sandesai is available. Please refresh to continue.';

const REGISTRATIONS_SHEET = 'Sheet1';
const BUSINESS_SHEET      = 'Business';
const KNOWLEDGE_SHEET     = 'Knowledge';
const CONVERSATIONS_SHEET = 'Conversations';
const OTP_SHEET           = 'OTPs';
const PUSH_TOKENS_SHEET   = 'PushTokens';
const SESSIONS_SHEET      = 'Sessions';

const REG_HEADERS     = ['Name', 'Username', 'Phone', 'Email', 'Created At', 'Last Login', 'UID', 'Status', 'Auth Method', 'Password Hash', 'Time Offset'];
const OTP_HEADERS     = ['Timestamp', 'Phone', 'Email', 'Code', 'Expires At', 'Email Status', 'Error', 'Verified At'];
const SESSION_HEADERS = ['Phone', 'Token Hash', 'Device', 'Created', 'Last Seen', 'Expires'];

const NOTIFY_EMAIL   = 'sandesai@gmail.com';
const SECRET         = 'sandesai-webhook-2026';
const ADMIN_PASSWORD = 'sandesai-admin-2026';

const PHONE_RE    = /^[6-9]\d{9}$/;
const PHONE_LOOSE = /^\d{10}$/;
const EMAIL_RE    = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

const OTP_TTL_MS          = 10 * 60 * 1000;
const OTP_VERIFIED_TTL_MS = 30 * 60 * 1000;
const OTP_MAX_TRIES       = 5;
const OTP_RATE_PER_HR     = 5;
const OTP_MIN_GAP_MS      = 30 * 1000;
const OTP_RETENTION_DAYS  = 7;

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const REQUIRE_OTP_FOR_REGISTRATION = false;
const SCHEMA_FLAG = 'schema_v13_auth';

const LOGO_URL = 'https://suryasticsai.github.io/sandesai/sandesai-logo.png';

// ═══════════════════════════════════════════════════════════════
function doPost(e) {
    try {
        ensureSchema_();
        if (!e || !e.postData || !e.postData.contents) {
            return jsonResponse({ ok: false, version: CODE_VERSION, error: 'no post body' });
        }
        let body;
        try { body = JSON.parse(e.postData.contents); }
        catch (err) { return jsonResponse({ ok: false, version: CODE_VERSION, error: 'invalid json' }); }

        switch (body.type) {
            case 'conversation':         return logConversation(body);
            case 'sendOtp':              return sendOtp(body);
            case 'verifyOtp':            return verifyOtp(body);
            case 'checkOtp':             return verifyOtp(body);
            case 'checkAvailability':    return checkAvailability(body);
            case 'checkLogin':           return checkLogin(body);
            case 'login':                return login(body);
            case 'resendWelcome':        return resendWelcome(body);
            case 'requestPasswordReset': return requestPasswordReset(body);
            case 'resetPassword':        return resetPassword(body);
            case 'deleteAccount':        return deleteAccount(body);
            case 'registerPushToken':    return registerPushToken(body);
            case 'removePushToken':      return removePushToken(body);
            case 'registerSession':      return registerSession(body);
            case 'verifySession':        return verifySession(body);
            case 'removeSession':        return removeSession(body);
            case 'registration':
            case 'register':
            default:                     return logRegistration(body);
        }
    } catch (err) {
        return jsonResponse({ ok: false, version: CODE_VERSION, error: String(err) });
    }
}

// ═══════════════════════════════════════════════════════════════
function doGet(e) {
    ensureSchema_();
    const params = (e && e.parameter) ? e.parameter : {};
    const type = String(params.type || 'users').toLowerCase();

    if (type === 'business')  return jsonResponse({ ok: true, version: CODE_VERSION, business: readBusiness() });
    if (type === 'knowledge') return jsonResponse({ ok: true, version: CODE_VERSION, knowledge: readKnowledge() });

    if (type === 'health') {
        return jsonResponse({
            ok: true,
            version: CODE_VERSION,
            appVersion: APP_VERSION,
            minAppVersion: MIN_APP_VERSION,
            updateMessage: UPDATE_MESSAGE,
            time: new Date().toISOString(),
            mailQuotaRemaining: safeMailQuota_(),
            tabs: {
                registrations: !!getSheet(REGISTRATIONS_SHEET),
                business:      !!getSheet(BUSINESS_SHEET),
                knowledge:     !!getSheet(KNOWLEDGE_SHEET),
                conversations: !!getSheet(CONVERSATIONS_SHEET),
                otps:          !!getSheet(OTP_SHEET),
                pushTokens:    !!getSheet(PUSH_TOKENS_SHEET),
                sessions:      !!getSheet(SESSIONS_SHEET)
            },
            counts: {
                users:          countUsers(),
                knowledgeItems: readKnowledge().length,
                conversations:  readConversations().length,
                pushTokens:     countPushTokens(),
                sessions:       countSessions()
            }
        });
    }

    if (type === 'sendotp') return sendOtp({ secret: params.secret, phone: params.phone, email: params.email });
    if (type === 'checkotp') return _verifyOtpCore(String(params.phone || '').trim(), String(params.code || '').trim());

    if (type === 'checkavailability') return checkAvailability({ phone: params.phone, username: params.username });
    if (type === 'checkuser') {
        const uid   = String(params.uid || '').trim();
        const email = String(params.email || '').trim();
        const existing = (uid && findUserByUid(uid)) || (email && findUserByEmail(email));
        return jsonResponse({ ok: true, version: CODE_VERSION, exists: !!existing,
            registeredPhone: existing ? existing.phone : '',
            registeredUsername: existing ? existing.username : '' });
    }
    if (type === 'userconversations') {
        const phone = String(params.phone || '').trim();
        const limit = Math.min(parseInt(params.limit || '20', 10) || 20, 100);
        if (!phone) return jsonResponse({ ok: false, version: CODE_VERSION, error: 'phone required' });
        return jsonResponse({ ok: true, version: CODE_VERSION, conversations: readUserConversations(phone, limit) });
    }

    const pass = String(params.pass || '');
    if (pass !== ADMIN_PASSWORD) return jsonResponse({ ok: false, version: CODE_VERSION, error: 'forbidden' });

    if (type === 'conversations') return jsonResponse({ ok: true, version: CODE_VERSION, conversations: readConversations() });
    if (type === 'pushtokens')    return jsonResponse({ ok: true, version: CODE_VERSION, tokens: readPushTokens() });
    if (type === 'sessions')      return jsonResponse({ ok: true, version: CODE_VERSION, sessions: readSessions() });
    if (type === 'maintenance') {
        return jsonResponse({
            ok: true, version: CODE_VERSION,
            otpRowsPurged: purgeOldOtpRows_(),
            sessionsPurged: purgeExpiredSessions_(),
            propertyKeysCleaned: cleanupOtps(),
            duplicatesRemoved: dedupeAllRegistrations_()
        });
    }
    return jsonResponse({ ok: true, version: CODE_VERSION, users: readUsers() });
}

// ═══════════════════════════════════════════════════════════════
function ensureSchema_() {
    try {
        const props = PropertiesService.getScriptProperties();
        if (props.getProperty(SCHEMA_FLAG) === '1') return;
        migrateRegistrationsSheet_();
        migrateOtpSheet_();
        ensureSessionsSheet_();
        props.setProperty(SCHEMA_FLAG, '1');
    } catch (e) { console.error('ensureSchema_ failed:', e); }
}

function resetSchemaFlag() {
    PropertiesService.getScriptProperties().deleteProperty(SCHEMA_FLAG);
    Logger.log('Schema flag cleared.');
}

function migrateRegistrationsSheet_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(REGISTRATIONS_SHEET);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    const headers = (data[0] || []).map(function (h) { return String(h || '').trim(); });
    if (headers[0] === 'Name' && headers[8] === 'Auth Method' && headers[9] === 'Password Hash') return;

    const hasData = data.length > 1 && data.slice(1).some(function (r) { return String(r[2] || '').trim(); });
    if (!hasData) {
        sheet.clearContents();
        sheet.getRange(1, 1, 1, REG_HEADERS.length).setValues([REG_HEADERS]);
        return;
    }

    const byPhone = {};
    const order = [];
    for (let i = 1; i < data.length; i++) {
        const r = data[i];
        const phone = String(r[2] || '').trim();
        if (!phone) continue;
        const createdMs = toMillis_(r[4] || r[3]);
        const loginMs   = toMillis_(r[5] || r[3]);
        const name = String(r[0] || '').trim();
        const uname = String(r[1] || '').trim();
        const uid = String(r[6] || r[4] || '').trim();
        const email = String(r[3] && r[3].indexOf('@') !== -1 ? r[3] : '').trim();
        if (!byPhone[phone]) {
            byPhone[phone] = { name: name, username: uname, phone: phone, email: email,
                createdAt: createdMs, lastLogin: loginMs, uid: uid,
                status: 'active', authMethod: 'totp', passwordHash: '', timeOffset: 0 };
            order.push(phone);
        } else {
            const rec = byPhone[phone];
            if (name) rec.name = name;
            if (uname) rec.username = uname;
            if (uid) rec.uid = uid;
            if (email) rec.email = email;
        }
    }
    const rows = order.map(function (phone) {
        const u = byPhone[phone];
        return [u.name, u.username, u.phone, u.email,
            u.createdAt ? new Date(u.createdAt).toISOString() : '',
            u.lastLogin ? new Date(u.lastLogin).toISOString() : '',
            u.uid, u.status, u.authMethod, u.passwordHash, u.timeOffset];
    });
    sheet.clearContents();
    sheet.getRange(1, 1, 1, REG_HEADERS.length).setValues([REG_HEADERS]);
    if (rows.length) sheet.getRange(2, 1, rows.length, REG_HEADERS.length).setValues(rows);
}

function migrateOtpSheet_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(OTP_SHEET);
    if (!sheet) {
        sheet = ss.insertSheet(OTP_SHEET);
        sheet.getRange(1, 1, 1, OTP_HEADERS.length).setValues([OTP_HEADERS]);
        return;
    }
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
    if (headers.indexOf('Verified At') !== -1) return;
    sheet.getRange(1, headers.length + 1).setValue('Verified At');
}

function ensureSessionsSheet_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SESSIONS_SHEET);
    if (!sheet) {
        sheet = ss.insertSheet(SESSIONS_SHEET);
        sheet.getRange(1, 1, 1, SESSION_HEADERS.length).setValues([SESSION_HEADERS]);
    }
}

// ═══════════════════════════════════════════════════════════════
function hashPassword_(phone, password) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, SECRET + '|pw|' + phone + '|' + password);
    return Utilities.base64Encode(bytes);
}

function generateTimeOffset_() {
    const choices = [-9,-8,-7,-6,-5,-4,-3,-2,-1,1,2,3,4,5,6,7,8,9];
    return choices[Math.floor(Math.random() * choices.length)];
}

function formatTimeCode_(date, offsetMinutes) {
    const d = new Date(date.getTime());
    d.setMinutes(d.getMinutes() + (offsetMinutes || 0));
    let h = d.getHours();
    const m = d.getMinutes();
    if (h === 0) h = 12; else if (h > 12) h -= 12;
    return String(h).padStart(2, '0') + String(m).padStart(2, '0');
}

function formatTime12_(d) {
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12; else if (h > 12) h -= 12;
    return String(h).padStart(2, '0') + ':' + m + ' ' + ampm;
}

// Cryptic hint — never reveals unit, format, or rotation
function buildCrypticHint_(offset) {
    if (!offset || offset === 0) return 'You are right on time. No adjustment needed.';
    const n = Math.abs(offset);
    const s = n === 1 ? 'step' : 'steps';
    if (offset > 0) return 'You are ' + n + ' ' + s + ' ahead of your time. Use it wisely.';
    return 'You are ' + n + ' ' + s + ' behind your time. Catch up wisely.';
}

// ═══════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════
function checkLogin(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = String(body.phone || '').trim();
    if (!PHONE_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone', message: 'Invalid phone number.' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found', message: 'No account for this number. Please register first.' });

    const methods = [];
    if (user.authMethod === 'totp' || user.authMethod === 'both' || user.timeOffset) methods.push('totp');
    if (user.passwordHash) methods.push('password');
    if (user.authMethod === 'google') methods.push('google');
    if (!methods.length) methods.push('totp');

    return jsonResponse({
        ok: true,
        version: CODE_VERSION,
        methods: methods,
        name: user.name || '',
        username: user.username || '',
        hint: methods.indexOf('totp') !== -1 ? buildCrypticHint_(user.timeOffset) : ''
    });
}

function login(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = String(body.phone || '').trim();
    const method = String(body.method || 'totp').toLowerCase();
    if (!PHONE_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone', message: 'Invalid phone.' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found', message: 'No account.' });

    if (method === 'totp') {
        const code = String(body.code || '').trim();
        if (!/^\d{4}$/.test(code)) {
            return jsonResponse({ ok: false, error: 'invalid_code', message: 'Code must be 4 digits.' });
        }

        // Use the client-reported time so drift between device and server doesn't matter.
        const clientTime = Number(body.clientTime) || Date.now();
        const serverNow = Date.now();

        // Sanity guard — reject absurdly skewed clocks (±3 min)
        if (Math.abs(clientTime - serverNow) > 3 * 60 * 1000) {
            return jsonResponse({
                ok: false,
                error: 'clock_skew',
                message: 'Your device time looks wrong. Please check your date & time settings.'
            });
        }

        // Expected code based on client time + user's secret offset.
        // Allow ±1 minute so a code typed across a minute boundary still works.
        const expected     = formatTimeCode_(new Date(clientTime), user.timeOffset || 0);
        const expectedPrev = formatTimeCode_(new Date(clientTime - 60000), user.timeOffset || 0);
        const expectedNext = formatTimeCode_(new Date(clientTime + 60000), user.timeOffset || 0);

        if (code !== expected && code !== expectedPrev && code !== expectedNext) {
            return jsonResponse({ ok: false, error: 'wrong_code', message: 'Wrong code.' });
        }
    } else if (method === 'password') {
        const password = String(body.password || '');
        if (!password) return jsonResponse({ ok: false, error: 'invalid_password', message: 'Password required.' });
        if (!user.passwordHash) return jsonResponse({ ok: false, error: 'no_password', message: 'No password set on this account.' });
        if (hashPassword_(phone, password) !== user.passwordHash) {
            return jsonResponse({ ok: false, error: 'wrong_password', message: 'Wrong password.' });
        }
    } else {
        return jsonResponse({ ok: false, error: 'invalid_method' });
    }

    try {
        const sheet = getSheet(REGISTRATIONS_SHEET);
        if (sheet) sheet.getRange(user.row, 6).setValue(new Date().toISOString());
    } catch (e) {}

    return jsonResponse({
        ok: true,
        version: CODE_VERSION,
        user: {
            name: user.name, username: user.username, phone: user.phone,
            email: user.email, uid: user.uid, authMethod: method
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// RECOVERY
// ═══════════════════════════════════════════════════════════════
function resendWelcome(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = String(body.phone || '').trim();
    if (!PHONE_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone', message: 'Invalid phone number.' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found', message: 'No account for this number.' });
    if (!user.email || !EMAIL_RE.test(user.email)) return jsonResponse({ ok: false, error: 'no_email', message: 'No email on file.' });

    const props = PropertiesService.getScriptProperties();
    const rateKey = 'resendrate_' + phone;
    const now = Date.now();
    const gate = withLock_(function () {
        const raw = props.getProperty(rateKey);
        let rate = raw ? JSON.parse(raw) : { count: 0, resetAt: 0, lastAt: 0 };
        if (now > rate.resetAt) rate = { count: 0, resetAt: now + 60 * 60 * 1000, lastAt: 0 };
        if (rate.lastAt && now - rate.lastAt < 60 * 1000) {
            const s = Math.ceil((60 * 1000 - (now - rate.lastAt)) / 1000);
            return { ok: false, error: 'too_soon', message: 'Please wait ' + s + 's.' };
        }
        if (rate.count >= 3) {
            const m = Math.ceil((rate.resetAt - now) / 60000);
            return { ok: false, error: 'too_many', message: 'Too many requests. Try in ' + m + ' min.' };
        }
        rate.count++; rate.lastAt = now;
        props.setProperty(rateKey, JSON.stringify(rate));
        return { ok: true };
    });
    if (!gate.ok) return jsonResponse(gate);

    const method = user.authMethod || 'totp';
    if (method === 'totp' || method === 'both' || user.timeOffset) {
        const code = formatTimeCode_(new Date(), user.timeOffset || 0);
        sendTimeBasedOTPEmail(user.email, code, user.timeOffset || 0, user.name, phone);
    } else if (method === 'password') {
        sendPasswordWelcomeEmail(user.email, user.name, phone);
    } else {
        return jsonResponse({ ok: false, error: 'no_recovery', message: 'Google accounts cannot be recovered here.' });
    }

    const parts = user.email.split('@');
    const masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return jsonResponse({ ok: true, version: CODE_VERSION, sentTo: masked, method: method });
}

function requestPasswordReset(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = String(body.phone || '').trim();
    if (!PHONE_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });
    if (!user.passwordHash && user.authMethod !== 'password' && user.authMethod !== 'both') {
        return jsonResponse({ ok: false, error: 'not_password', message: 'This account has no password.' });
    }
    if (!user.email || !EMAIL_RE.test(user.email)) return jsonResponse({ ok: false, error: 'no_email' });

    const props = PropertiesService.getScriptProperties();
    const rateKey = 'pwresetrate_' + phone;
    const now = Date.now();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = now + 15 * 60 * 1000;

    const gate = withLock_(function () {
        const raw = props.getProperty(rateKey);
        let rate = raw ? JSON.parse(raw) : { count: 0, resetAt: 0, lastAt: 0 };
        if (now > rate.resetAt) rate = { count: 0, resetAt: now + 60 * 60 * 1000, lastAt: 0 };
        if (rate.lastAt && now - rate.lastAt < 60 * 1000) {
            const s = Math.ceil((60 * 1000 - (now - rate.lastAt)) / 1000);
            return { ok: false, error: 'too_soon', message: 'Wait ' + s + 's.' };
        }
        if (rate.count >= 3) {
            const m = Math.ceil((rate.resetAt - now) / 60000);
            return { ok: false, error: 'too_many', message: 'Too many requests. Try in ' + m + ' min.' };
        }
        props.setProperty('pwreset_' + phone, JSON.stringify({
            hash: hashCode_(phone, code), email: user.email, expiresAt: expiresAt, tries: 0, createdAt: now
        }));
        rate.count++; rate.lastAt = now;
        props.setProperty(rateKey, JSON.stringify(rate));
        return { ok: true };
    });
    if (!gate.ok) return jsonResponse(gate);

    try {
        MailApp.sendEmail({
            to: user.email,
            subject: '🔑 Reset your Sandesai password',
            name: 'Sandesai',
            htmlBody: buildPasswordResetEmailHtml(code, user.name),
            body: 'Your Sandesai password reset code is ' + code + '. Expires in 15 minutes.'
        });
    } catch (e) {
        props.deleteProperty('pwreset_' + phone);
        return jsonResponse({ ok: false, error: 'email_failed', message: 'Could not send reset email.' });
    }
    const parts = user.email.split('@');
    const masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return jsonResponse({ ok: true, version: CODE_VERSION, sentTo: masked, expiresAt: expiresAt });
}

function resetPassword(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = String(body.phone || '').trim();
    const code = String(body.code || '').trim();
    const newPassword = String(body.newPassword || '');
    if (!PHONE_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!/^\d{6}$/.test(code)) return jsonResponse({ ok: false, error: 'invalid_code' });
    if (newPassword.length < 6) return jsonResponse({ ok: false, error: 'weak_password', message: 'Password must be at least 6 characters.' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });

    return withLock_(function () {
        const props = PropertiesService.getScriptProperties();
        const key = 'pwreset_' + phone;
        const raw = props.getProperty(key);
        if (!raw) return jsonResponse({ ok: false, error: 'no_reset', message: 'Request a new code.' });
        let reset;
        try { reset = JSON.parse(raw); }
        catch (e) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'corrupt' }); }
        if (Date.now() > reset.expiresAt) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'expired', message: 'Code expired.' }); }
        if (reset.hash !== hashCode_(phone, code)) {
            reset.tries = (reset.tries || 0) + 1;
            if (reset.tries >= 5) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'too_many_attempts' }); }
            props.setProperty(key, JSON.stringify(reset));
            return jsonResponse({ ok: false, error: 'invalid_code', triesLeft: 5 - reset.tries, message: 'Wrong code. ' + (5 - reset.tries) + ' tries left.' });
        }

        const sheet = getSheet(REGISTRATIONS_SHEET);
        if (!sheet) return jsonResponse({ ok: false, error: 'no_sheet' });
        const newHash = hashPassword_(phone, newPassword);
        sheet.getRange(user.row, 10).setValue(newHash);
        const curMethod = String(sheet.getRange(user.row, 9).getValue() || 'totp');
        if (curMethod === 'totp') sheet.getRange(user.row, 9).setValue('both');
        sheet.getRange(user.row, 6).setValue(new Date().toISOString());

        props.deleteProperty(key);
        try {
            MailApp.sendEmail({
                to: reset.email,
                subject: '✅ Your Sandesai password was changed',
                name: 'Sandesai',
                htmlBody: buildPasswordChangedEmailHtml(user.name)
            });
        } catch (e) {}
        return jsonResponse({ ok: true, version: CODE_VERSION, message: 'Password updated.' });
    });
}

// ═══════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════
function logRegistration(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, version: CODE_VERSION, error: 'invalid secret' });

    const name     = String(body.name || '').trim();
    const username = String(body.username || '').trim();
    const phone    = String(body.phone || '').trim();
    const uid      = String(body.uid || '').trim();
    let   email    = String(body.email || '').trim();
    const provider = String(body.provider || 'otp').toLowerCase();
    const authMethod = String(body.authMethod || provider || 'totp').toLowerCase();
    const pw       = String(body.password || '').trim();

    if (!PHONE_RE.test(phone)) {
        return jsonResponse({ ok: false, error: 'invalid_phone', message: 'Enter a valid 10-digit Indian mobile number (starts with 6–9).' });
    }
    if (!USERNAME_RE.test(username)) {
        return jsonResponse({ ok: false, error: 'invalid_username', message: 'Username must be 3–20 letters, numbers, underscore or dot.' });
    }
    if (!email) {
        try {
            const cached = PropertiesService.getScriptProperties().getProperty('otpemail_' + phone);
            if (cached) email = cached;
        } catch (e) {}
    }
    if (email && !EMAIL_RE.test(email)) {
        return jsonResponse({ ok: false, error: 'invalid_email', message: 'Enter a valid email.' });
    }

    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return jsonResponse({ ok: false, error: 'no_registrations_sheet' });

    const data = sheet.getDataRange().getValues();
    const lower = username.toLowerCase();
    const phoneRows = [];
    let usernameRow = -1;
    for (let i = 1; i < data.length; i++) {
        const rowPhone = String(data[i][2] || '').trim();
        const rowUser  = String(data[i][1] || '').trim().toLowerCase();
        if (rowPhone === phone) phoneRows.push(i + 1);
        if (rowUser === lower && rowPhone !== phone) usernameRow = i + 1;
    }
    if (usernameRow !== -1) {
        return jsonResponse({ ok: false, error: 'username_taken', message: 'Username "' + username + '" is already taken.' });
    }

    const nowIso = new Date().toISOString();

    if (!phoneRows.length && uid) {
        const byUid = findUserByUid(uid);
        if (byUid) phoneRows.push(byUid.row);
    }

    // Re-registration
    if (phoneRows.length) {
        for (let i = phoneRows.length - 1; i >= 1; i--) sheet.deleteRow(phoneRows[i]);
        const keepRow = phoneRows[0];
        const cur = sheet.getRange(keepRow, 1, 1, REG_HEADERS.length).getValues()[0];
        const createdAtIso = isoOrEmpty_(cur[4]) || nowIso;
        const existingEmail = String(cur[3] || '');
        const existingUid   = String(cur[6] || '');
        const existingMethod = String(cur[8] || 'totp');
        const existingHash   = String(cur[9] || '');
        const existingOffset = Number(cur[10]) || 0;

        let finalMethod = existingMethod;
        let finalHash = existingHash;
        let finalOffset = existingOffset;

        if (authMethod === 'google') {
            finalMethod = 'google';
        } else {
            if (!finalOffset) finalOffset = generateTimeOffset_();
            if (pw) {
                if (pw.length < 6) return jsonResponse({ ok: false, error: 'weak_password', message: 'Password must be at least 6 characters.' });
                finalHash = hashPassword_(phone, pw);
                finalMethod = 'both';
            } else if (!finalHash) {
                finalMethod = 'totp';
            } else {
                finalMethod = 'both';
            }
        }

        sheet.getRange(keepRow, 1, 1, REG_HEADERS.length).setValues([[
            name || cur[0] || '', username, phone, email || existingEmail,
            createdAtIso, nowIso, uid || existingUid, 'active',
            finalMethod, finalHash, finalOffset
        ]]);

        notifyAdmin_('🔄 User re-registered: ' + (name || phone), '🔄 Re-registration', '#a78bfa',
            name, username, phone, email,
            '<p style="color:#7a89a8;font-size:13px;margin-top:16px;">Auth: ' + finalMethod + '</p>');

        if (email) {
            if (finalMethod === 'totp' || finalMethod === 'both') {
                const currentCode = formatTimeCode_(new Date(), finalOffset);
                sendTimeBasedOTPEmail(email, currentCode, finalOffset, name, phone);
            } else if (finalMethod === 'password') {
                sendPasswordWelcomeEmail(email, name, phone);
            }
        }

        return jsonResponse({ ok: true, version: CODE_VERSION, updated: true, row: keepRow, duplicatesRemoved: phoneRows.length - 1 });
    }

    // New user
    let finalMethod = 'totp';
    let finalHash = '';
    let finalOffset = 0;

    if (authMethod === 'google') {
        finalMethod = 'google';
    } else {
        finalOffset = generateTimeOffset_();
        if (pw) {
            if (pw.length < 6) return jsonResponse({ ok: false, error: 'weak_password', message: 'Password must be at least 6 characters.' });
            finalHash = hashPassword_(phone, pw);
            finalMethod = 'both';
        } else {
            finalMethod = 'totp';
        }
    }

    sheet.appendRow([name, username, phone, email, nowIso, nowIso, uid, 'active', finalMethod, finalHash, finalOffset]);

    notifyAdmin_('🎉 New user: ' + (name || phone), '🎉 New registration', '#a78bfa',
        name, username, phone, email,
        '<p style="color:#7a89a8;font-size:13px;margin-top:16px;">Auth: ' + finalMethod + '</p>');

    if (email && (finalMethod === 'totp' || finalMethod === 'both')) {
        const currentCode = formatTimeCode_(new Date(), finalOffset);
        sendTimeBasedOTPEmail(email, currentCode, finalOffset, name, phone);
    } else if (email && finalMethod === 'password') {
        sendPasswordWelcomeEmail(email, name, phone);
    }

    return jsonResponse({ ok: true, version: CODE_VERSION, created: true, row: sheet.getLastRow() });
}

function notifyAdmin_(subject, heading, color, name, username, phone, email, extraHtml) {
    try {
        MailApp.sendEmail({
            to: NOTIFY_EMAIL, subject: subject,
            htmlBody:
                '<div style="font-family:Inter,Arial,sans-serif;padding:20px;background:#0f0d24;color:#eef0f5;border-radius:16px;">' +
                    '<h2 style="color:' + color + ';margin:0 0 12px;">' + heading + '</h2>' +
                    '<p><b>Name:</b> ' + escapeHtml_(name || '—') + '</p>' +
                    '<p><b>Username:</b> @' + escapeHtml_(username || '—') + '</p>' +
                    '<p><b>Phone:</b> +91 ' + escapeHtml_(phone) + '</p>' +
                    '<p><b>Email:</b> ' + escapeHtml_(email || '—') + '</p>' +
                    (extraHtml || '') +
                    '<p style="color:#7a89a8;font-size:13px;">' + new Date().toLocaleString() + '</p>' +
                '</div>'
        });
    } catch (e) { console.error('notifyAdmin_ failed:', e); }
}

// ═══════════════════════════════════════════════════════════════
// EMAIL BUILDERS
// ═══════════════════════════════════════════════════════════════
function sendTimeBasedOTPEmail(email, code, offsetMinutes, userName, phone) {
    const displayName = escapeHtml_(userName || 'there');
    const offsetLabel = offsetMinutes >= 0 ? '+' + offsetMinutes : String(offsetMinutes);
    const offsetWord  = offsetMinutes === 0 ? 'no offset'
        : (offsetMinutes > 0 ? 'add ' + offsetMinutes + ' min' : 'subtract ' + Math.abs(offsetMinutes) + ' min');

    const exampleNow = new Date();
    exampleNow.setMinutes(exampleNow.getMinutes() + offsetMinutes);
    const exampleCode = formatTimeCode_(exampleNow, 0);

    const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
@keyframes sdShimmer{0%{background-position:-200% center;}100%{background-position:200% center;}}
@keyframes sdCodePop{0%{transform:scale(.92);opacity:0;}60%{transform:scale(1.03);}100%{transform:scale(1);opacity:1;}}
.sd-shimmer{background:linear-gradient(90deg,#a78bfa 0%,#ffffff 45%,#6ee7ff 55%,#a78bfa 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:sdShimmer 4s linear infinite;}
.sd-code{animation:sdCodePop .7s cubic-bezier(.34,1.56,.64,1) both;animation-delay:.25s;}
</style></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a 0%,#0a0818 100%);border-radius:24px;border:1px solid rgba(139,92,246,.22);overflow:hidden;box-shadow:0 40px 80px rgba(0,0,0,.55);">
<tr><td align="center" style="padding:40px 32px 8px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="108" height="108" style="width:108px;height:108px;border-radius:50%;border:2px solid rgba(139,92,246,.4);box-shadow:0 0 60px rgba(139,92,246,.55);object-fit:cover;display:block;margin:0 auto;" />
<div style="margin-top:24px;font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.2;color:#eef0f5;">Welcome, <span class="sd-shimmer">${displayName}</span>!</div>
<div style="margin-top:8px;font-size:14px;color:#7a89a8;line-height:1.5;">You're one step away from joining Sandesai</div>
</td></tr>
<tr><td align="center" style="padding:14px 32px 8px 32px;"><div style="height:1px;background:linear-gradient(90deg,transparent,rgba(139,92,246,.4),transparent);"></div></td></tr>
<tr><td align="center" style="padding:20px 28px 8px 28px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(139,92,246,.08);border-radius:20px;border:1px solid rgba(139,92,246,.28);">
<tr><td align="center" style="padding:22px 20px 8px 20px;"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#a78bfa;font-weight:600;">Your verification code</div></td></tr>
<tr><td align="center" style="padding:12px 20px 24px 20px;"><div class="sd-code" style="display:inline-block;font-size:48px;font-weight:800;letter-spacing:14px;color:#ffffff;font-family:'SF Mono',Menlo,monospace;text-shadow:0 0 24px rgba(139,92,246,.65);padding-left:14px;">${code}</div></td></tr>
</table></td></tr>
<tr><td style="padding:24px 32px 8px 32px;">
<div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6ee7ff;font-weight:600;margin-bottom:12px;">How your code works</div>
<div style="font-size:14px;color:#a5b3d0;line-height:1.65;">Your code is based on the time shown on your device — formatted as <b style="color:#eef0f5;">HHMM</b> on a 12-hour clock.</div>
</td></tr>
<tr><td style="padding:16px 32px 8px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(110,231,255,.06);border-radius:16px;border:1px solid rgba(110,231,255,.22);">
<tr><td style="padding:18px 20px;">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6ee7ff;font-weight:600;margin-bottom:8px;">Your secret offset</div>
<div style="font-size:16px;font-weight:700;color:#eef0f5;font-family:'SF Mono',Menlo,monospace;">${offsetLabel} minutes</div>
<div style="font-size:13px;color:#7a89a8;margin-top:8px;line-height:1.55;">When you generate your code, <b style="color:#c4b5fd;">${offsetWord}</b> to the time shown on your device.</div>
</td></tr></table></td></tr>
<tr><td style="padding:14px 32px 8px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(255,255,255,.03);border-radius:16px;border:1px solid rgba(255,255,255,.06);">
<tr><td style="padding:16px 20px;">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7a89a8;font-weight:600;margin-bottom:10px;">Right now, your code would be</div>
<div style="font-family:'SF Mono',Menlo,monospace;font-size:15px;color:#a5b3d0;line-height:1.7;">
<span style="color:#7a89a8;">Device time:</span> <span style="color:#eef0f5;">${formatTime12_(new Date())}</span><br>
<span style="color:#7a89a8;">With offset:</span> <span style="color:#6ee7ff;">${formatTime12_(exampleNow)}</span><br>
<span style="color:#7a89a8;">Your code:</span> <span style="color:#c4b5fd;font-weight:700;letter-spacing:4px;">${exampleCode}</span>
</div></td></tr></table></td></tr>
<tr><td style="padding:20px 32px 8px 32px;"><div style="font-size:13px;color:#5a6885;line-height:1.6;">🔒 <b style="color:#7a89a8;">Keep this email private.</b> Anyone with your offset and device time can generate your code.</div></td></tr>
<tr><td align="center" style="padding:24px 32px 8px 32px;">
<div style="display:inline-block;padding:14px 32px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;font-weight:700;font-size:15px;box-shadow:0 12px 32px rgba(139,92,246,.4);">Return to Sandesai →</div>
</td></tr>
<tr><td align="center" style="padding:32px 32px 36px 32px;">
<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);margin-bottom:24px;"></div>
<img src="${LOGO_URL}" alt="Sandesai" width="36" height="36" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(139,92,246,.3);margin-bottom:10px;" />
<div style="font-size:14px;font-weight:600;color:#a78bfa;">Sandesai</div>
<div style="font-size:12px;color:#5a6885;margin-top:8px;line-height:1.6;">Private messenger · Built with care<br>If you didn't sign up, you can ignore this email.</div>
</td></tr></table>
<div style="max-width:520px;margin-top:20px;font-size:11px;color:#3d4a5f;text-align:center;">© ${new Date().getFullYear()} Sandesai</div>
</td></tr></table></body></html>`.trim();

    try {
        MailApp.sendEmail({ to: email, subject: '🔐 Welcome to Sandesai — your verification code', htmlBody: htmlBody, name: 'Sandesai' });
        console.log('📧 TOTP welcome sent to', email);
    } catch (e) { console.error('sendTimeBasedOTPEmail failed:', e); }
}

function sendPasswordWelcomeEmail(email, userName, phone) {
    const displayName = escapeHtml_(userName || 'there');
    const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
@keyframes sdShimmer{0%{background-position:-200% center;}100%{background-position:200% center;}}
.sd-shimmer{background:linear-gradient(90deg,#a78bfa 0%,#ffffff 45%,#6ee7ff 55%,#a78bfa 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:sdShimmer 4s linear infinite;}
</style></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a,#0a0818);border-radius:24px;border:1px solid rgba(139,92,246,.22);overflow:hidden;box-shadow:0 40px 80px rgba(0,0,0,.55);">
<tr><td align="center" style="padding:40px 32px 12px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="96" height="96" style="width:96px;height:96px;border-radius:50%;border:2px solid rgba(139,92,246,.4);box-shadow:0 0 60px rgba(139,92,246,.5);" />
<div style="margin-top:22px;font-size:26px;font-weight:700;color:#eef0f5;">Welcome, <span class="sd-shimmer">${displayName}</span>!</div>
<div style="margin-top:8px;font-size:14px;color:#7a89a8;">Your Sandesai account is ready</div>
</td></tr>
<tr><td style="padding:16px 32px 8px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(139,92,246,.08);border-radius:16px;border:1px solid rgba(139,92,246,.28);">
<tr><td style="padding:20px;">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a78bfa;font-weight:600;margin-bottom:10px;">Your sign-in method</div>
<div style="font-size:16px;font-weight:700;color:#eef0f5;">Password</div>
<div style="font-size:13px;color:#a5b3d0;margin-top:8px;line-height:1.6;">You set a password when you registered. Use your <b style="color:#c4b5fd;">phone number</b> and this password to sign in.</div>
</td></tr></table></td></tr>
<tr><td style="padding:16px 32px 8px 32px;"><div style="font-size:13px;color:#5a6885;line-height:1.6;">🔒 <b style="color:#7a89a8;">Keep this email private.</b> We don't store plaintext passwords.</div></td></tr>
<tr><td align="center" style="padding:28px 32px 36px 32px;">
<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);margin-bottom:24px;"></div>
<img src="${LOGO_URL}" alt="Sandesai" width="36" height="36" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(139,92,246,.3);" />
<div style="font-size:14px;font-weight:600;color:#a78bfa;margin-top:10px;">Sandesai</div>
</td></tr></table></td></tr></table></body></html>`;
    try {
        MailApp.sendEmail({ to: email, subject: '🎉 Welcome to Sandesai', htmlBody: htmlBody, name: 'Sandesai' });
        console.log('📧 Password welcome sent to', email);
    } catch (e) { console.error('sendPasswordWelcomeEmail failed:', e); }
}

function buildPasswordResetEmailHtml(code, userName) {
    const name = escapeHtml_(userName || 'there');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
@keyframes sdShimmer{0%{background-position:-200% center;}100%{background-position:200% center;}}
.sd-shimmer{background:linear-gradient(90deg,#a78bfa 0%,#fff 45%,#6ee7ff 55%,#a78bfa 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:sdShimmer 4s linear infinite;}
</style></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a,#0a0818);border-radius:24px;border:1px solid rgba(139,92,246,.22);overflow:hidden;box-shadow:0 40px 80px rgba(0,0,0,.55);">
<tr><td align="center" style="padding:40px 32px 8px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="88" height="88" style="width:88px;height:88px;border-radius:50%;border:2px solid rgba(139,92,246,.4);box-shadow:0 0 60px rgba(139,92,246,.5);" />
<div style="margin-top:22px;font-size:24px;font-weight:700;color:#eef0f5;">Reset your password, <span class="sd-shimmer">${name}</span></div>
<div style="margin-top:8px;font-size:14px;color:#7a89a8;">Use the code below to set a new password</div>
</td></tr>
<tr><td align="center" style="padding:24px 32px 8px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(139,92,246,.08);border-radius:20px;border:1px solid rgba(139,92,246,.28);">
<tr><td align="center" style="padding:20px 20px 6px 20px;"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#a78bfa;font-weight:600;">Your reset code</div></td></tr>
<tr><td align="center" style="padding:10px 20px 22px 20px;"><div style="display:inline-block;font-size:42px;font-weight:800;letter-spacing:12px;color:#ffffff;font-family:'SF Mono',Menlo,monospace;text-shadow:0 0 24px rgba(139,92,246,.65);padding-left:12px;">${code}</div></td></tr>
</table></td></tr>
<tr><td style="padding:20px 32px 8px 32px;"><div style="font-size:13px;color:#5a6885;line-height:1.6;">⏱️ <b style="color:#7a89a8;">Expires in 15 minutes.</b> If you didn't request this, ignore this email.</div></td></tr>
<tr><td align="center" style="padding:28px 32px 36px 32px;">
<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);margin-bottom:24px;"></div>
<img src="${LOGO_URL}" alt="Sandesai" width="32" height="32" style="width:32px;height:32px;border-radius:50%;border:1px solid rgba(139,92,246,.3);" />
<div style="font-size:13px;font-weight:600;color:#a78bfa;margin-top:10px;">Sandesai</div>
</td></tr></table></td></tr></table></body></html>`;
}

function buildPasswordChangedEmailHtml(userName) {
    const name = escapeHtml_(userName || 'there');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a,#0a0818);border-radius:24px;border:1px solid rgba(47,217,146,.25);overflow:hidden;box-shadow:0 40px 80px rgba(0,0,0,.55);">
<tr><td align="center" style="padding:40px 32px 16px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="80" height="80" style="width:80px;height:80px;border-radius:50%;border:2px solid rgba(47,217,146,.4);" />
<div style="margin-top:20px;font-size:22px;font-weight:700;color:#eef0f5;">✅ Password updated</div>
<div style="margin-top:10px;font-size:14px;color:#a5b3d0;line-height:1.6;">Hi ${name}, your Sandesai password was changed successfully.</div>
</td></tr>
<tr><td style="padding:20px 32px 8px 32px;"><div style="font-size:13px;color:#5a6885;line-height:1.6;">If this wasn't you, email <b style="color:#a78bfa;">sandesai@gmail.com</b> immediately.</div></td></tr>
<tr><td align="center" style="padding:24px 32px 36px 32px;"><img src="${LOGO_URL}" alt="Sandesai" width="32" height="32" style="width:32px;height:32px;border-radius:50%;border:1px solid rgba(139,92,246,.3);" /></td></tr>
</table></td></tr></table></body></html>`;
}

// ═══════════════════════════════════════════════════════════════
// USER LOOKUPS
// ═══════════════════════════════════════════════════════════════
function findUserByPhone(phone) {
    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][2]) === String(phone)) return rowToUser_(data[i], i + 1);
    }
    return null;
}

function findUserByUsername(username) {
    if (!username) return null;
    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    const lower = String(username).toLowerCase();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][1] || '').toLowerCase() === lower) return rowToUser_(data[i], i + 1);
    }
    return null;
}

function findUserByUid(uid) {
    if (!uid) return null;
    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][6] || '') === String(uid)) return rowToUser_(data[i], i + 1);
    }
    return null;
}

function findUserByEmail(email) {
    if (!email) return null;
    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    const lower = String(email).toLowerCase();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][3] || '').toLowerCase() === lower) return rowToUser_(data[i], i + 1);
    }
    return null;
}

function rowToUser_(r, row) {
    return {
        row: row,
        name: r[0] || '',
        username: r[1] || '',
        phone: String(r[2] || ''),
        email: String(r[3] || ''),
        createdAt: r[4],
        lastLogin: r[5],
        uid: r[6] || '',
        status: String(r[7] || 'active'),
        authMethod: String(r[8] || 'totp'),
        passwordHash: String(r[9] || ''),
        timeOffset: Number(r[10]) || 0
    };
}

function checkAvailability(body) {
    const phone    = String(body.phone || '').trim();
    const username = String(body.username || '').trim();
    const result = { ok: true, version: CODE_VERSION };
    if (phone) result.phoneAvailable = !findUserByPhone(phone);
    if (username) {
        const byUser = findUserByUsername(username);
        result.usernameAvailable = !byUser || (!!phone && byUser.phone === phone);
    }
    return jsonResponse(result);
}

// ═══════════════════════════════════════════════════════════════
// DELETE ACCOUNT
// ═══════════════════════════════════════════════════════════════
function deleteAccount(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = String(body.phone || '').trim();
    if (!PHONE_LOOSE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    const existing = findUserByPhone(phone);
    if (!existing) return jsonResponse({ ok: false, error: 'not_found', message: 'No account for +91 ' + phone });
    const suppliedUid = String(body.uid || '').trim();
    if (existing.uid) {
        if (!suppliedUid) return jsonResponse({ ok: false, error: 'uid_required' });
        if (suppliedUid !== existing.uid) return jsonResponse({ ok: false, error: 'uid_mismatch' });
    }

    const usersDeleted    = deleteRowsWhere_(REGISTRATIONS_SHEET, 2, phone);
    const convDeleted     = deleteRowsWhere_(CONVERSATIONS_SHEET, 1, phone);
    const tokensDeleted   = deleteRowsWhere_(PUSH_TOKENS_SHEET, 1, phone);
    const sessionsDeleted = deleteRowsWhere_(SESSIONS_SHEET, 0, phone);

    try {
        const props = PropertiesService.getScriptProperties();
        ['otp_','otprate_','otpok_','otpemail_','pwreset_','pwresetrate_','resendrate_'].forEach(function (prefix) {
            props.deleteProperty(prefix + phone);
        });
    } catch (e) {}

    notifyAdmin_('🗑️ Account deleted: ' + (existing.name || phone), '🗑️ Account deleted', '#ef4444',
        existing.name, existing.username, phone, existing.email, '');

    return jsonResponse({
        ok: true, version: CODE_VERSION,
        deleted: { user: usersDeleted, conversations: convDeleted, pushTokens: tokensDeleted, sessions: sessionsDeleted },
        message: 'Account deleted successfully.'
    });
}

function deleteRowsWhere_(sheetName, colIdx, value) {
    const sheet = getSheet(sheetName);
    if (!sheet) return 0;
    const data = sheet.getDataRange().getValues();
    let n = 0;
    for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][colIdx]) === String(value)) { sheet.deleteRow(i + 1); n++; }
    }
    return n;
}

// ═══════════════════════════════════════════════════════════════
// PUSH TOKENS
// ═══════════════════════════════════════════════════════════════
function registerPushToken(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone    = String(body.phone || '').trim();
    const token    = String(body.token || '').trim();
    const platform = String(body.platform || 'web').trim();
    if (!PHONE_LOOSE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!token || token.length < 20) return jsonResponse({ ok: false, error: 'invalid_token' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(PUSH_TOKENS_SHEET);
    if (!sheet) {
        sheet = ss.insertSheet(PUSH_TOKENS_SHEET);
        sheet.appendRow(['Timestamp', 'Phone', 'Token', 'Platform']);
    }
    deleteRowsWhere_(PUSH_TOKENS_SHEET, 1, phone);
    sheet.appendRow([new Date().toISOString(), phone, token, platform]);
    return jsonResponse({ ok: true, version: CODE_VERSION, message: 'Push token registered.' });
}

function removePushToken(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = String(body.phone || '').trim();
    if (!PHONE_LOOSE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    const deleted = deleteRowsWhere_(PUSH_TOKENS_SHEET, 1, phone);
    return jsonResponse({ ok: true, version: CODE_VERSION, removed: deleted });
}

function readPushTokens() {
    const sheet = getSheet(PUSH_TOKENS_SHEET);
    if (!sheet) return [];
    return sheet.getDataRange().getValues().slice(1).map(function (r) {
        return { timestamp: toMillis_(r[0]), phone: String(r[1] || ''), token: String(r[2] || ''), platform: String(r[3] || 'web') };
    });
}

function countPushTokens() { try { return readPushTokens().length; } catch (e) { return 0; } }

// ═══════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════
function registerSession(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone  = String(body.phone || '').trim();
    const token  = String(body.token || '').trim();
    const device = String(body.device || 'web').trim().slice(0, 120);
    if (!PHONE_LOOSE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!token || token.length < 16) return jsonResponse({ ok: false, error: 'invalid_token' });
    const sheet = getSheet(SESSIONS_SHEET);
    if (!sheet) return jsonResponse({ ok: false, error: 'no_sessions_sheet' });
    const hash = hashCode_(phone, token);
    const now = Date.now();
    const expiresIso = new Date(now + SESSION_TTL_MS).toISOString();
    const nowIso = new Date(now).toISOString();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][1]) === hash) {
            sheet.getRange(i + 1, 5, 1, 2).setValues([[nowIso, expiresIso]]);
            return jsonResponse({ ok: true, version: CODE_VERSION, refreshed: true });
        }
    }
    sheet.appendRow([phone, hash, device, nowIso, nowIso, expiresIso]);
    return jsonResponse({ ok: true, version: CODE_VERSION, created: true });
}

function verifySession(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = String(body.phone || '').trim();
    const token = String(body.token || '').trim();
    if (!PHONE_LOOSE.test(phone) || !token) return jsonResponse({ ok: false, error: 'invalid_request' });
    const sheet = getSheet(SESSIONS_SHEET);
    if (!sheet) return jsonResponse({ ok: false, error: 'no_sessions_sheet' });
    const hash = hashCode_(phone, token);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][1]) === hash && String(data[i][0]) === phone) {
            const expires = toMillis_(data[i][5]);
            if (expires && Date.now() > expires) { sheet.deleteRow(i + 1); return jsonResponse({ ok: false, error: 'expired' }); }
            sheet.getRange(i + 1, 5).setValue(new Date().toISOString());
            return jsonResponse({ ok: true, version: CODE_VERSION, valid: true });
        }
    }
    return jsonResponse({ ok: false, error: 'not_found' });
}

function removeSession(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = String(body.phone || '').trim();
    const token = String(body.token || '').trim();
    if (!PHONE_LOOSE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    const sheet = getSheet(SESSIONS_SHEET);
    if (!sheet) return jsonResponse({ ok: true, version: CODE_VERSION, removed: 0 });
    let removed = 0;
    if (token) {
        const hash = hashCode_(phone, token);
        const data = sheet.getDataRange().getValues();
        for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][1]) === hash) { sheet.deleteRow(i + 1); removed++; }
        }
    } else {
        removed = deleteRowsWhere_(SESSIONS_SHEET, 0, phone);
    }
    return jsonResponse({ ok: true, version: CODE_VERSION, removed: removed });
}

function readSessions() {
    const sheet = getSheet(SESSIONS_SHEET);
    if (!sheet) return [];
    return sheet.getDataRange().getValues().slice(1).map(function (r) {
        return {
            phone: String(r[0] || ''), tokenHash: String(r[1] || ''), device: String(r[2] || ''),
            created: toMillis_(r[3]), lastSeen: toMillis_(r[4]), expires: toMillis_(r[5])
        };
    }).filter(function (s) { return s.phone; });
}

function countSessions() { try { return readSessions().length; } catch (e) { return 0; } }

function purgeExpiredSessions_() {
    const sheet = getSheet(SESSIONS_SHEET);
    if (!sheet) return 0;
    const now = Date.now();
    const data = sheet.getDataRange().getValues();
    let n = 0;
    for (let i = data.length - 1; i >= 1; i--) {
        const exp = toMillis_(data[i][5]);
        if (exp && exp < now) { sheet.deleteRow(i + 1); n++; }
    }
    return n;
}

// ═══════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════
function readUsers() {
    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return [];
    return sheet.getDataRange().getValues().slice(1).map(function (r) {
        return {
            name: r[0] || '', username: r[1] || '', phone: String(r[2] || ''), email: String(r[3] || ''),
            createdAt: toMillis_(r[4]), lastLogin: toMillis_(r[5]), uid: r[6] || '',
            status: String(r[7] || 'active'), authMethod: String(r[8] || 'totp')
        };
    }).filter(function (u) { return u.phone; });
}

function countUsers() { try { return readUsers().length; } catch (e) { return 0; } }

function dedupeAllRegistrations_() {
    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return 0;
    const data = sheet.getDataRange().getValues();
    const seen = {};
    const toDelete = [];
    for (let i = 1; i < data.length; i++) {
        const phone = String(data[i][2] || '').trim();
        if (!phone) continue;
        if (seen[phone]) toDelete.push(i + 1);
        else seen[phone] = true;
    }
    for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
    return toDelete.length;
}

// ═══════════════════════════════════════════════════════════════
// BUSINESS / KNOWLEDGE
// ═══════════════════════════════════════════════════════════════
function readBusiness() {
    const sheet = getSheet(BUSINESS_SHEET);
    if (!sheet) return {};
    const data = sheet.getDataRange().getValues();
    const obj = {};
    data.slice(1).forEach(function (r) {
        const key = String(r[0] || '').trim();
        const value = String(r[1] || '').trim();
        if (key) obj[key] = value;
    });
    return obj;
}

function readKnowledge() {
    const sheet = getSheet(KNOWLEDGE_SHEET);
    if (!sheet) return [];
    return sheet.getDataRange().getValues().slice(1).map(function (r) {
        return { question: String(r[0] || '').trim(), answer: String(r[1] || '').trim(), category: String(r[2] || '').trim() };
    }).filter(function (k) { return k.question && k.answer; });
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════════════════════════
function logConversation(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, version: CODE_VERSION, error: 'invalid secret' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(CONVERSATIONS_SHEET);
    if (!sheet) {
        sheet = ss.insertSheet(CONVERSATIONS_SHEET);
        sheet.appendRow(['Timestamp', 'Session ID', 'Email', 'Query', 'Answer', 'Feedback', 'Source']);
    } else {
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        if (headers.indexOf('Source') === -1) sheet.getRange(1, headers.length + 1).setValue('Source');
    }
    sheet.appendRow([
        new Date().toISOString(),
        body.sessionId || '', body.email || '', body.query || '',
        body.answer || '', body.feedback || '', body.source || 'concierge'
    ]);
    return jsonResponse({ ok: true, version: CODE_VERSION, row: sheet.getLastRow() });
}

function rowToConversation_(r) {
    return {
        timestamp: toMillis_(r[0]), sessionId: String(r[1] || ''), email: String(r[2] || ''),
        query: String(r[3] || ''), answer: String(r[4] || ''), feedback: String(r[5] || ''), source: String(r[6] || '')
    };
}

function readConversations() {
    const sheet = getSheet(CONVERSATIONS_SHEET);
    if (!sheet) return [];
    return sheet.getDataRange().getValues().slice(1).map(rowToConversation_);
}

function readUserConversations(phone, limit) {
    const rows = readConversations().filter(function (c) { return c.sessionId === phone; });
    rows.sort(function (a, b) { return a.timestamp - b.timestamp; });
    return rows.slice(-1 * limit);
}

// ═══════════════════════════════════════════════════════════════
// EMAIL OTP (invite overlay)
// ═══════════════════════════════════════════════════════════════
function hashCode_(phone, code) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, SECRET + '|' + phone + '|' + code);
    return Utilities.base64Encode(bytes);
}

function withLock_(fn) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { return fn(); } finally { lock.releaseLock(); }
}

function safeMailQuota_() {
    try { return MailApp.getRemainingDailyQuota(); } catch (e) { return -1; }
}

function sendOtp(body) {
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, error: 'invalid secret', message: 'Server secret mismatch.' });
    }
    const phone = String(body.phone || '').trim();
    const email = String(body.email || '').trim();
    if (!PHONE_RE.test(phone)) {
        return jsonResponse({ ok: false, error: 'invalid_phone', message: 'Enter a valid 10-digit Indian mobile (starts 6–9).' });
    }
    if (!EMAIL_RE.test(email)) {
        return jsonResponse({ ok: false, error: 'invalid_email', message: 'Enter a valid email.' });
    }
    const props   = PropertiesService.getScriptProperties();
    const rateKey = 'otprate_' + phone;
    const now     = Date.now();
    const code    = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = now + OTP_TTL_MS;

    const gate = withLock_(function () {
        const rawRate = props.getProperty(rateKey);
        let rate = rawRate ? JSON.parse(rawRate) : { count: 0, resetAt: 0, lastAt: 0 };
        if (now > rate.resetAt) rate = { count: 0, resetAt: now + 60 * 60 * 1000, lastAt: 0 };
        if (rate.lastAt && now - rate.lastAt < OTP_MIN_GAP_MS) {
            const s = Math.ceil((OTP_MIN_GAP_MS - (now - rate.lastAt)) / 1000);
            return { ok: false, error: 'too_soon', message: 'Please wait ' + s + 's.' };
        }
        if (rate.count >= OTP_RATE_PER_HR) {
            const m = Math.ceil((rate.resetAt - now) / 60000);
            return { ok: false, error: 'too_many_requests', message: 'Try again in ' + m + ' min.' };
        }
        props.setProperty('otp_' + phone, JSON.stringify({
            hash: hashCode_(phone, code), email: email, expiresAt: expiresAt, tries: 0, createdAt: now
        }));
        props.setProperty('otpemail_' + phone, email);
        rate.count++; rate.lastAt = now;
        props.setProperty(rateKey, JSON.stringify(rate));
        return { ok: true };
    });
    if (!gate.ok) return jsonResponse(gate);

    let logRowIndex = -1;
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet = ss.getSheetByName(OTP_SHEET);
        if (!sheet) {
            sheet = ss.insertSheet(OTP_SHEET);
            sheet.getRange(1, 1, 1, OTP_HEADERS.length).setValues([OTP_HEADERS]);
        }
        sheet.appendRow([new Date().toISOString(), phone, email, '••••••', new Date(expiresAt).toISOString(), 'pending', '', '']);
        logRowIndex = sheet.getLastRow();
    } catch (e) {}

    let emailStatus = 'sent';
    let emailError  = '';
    try {
        MailApp.sendEmail({
            to: email,
            subject: '🔐 Your Sandesai verification code',
            htmlBody:
                '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:32px 24px;background:#0f0d24;color:#eef0f5;border-radius:16px;">' +
                    '<div style="text-align:center;margin-bottom:20px;">' +
                        '<img src="' + LOGO_URL + '" alt="Sandesai" width="72" height="72" style="border-radius:50%;border:2px solid rgba(139,92,246,0.4);display:block;margin:0 auto 12px;" />' +
                        '<h1 style="font-size:22px;margin:0;color:#a78bfa;">Sandesai</h1>' +
                    '</div>' +
                    '<p style="color:#a5b3d0;font-size:14px;margin:0 0 20px;">Use this code to verify your account:</p>' +
                    '<div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:12px;padding:20px 12px;color:#fff;margin:0 0 20px;">' + code + '</div>' +
                    '<p style="color:#7a89a8;font-size:13px;margin:0;">This code expires in <b style="color:#c4b5fd;">10 minutes</b>.</p>' +
                '</div>',
            body: 'Your Sandesai verification code is ' + code + '.'
        });
    } catch (e) {
        emailStatus = 'failed';
        emailError  = String(e).slice(0, 250);
    }

    try {
        if (logRowIndex > 0) {
            const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(OTP_SHEET);
            sheet.getRange(logRowIndex, 6).setValue(emailStatus);
            sheet.getRange(logRowIndex, 7).setValue(emailError);
        }
    } catch (e) {}

    if (emailStatus !== 'sent') {
        withLock_(function () {
            try {
                const raw = props.getProperty(rateKey);
                if (raw) {
                    const rate = JSON.parse(raw);
                    rate.count = Math.max(0, rate.count - 1);
                    rate.lastAt = 0;
                    props.setProperty(rateKey, JSON.stringify(rate));
                }
                props.deleteProperty('otp_' + phone);
            } catch (e) {}
        });
        return jsonResponse({ ok: false, error: 'email_failed', message: 'Could not send email.' });
    }

    const parts = email.split('@');
    const masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return jsonResponse({ ok: true, version: CODE_VERSION, sentTo: masked, expiresAt: expiresAt });
}

function verifyOtp(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    return _verifyOtpCore(String(body.phone || '').trim(), String(body.code || '').trim());
}

function _verifyOtpCore(phone, code) {
    if (!PHONE_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone', message: 'Invalid phone number.' });
    return withLock_(function () {
        const props = PropertiesService.getScriptProperties();
        const key = 'otp_' + phone;
        const raw = props.getProperty(key);
        if (!raw) return jsonResponse({ ok: false, error: 'no_otp', message: 'Please request a new code.' });
        let otp;
        try { otp = JSON.parse(raw); }
        catch (e) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'corrupt_otp' }); }
        if (Date.now() > otp.expiresAt) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'expired', message: 'Code expired.' }); }
        if (otp.hash !== hashCode_(phone, code)) {
            otp.tries = (otp.tries || 0) + 1;
            if (otp.tries >= OTP_MAX_TRIES) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'too_many_attempts' }); }
            props.setProperty(key, JSON.stringify(otp));
            return jsonResponse({ ok: false, error: 'invalid_code', triesLeft: OTP_MAX_TRIES - otp.tries, message: 'Wrong code. ' + (OTP_MAX_TRIES - otp.tries) + ' tries left.' });
        }
        props.deleteProperty(key);
        props.setProperty('otpok_' + phone, String(Date.now() + OTP_VERIFIED_TTL_MS));
        if (otp.email) props.setProperty('otpemail_' + phone, otp.email);
        markOtpVerified_(phone);
        return jsonResponse({ ok: true, version: CODE_VERSION, email: otp.email || '' });
    });
}

function markOtpVerified_(phone) {
    try {
        const sheet = getSheet(OTP_SHEET);
        if (!sheet) return;
        const data = sheet.getDataRange().getValues();
        for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][1]) === String(phone)) {
                sheet.getRange(i + 1, 8).setValue(new Date().toISOString());
                return;
            }
        }
    } catch (e) {}
}

function consumeOtpVerified_(phone) {
    return withLock_(function () {
        const props = PropertiesService.getScriptProperties();
        const key = 'otpok_' + phone;
        const raw = props.getProperty(key);
        if (!raw) return false;
        const valid = Date.now() < Number(raw);
        if (!valid) props.deleteProperty(key);
        return valid;
    });
}

function purgeOldOtpRows_() {
    const sheet = getSheet(OTP_SHEET);
    if (!sheet) return 0;
    const cutoff = Date.now() - OTP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const data = sheet.getDataRange().getValues();
    let n = 0;
    for (let i = data.length - 1; i >= 1; i--) {
        const t = toMillis_(data[i][0]);
        if (t && t < cutoff) { sheet.deleteRow(i + 1); n++; }
    }
    return n;
}

function cleanupOtps() {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const now = Date.now();
    let cleaned = 0;
    Object.keys(all).forEach(function (k) {
        try {
            if (k.indexOf('otp_') === 0 && k.indexOf('otpemail_') !== 0 && k.indexOf('otpok_') !== 0) {
                if (JSON.parse(all[k]).expiresAt < now) { props.deleteProperty(k); cleaned++; }
            } else if (k.indexOf('otpok_') === 0) {
                if (Number(all[k]) < now) { props.deleteProperty(k); cleaned++; }
            } else if (k.indexOf('otprate_') === 0 || k.indexOf('pwresetrate_') === 0 || k.indexOf('resendrate_') === 0) {
                if (JSON.parse(all[k]).resetAt < now) { props.deleteProperty(k); cleaned++; }
            } else if (k.indexOf('pwreset_') === 0) {
                if (JSON.parse(all[k]).expiresAt < now) { props.deleteProperty(k); cleaned++; }
            }
        } catch (e) { props.deleteProperty(k); cleaned++; }
    });
    Logger.log('cleanupOtps → props:' + cleaned);
    return cleaned;
}

function authTest() {
    MailApp.sendEmail(Session.getActiveUser().getEmail(), 'Sandesai mail test', 'MailApp authorized. Quota: ' + safeMailQuota_());
    Logger.log('Mail OK. Quota: ' + safeMailQuota_());
}

function runMigrationNow() {
    resetSchemaFlag();
    ensureSchema_();
    Logger.log('Migration complete. Users: ' + countUsers());
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function toMillis_(v) {
    if (v instanceof Date) return v.getTime();
    if (v === null || v === undefined || v === '') return 0;
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
}

function isoOrEmpty_(v) {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString();
    const s = String(v).trim();
    if (!s) return '';
    const t = new Date(s).getTime();
    return isNaN(t) ? '' : new Date(t).toISOString();
}

function escapeHtml_(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function getSheet(name) {
    try { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
    catch (e) { return null; }
}

function jsonResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}