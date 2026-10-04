// ═══════════════════════════════════════════════════════════════
// Sandesai Apps Script · v18-country-tz-fixes
//
// Fixes in this version (vs v17):
//   1. Country code support (E.164 phones, per-country validation)
//   2. Timezone-aware TOTP codes (client offset + country fallback)
//   3. Salted + iterated password hashing (auto-upgrades legacy)
//   4. OTP-verified token is truly consumed (no replay)
//   5. Client-claimed "google" authMethod is rejected without idToken
//   6. deleteAccount requires a valid session token
//   7. Username checked BEFORE consuming OTP token
//   8. Secrets read from Script Properties (with safe fallback)
//   9. registerSession matches (phone, hash) pair
//  10. Country + Salt columns added to Sheet1 (migration on first run)
// ═══════════════════════════════════════════════════════════════

const CODE_VERSION = 'v18-country-tz-fixes';

const APP_VERSION     = '1.3';
const MIN_APP_VERSION = '0.5';
const UPDATE_MESSAGE  = 'A new version of Sandesai is available. Please refresh to continue.';

const REGISTRATIONS_SHEET = 'Sheet1';
const BUSINESS_SHEET      = 'Business';
const KNOWLEDGE_SHEET     = 'Knowledge';
const CONVERSATIONS_SHEET = 'Conversations';
const OTP_SHEET           = 'OTPs';
const PUSH_TOKENS_SHEET   = 'PushTokens';
const SESSIONS_SHEET      = 'Sessions';

const REG_HEADERS = [
    'Name', 'Username', 'Phone', 'Email', 'Created At', 'Last Login',
    'UID', 'Status', 'Auth Method', 'Password Hash', 'Time Offset',
    'Country Code', 'Salt'
];
const OTP_HEADERS     = ['Timestamp', 'Phone', 'Email', 'Code', 'Expires At', 'Email Status', 'Error', 'Verified At'];
const SESSION_HEADERS = ['Phone', 'Token Hash', 'Device', 'Created', 'Last Seen', 'Expires'];

const NOTIFY_EMAIL = 'sandesai@gmail.com';

// 🔐 Set these in Apps Script → Project Settings → Script Properties.
// Fallbacks keep the current deployment alive until you migrate them.
const _PROPS = PropertiesService.getScriptProperties();
const SECRET         = _PROPS.getProperty('SECRET')         || 'sandesai-webhook-2026';
const ADMIN_PASSWORD = _PROPS.getProperty('ADMIN_PASSWORD') || 'sandesai-admin-2026';

const PHONE_E164_RE  = /^\d{8,15}$/;
const INDIA_LOCAL_RE = /^[6-9]\d{9}$/;
const PHONE_LOOSE    = /^\d{8,15}$/;
const EMAIL_RE       = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_RE    = /^[a-zA-Z0-9_.]{3,20}$/;

// Country calling code → timezone offset (minutes ahead of UTC).
// Used only as fallback when the client doesn't send clientTimezoneOffset.
const COUNTRY_TZ_OFFSET = {
    '91': 330,  '1': -300, '44': 0,    '61': 600,  '971': 240, '65': 480,
    '60': 480,  '81': 540, '82': 540,  '86': 480,  '49': 60,   '33': 60,
    '39': 60,   '34': 60,  '7': 180,   '55': -180, '27': 120,  '234': 60,
    '254': 180, '880': 360,'92': 300,  '94': 330,  '977': 345, '975': 360,
    '960': 300, '95': 390, '66': 420,  '84': 420,  '62': 420,  '63': 480,
    '852': 480, '886': 480,'64': 720,  '20': 120,  '966': 180, '972': 120,
    '90': 180,  '380': 120,'48': 60,   '31': 60,   '32': 60,   '41': 60,
    '43': 60,   '46': 60,  '47': 60,   '45': 60,   '358': 120, '353': 0,
    '351': 0,   '30': 120, '420': 60,  '36': 60
};

const OTP_TTL_MS          = 10 * 60 * 1000;
const OTP_VERIFIED_TTL_MS = 30 * 60 * 1000;
const OTP_MAX_TRIES       = 5;
const OTP_RATE_PER_HR     = 5;
const OTP_MIN_GAP_MS      = 30 * 1000;
const OTP_RETENTION_DAYS  = 7;

const PENDING_OFFSET_TTL_MS = 60 * 60 * 1000;
const SESSION_TTL_MS        = 90 * 24 * 60 * 60 * 1000;

const TOTP_MAX_FAILS   = 3;
const TOTP_LOCK_MS     = 15 * 60 * 1000;
const TOTP_FAIL_WINDOW = 15 * 60 * 1000;

const PBKDF2_ITERATIONS = 1000;
const SCHEMA_FLAG = 'schema_v14_country_tz';
const LOGO_URL    = 'https://suryasticsai.github.io/sandesai/sandesai-logo.png';
const SIGN_URL    = 'https://suryasticsai.github.io/sandesai/Author-sign.png';
const APP_URL     = 'https://suryasticsai.github.io/sandesai/';
const LETTER_URL  = 'https://suryasticsai.github.io/sandesai/welcome-letter.html';

// ═══════════════════════════════════════════════════════════════
// CORS PREFLIGHT
// ═══════════════════════════════════════════════════════════════
function doOptions(e) {
    return ContentService.createTextOutput('')
        .setMimeType(ContentService.MimeType.TEXT)
        .setHeaders({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        });
}

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
            case 'sendRegOtp':           return sendRegOtp(body);
            case 'sendOtp':              return sendOtp(body);
            case 'verifyOtp':            return verifyOtp(body);
            case 'checkOtp':             return verifyOtp(body);
            case 'conversation':         return logConversation(body);
            case 'checkAvailability':    return checkAvailability(body);
            case 'checkLogin':           return checkLogin(body);
            case 'login':                return login(body);
            case 'resendWelcome':        return resendWelcome(body);
            case 'requestPasswordReset': return requestPasswordReset(body);
            case 'resetPassword':        return resetPassword(body);
            case 'requestTotpUnlock':    return requestTotpUnlock(body);
            case 'unlockTotp':           return unlockTotp(body);
            case 'disableTotp':          return disableTotp(body);
            case 'enableTotp':           return enableTotp(body);
            case 'setPassword':          return setPassword(body);
            case 'logoutAllDevices':     return logoutAllDevices(body);
            case 'getMyCode':            return getMyCode(body);
            case 'changeOffset':         return changeOffset(body);
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

    if (type === 'sendotp') return sendOtp({
        secret: params.secret, phone: params.phone, email: params.email,
        countryCode: params.countryCode
    });
    if (type === 'checkotp') return _verifyOtpCore(
        normalizePhone_(params.countryCode, params.phone),
        String(params.code || '').trim()
    );

    if (type === 'checkavailability') return checkAvailability({
        phone: params.phone, username: params.username, countryCode: params.countryCode
    });
    if (type === 'checkuser') {
        const uid   = String(params.uid || '').trim();
        const email = String(params.email || '').trim();
        const existing = (uid && findUserByUid(uid)) || (email && findUserByEmail(email));
        return jsonResponse({ ok: true, version: CODE_VERSION, exists: !!existing,
            registeredPhone: existing ? existing.phone : '',
            registeredUsername: existing ? existing.username : '' });
    }
    if (type === 'userconversations') {
        const phone = normalizePhone_(params.countryCode, params.phone);
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
// COUNTRY / PHONE / TZ HELPERS
// ═══════════════════════════════════════════════════════════════
function normalizePhone_(countryCode, localPhone) {
    const cc = String(countryCode || '91').replace(/\D/g, '');
    let p = String(localPhone || '').replace(/\D/g, '');
    p = p.replace(/^0+/, '');
    return cc + p;
}

function validatePhoneForCountry_(countryCode, localPhone) {
    const cc = String(countryCode || '').replace(/\D/g, '');
    const p  = String(localPhone || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!cc) return { ok: false, error: 'missing_country', message: 'Select a country.' };
    if (!p)  return { ok: false, error: 'missing_phone',   message: 'Enter your phone number.' };
    if (cc === '91' && !INDIA_LOCAL_RE.test(p)) {
        return { ok: false, error: 'invalid_phone_in',
                 message: 'Indian mobile must be 10 digits starting 6–9.' };
    }
    const full = cc + p;
    if (!PHONE_E164_RE.test(full)) {
        return { ok: false, error: 'invalid_phone',
                 message: 'Phone is not valid for country +' + cc + '.' };
    }
    return { ok: true, full: full, countryCode: cc };
}

function resolveTimezoneOffsetMin_(clientOffsetMin, countryCode) {
    if (typeof clientOffsetMin === 'number' && isFinite(clientOffsetMin)
        && clientOffsetMin >= -840 && clientOffsetMin <= 840) {
        return clientOffsetMin;
    }
    const cc = String(countryCode || '91').replace(/\D/g, '');
    return COUNTRY_TZ_OFFSET[cc] || 0;
}

// ═══════════════════════════════════════════════════════════════
// PASSWORD HASHING (salted + iterated, auto-upgrades legacy)
// ═══════════════════════════════════════════════════════════════
function generateSalt_() {
    return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function legacyHashPassword_(phone, password) {
    const bytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        SECRET + '|pw|' + phone + '|' + password
    );
    return Utilities.base64Encode(bytes);
}

function hashPassword_(phone, password, salt) {
    if (!salt) return legacyHashPassword_(phone, password); // backward compat
    let sig = Utilities.computeHmacSha256Signature(salt + '|' + password, SECRET);
    for (let i = 0; i < PBKDF2_ITERATIONS; i++) {
        sig = Utilities.computeHmacSha256Signature(sig, SECRET);
    }
    return Utilities.base64Encode(sig);
}

function verifyPassword_(phone, password, storedHash, salt) {
    if (!storedHash) return false;
    return hashPassword_(phone, password, salt) === storedHash;
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

    if (headers[0] === 'Name' && headers[11] === 'Country Code' && headers[12] === 'Salt') return;

    const hasData = data.length > 1 && data.slice(1).some(function (r) {
        return String(r[2] || '').trim();
    });
    if (!hasData) {
        sheet.clearContents();
        sheet.getRange(1, 1, 1, REG_HEADERS.length).setValues([REG_HEADERS]);
        return;
    }

    const byPhone = {};
    const order = [];
    for (let i = 1; i < data.length; i++) {
        const r = data[i];
        const rawPhone = String(r[2] || '').replace(/\D/g, '');
        if (!rawPhone) continue;

        let country = '91', phone = rawPhone;
        if (rawPhone.length === 10) {
            phone = '91' + rawPhone;
        } else if (rawPhone.length > 10 && rawPhone.indexOf('91') === 0) {
            phone = rawPhone;
        }

        const createdMs = toMillis_(r[4] || r[3]);
        const loginMs   = toMillis_(r[5] || r[3]);
        const name  = String(r[0] || '').trim();
        const uname = String(r[1] || '').trim();
        const uid   = String(r[6] || r[4] || '').trim();
        const email = String(r[3] && r[3].indexOf('@') !== -1 ? r[3] : '').trim();
        const method = headers[8] === 'Auth Method'   ? String(r[8] || 'totp') : 'totp';
        const hash   = headers[9] === 'Password Hash' ? String(r[9] || '')     : '';
        const offset = headers[10] === 'Time Offset'  ? (Number(r[10]) || 0)   : 0;
        const salt   = headers[12] === 'Salt'         ? String(r[12] || '')    : '';

        if (!byPhone[phone]) {
            byPhone[phone] = {
                name: name, username: uname, phone: phone, email: email,
                createdAt: createdMs, lastLogin: loginMs, uid: uid,
                status: 'active', authMethod: method, passwordHash: hash,
                timeOffset: offset, countryCode: country, salt: salt
            };
            order.push(phone);
        } else {
            const rec = byPhone[phone];
            if (name)  rec.name = name;
            if (uname) rec.username = uname;
            if (uid)   rec.uid = uid;
            if (email) rec.email = email;
            if (hash)  { rec.passwordHash = hash; rec.authMethod = method; }
            if (offset) rec.timeOffset = offset;
        }
    }

    const rows = order.map(function (phone) {
        const u = byPhone[phone];
        return [u.name, u.username, u.phone, u.email,
            u.createdAt ? new Date(u.createdAt).toISOString() : '',
            u.lastLogin ? new Date(u.lastLogin).toISOString() : '',
            u.uid, u.status, u.authMethod, u.passwordHash, u.timeOffset,
            u.countryCode, u.salt];
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
// AUTH HELPERS
// ═══════════════════════════════════════════════════════════════
function generateTimeOffset_() {
    const choices = [-9,-8,-7,-6,-5,-4,-3,-2,-1,1,2,3,4,5,6,7,8,9];
    return choices[Math.floor(Math.random() * choices.length)];
}

function formatTimeCode_(date, offsetMinutes, tzOffsetMin) {
    const d = new Date(date.getTime());
    d.setUTCMinutes(d.getUTCMinutes() + (tzOffsetMin || 0) + (offsetMinutes || 0));
    let h = d.getUTCHours();
    const m = d.getUTCMinutes();
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

function buildCrypticHint_(offset) {
    if (!offset || offset === 0) return 'You are right on time. No adjustment needed.';
    const n = Math.abs(offset);
    const s = n === 1 ? 'step' : 'steps';
    if (offset > 0) return 'You are ' + n + ' ' + s + ' ahead of your time. Use it wisely.';
    return 'You are ' + n + ' ' + s + ' behind your time. Catch up wisely.';
}

function getTotpFailState_(phone) {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('totpfail_' + phone);
    if (!raw) return { count: 0, firstFailAt: 0, lockedUntil: 0 };
    try { return JSON.parse(raw); }
    catch (e) { return { count: 0, firstFailAt: 0, lockedUntil: 0 }; }
}

function setTotpFailState_(phone, state) {
    PropertiesService.getScriptProperties().setProperty('totpfail_' + phone, JSON.stringify(state));
}

function clearTotpFailState_(phone) {
    PropertiesService.getScriptProperties().deleteProperty('totpfail_' + phone);
}

function isTotpLocked_(phone) {
    const s = getTotpFailState_(phone);
    return s.lockedUntil && s.lockedUntil > Date.now() ? s : null;
}

function verifySessionForPhone_(phone, token) {
    if (!phone || !token) return false;
    const sheet = getSheet(SESSIONS_SHEET);
    if (!sheet) return false;
    const hash = hashCode_(phone, token);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][1]) === hash && String(data[i][0]) === phone) {
            const expires = toMillis_(data[i][5]);
            if (!expires || Date.now() < expires) return true;
        }
    }
    return false;
}

function consumePendingOffset_(phone) {
    const props = PropertiesService.getScriptProperties();
    const key = 'pendingoffset_' + phone;
    const raw = props.getProperty(key);
    if (!raw) return 0;
    let result = 0;
    try {
        const p = JSON.parse(raw);
        if (p && p.expiresAt && Date.now() < p.expiresAt && typeof p.offset === 'number' && p.offset !== 0) {
            result = p.offset;
        }
    } catch (e) {}
    props.deleteProperty(key);
    return result;
}

// ═══════════════════════════════════════════════════════════════
// REGISTRATION OTP
// ═══════════════════════════════════════════════════════════════
function sendRegOtp(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });

    const country = String(body.countryCode || '91').replace(/\D/g, '');
    const pv = validatePhoneForCountry_(country, body.phone);
    if (!pv.ok) return jsonResponse({ ok: false, error: pv.error, message: pv.message });
    const phone = pv.full;

    const email = String(body.email || '').trim();
    const name  = String(body.name  || '').trim();
    if (!EMAIL_RE.test(email)) return jsonResponse({ ok: false, error: 'invalid_email', message: 'Enter a valid email.' });

    const props   = PropertiesService.getScriptProperties();
    const rateKey = 'otprate_' + phone;
    const now     = Date.now();
    const code    = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = now + OTP_TTL_MS;
    const offset    = generateTimeOffset_();

    const gate = withLock_(function () {
        const rawRate = props.getProperty(rateKey);
        let rate = rawRate ? JSON.parse(rawRate) : { count: 0, resetAt: 0, lastAt: 0 };
        if (now > rate.resetAt) rate = { count: 0, resetAt: now + 60 * 60 * 1000, lastAt: 0 };
        if (rate.lastAt && now - rate.lastAt < OTP_MIN_GAP_MS) {
            const s = Math.ceil((OTP_MIN_GAP_MS - (now - rate.lastAt)) / 1000);
            return { ok: false, error: 'too_soon', message: 'Please wait ' + s + 's before requesting another code.' };
        }
        if (rate.count >= OTP_RATE_PER_HR) {
            const m = Math.ceil((rate.resetAt - now) / 60000);
            return { ok: false, error: 'too_many_requests', message: 'Try again in ' + m + ' min.' };
        }
        props.setProperty('otp_' + phone, JSON.stringify({
            hash: hashCode_(phone, code), email: email, expiresAt: expiresAt, tries: 0, createdAt: now
        }));
        props.setProperty('otpemail_' + phone, email);
        props.setProperty('pendingoffset_' + phone, JSON.stringify({
            offset: offset, expiresAt: now + PENDING_OFFSET_TTL_MS
        }));
        rate.count++; rate.lastAt = now;
        props.setProperty(rateKey, JSON.stringify(rate));
        return { ok: true };
    });
    if (!gate.ok) return jsonResponse(gate);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet = ss.getSheetByName(OTP_SHEET);
        if (!sheet) {
            sheet = ss.insertSheet(OTP_SHEET);
            sheet.getRange(1, 1, 1, OTP_HEADERS.length).setValues([OTP_HEADERS]);
        }
        sheet.appendRow([new Date().toISOString(), phone, email, '••••••',
                         new Date(expiresAt).toISOString(), 'pending', '', '']);
    } catch (e) {}

    const emailResult = buildAndSendRegOtpEmail_(email, code, name || 'there', expiresAt, offset);

    if (!emailResult.ok) {
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
                props.deleteProperty('pendingoffset_' + phone);
            } catch (e) {}
        });
        return jsonResponse({ ok: false, error: 'email_failed', message: 'Could not send email: ' + emailResult.error });
    }

    const parts = email.split('@');
    const masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return jsonResponse({
        ok: true, version: CODE_VERSION, sentTo: masked,
        expiresAt: expiresAt, cooldownSeconds: Math.ceil(OTP_MIN_GAP_MS / 1000)
    });
}

function buildAndSendRegOtpEmail_(email, code, userName, expiresAt, offset) {
    const displayName = escapeHtml_(userName);
    const minutesLeft = Math.ceil((expiresAt - Date.now()) / 60000);
    const abs = Math.abs(offset);
    const stepsText = abs === 1 ? '1 step' : abs + ' steps';
    const direction = offset > 0 ? 'ahead of' : 'behind';
    const offsetLabel = (offset > 0 ? '+' : '') + offset;

    const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a 0%,#0a0818 100%);border-radius:24px;border:1px solid rgba(139,92,246,.22);overflow:hidden;box-shadow:0 40px 80px rgba(0,0,0,.55);">

<tr><td align="center" style="padding:40px 32px 8px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="88" height="88" style="width:88px;height:88px;border-radius:50%;border:2px solid rgba(139,92,246,.4);box-shadow:0 0 60px rgba(139,92,246,.5);display:block;margin:0 auto;" />
<div style="margin-top:22px;font-size:24px;font-weight:700;color:#eef0f5;">Hey ${displayName}, here's your code</div>
<div style="margin-top:8px;font-size:14px;color:#8a98b5;">Verify your email to finish signing up</div>
</td></tr>

<tr><td align="center" style="padding:26px 32px 8px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.35);border-radius:20px;">
<tr><td align="center" style="padding:24px 20px 4px 20px;">
<div style="font-size:11px;letter-spacing:.20em;text-transform:uppercase;color:#a78bfa;font-weight:700;">Your verification code</div>
</td></tr>
<tr><td align="center" style="padding:14px 20px 8px 20px;">
<div style="display:inline-block;font-size:48px;font-weight:800;letter-spacing:14px;color:#ffffff;font-family:'SF Mono',Menlo,monospace;padding-left:14px;-webkit-user-select:all;user-select:all;-moz-user-select:all;-ms-user-select:all;cursor:pointer;">${code}</div>
</td></tr>
<tr><td align="center" style="padding:6px 20px 20px 20px;">
<div style="display:inline-block;font-size:12px;color:#c4b5fd;background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.35);border-radius:20px;padding:6px 14px;">
⧉ Tap the code above to copy
</div>
</td></tr>
</table>
</td></tr>

<tr><td align="center" style="padding:14px 32px 8px 32px;">
<div style="display:inline-block;font-size:12px;color:#6ee7ff;background:rgba(110,231,255,.10);border:1px solid rgba(110,231,255,.25);border-radius:20px;padding:4px 12px;">● expires in ${minutesLeft} minutes</div>
</td></tr>

<tr><td style="padding:28px 32px 8px 32px;">
<div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6ee7ff;font-weight:600;margin-bottom:12px;">What is a "time-based token"?</div>
<div style="font-size:14px;color:#c5cfe0;line-height:1.75;">
Sandesai replaces the password you'd normally type with a <b style="color:#c4b5fd;">live code based on time</b>. Here's how it works:
</div>
<ol style="font-size:14px;color:#c5cfe0;line-height:1.8;margin:14px 0 0;padding-left:22px;">
<li>You have a <b style="color:#c4b5fd;">secret offset</b> — a tiny adjustment only you know.</li>
<li>The app reads the current time on your device.</li>
<li>It nudges that time by your offset, then writes it as <b style="color:#c4b5fd;">HHMM</b> on a 12-hour clock.</li>
<li>That 4-digit result is your sign-in code — and it changes every single minute.</li>
</ol>
</td></tr>

<tr><td style="padding:18px 32px 8px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(110,231,255,.06);border-radius:16px;border:1px solid rgba(110,231,255,.22);">
<tr><td style="padding:18px 20px;">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6ee7ff;font-weight:600;margin-bottom:10px;">Your secret offset</div>
<div style="font-size:20px;font-weight:800;color:#eef0f5;font-family:'SF Mono',Menlo,monospace;margin-bottom:8px;">${offsetLabel}</div>
<div style="font-size:13px;color:#8a98b5;line-height:1.65;">
You are <b style="color:#c4b5fd;">${stepsText} ${direction}</b> your time.
When you sign in, take the current time on your device and move it forward or back by ${stepsText}. Then write the result as HHMM — that's your code.
</div>
<div style="margin-top:14px;font-size:12px;color:#6b7a96;line-height:1.6;">
🔒 <b style="color:#a5b3d0;">Keep this private.</b> Anyone who sees your offset and knows your device time can generate your code.
</div>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:20px 32px 8px 32px;">
<div style="font-size:13px;color:#6b7a96;line-height:1.65;">
You'll also set a password during signup — that's your backup if you ever forget the offset. You can change the offset anytime from Settings once you're in.
</div>
</td></tr>

<tr><td align="center" style="padding:26px 32px 8px 32px;">
<a href="${APP_URL}" style="display:inline-block;padding:15px 36px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 12px 32px rgba(139,92,246,.4);">Return to Sandesai →</a>
</td></tr>

<tr><td align="center" style="padding:32px 32px 36px 32px;">
<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);margin-bottom:24px;"></div>
<img src="${LOGO_URL}" alt="Sandesai" width="36" height="36" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(139,92,246,.3);display:block;margin:0 auto 10px;" />
<div style="font-size:14px;font-weight:600;color:#a78bfa;text-align:center;">Sandesai</div>
<div style="font-size:12px;color:#5a6885;margin-top:8px;line-height:1.6;text-align:center;">Private messenger · Built with care<br>If you didn't sign up, you can ignore this email.</div>
</td></tr>

</table>
<div style="max-width:520px;margin-top:20px;font-size:11px;color:#3d4a5f;text-align:center;">© ${new Date().getFullYear()} Sandesai</div>
</td></tr></table></body></html>`.trim();

    try {
        MailApp.sendEmail({
            to: email,
            subject: '✉️ Verify your email — Sandesai',
            htmlBody: htmlBody,
            name: 'Sandesai'
        });
        console.log('📧 Reg OTP sent to', email);
        return { ok: true };
    } catch (e) {
        console.error('sendRegOtp email failed:', e);
        return { ok: false, error: String(e).slice(0, 250) };
    }
}

// ═══════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════
function checkLogin(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone', message: 'Invalid phone number.' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found', message: 'No account for this number. Please register first.' });

    const methods = [];
    if (user.authMethod === 'totp' || user.authMethod === 'both') methods.push('totp');
    if (user.passwordHash) methods.push('password');
    if (user.authMethod === 'google') methods.push('google');
    if (!methods.length) methods.push('totp');

    const lock = isTotpLocked_(phone);
    const tzOffset = resolveTimezoneOffsetMin_(null, user.countryCode);

    return jsonResponse({
        ok: true,
        version: CODE_VERSION,
        methods: methods,
        name: user.name || '',
        username: user.username || '',
        countryCode: user.countryCode,
        serverTimezoneOffset: tzOffset,
        hint: methods.indexOf('totp') !== -1 ? buildCrypticHint_(user.timeOffset) : '',
        totpLocked: !!lock,
        lockedUntil: lock ? lock.lockedUntil : 0,
        remainingSeconds: lock ? Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000)) : 0,
        hasPassword: !!user.passwordHash
    });
}

function login(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone  = normalizePhone_(body.countryCode, body.phone);
    const method = String(body.method || 'totp').toLowerCase();
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone', message: 'Invalid phone.' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found', message: 'No account.' });

    if (method === 'totp') {
        const lock = isTotpLocked_(phone);
        if (lock) {
            const rem = Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
            return jsonResponse({
                ok: false, error: 'totp_locked',
                message: 'Too many wrong codes.',
                lockedUntil: lock.lockedUntil,
                remainingSeconds: rem,
                hasPassword: !!user.passwordHash
            });
        }
        if (user.authMethod === 'password') {
            return jsonResponse({ ok: false, error: 'totp_disabled', message: 'Time code is disabled.', hasPassword: true });
        }

        const code = String(body.code || '').trim();
        if (!/^\d{4}$/.test(code)) return jsonResponse({ ok: false, error: 'invalid_code', message: 'Code must be 4 digits.' });

        const clientTime = Number(body.clientTime) || Date.now();
        const serverNow  = Date.now();
        if (Math.abs(clientTime - serverNow) > 3 * 60 * 1000) {
            return jsonResponse({ ok: false, error: 'clock_skew', message: 'Check your date & time settings.' });
        }

        const tzOffset = resolveTimezoneOffsetMin_(Number(body.clientTimezoneOffset), user.countryCode);
        const expected     = formatTimeCode_(new Date(clientTime),          user.timeOffset || 0, tzOffset);
        const expectedPrev = formatTimeCode_(new Date(clientTime - 60000),  user.timeOffset || 0, tzOffset);
        const expectedNext = formatTimeCode_(new Date(clientTime + 60000),  user.timeOffset || 0, tzOffset);

        if (code !== expected && code !== expectedPrev && code !== expectedNext) {
            const state = getTotpFailState_(phone);
            const now = Date.now();
            if (!state.firstFailAt || now - state.firstFailAt > TOTP_FAIL_WINDOW) {
                state.count = 0;
                state.firstFailAt = now;
            }
            state.count = (state.count || 0) + 1;
            if (state.count >= TOTP_MAX_FAILS) {
                state.lockedUntil = now + TOTP_LOCK_MS;
                setTotpFailState_(phone, state);
                return jsonResponse({
                    ok: false, error: 'totp_locked',
                    message: 'Too many wrong codes. Use your password or recover via email.',
                    lockedUntil: state.lockedUntil,
                    remainingSeconds: Math.ceil(TOTP_LOCK_MS / 1000),
                    hasPassword: !!user.passwordHash
                });
            }
            setTotpFailState_(phone, state);
            return jsonResponse({
                ok: false, error: 'wrong_code',
                triesLeft: TOTP_MAX_FAILS - state.count,
                message: 'Wrong code. ' + (TOTP_MAX_FAILS - state.count) + ' tries left.',
                hasPassword: !!user.passwordHash
            });
        }
        clearTotpFailState_(phone);
    } else if (method === 'password') {
        const password = String(body.password || '');
        if (!password) return jsonResponse({ ok: false, error: 'invalid_password', message: 'Password required.' });
        if (!user.passwordHash) return jsonResponse({ ok: false, error: 'no_password', message: 'No password set.' });
        if (!verifyPassword_(phone, password, user.passwordHash, user.salt)) {
            return jsonResponse({ ok: false, error: 'wrong_password', message: 'Wrong password.' });
        }
        if (!user.salt) {
            try {
                const newSalt = generateSalt_();
                const newHash = hashPassword_(phone, password, newSalt);
                const sheet = getSheet(REGISTRATIONS_SHEET);
                sheet.getRange(user.row, 10).setValue(newHash);
                sheet.getRange(user.row, 13).setValue(newSalt);
                user.salt = newSalt; user.passwordHash = newHash;
                console.log('🔐 Upgraded legacy password hash for ' + phone);
            } catch (e) { console.error('hash upgrade failed:', e); }
        }
        clearTotpFailState_(phone);
    } else {
        return jsonResponse({ ok: false, error: 'invalid_method' });
    }

    try {
        const sheet = getSheet(REGISTRATIONS_SHEET);
        if (sheet) sheet.getRange(user.row, 6).setValue(new Date().toISOString());
    } catch (e) {}

    return jsonResponse({
        ok: true, version: CODE_VERSION,
        user: {
            name: user.name, username: user.username, phone: user.phone,
            email: user.email, uid: user.uid, authMethod: method,
            countryCode: user.countryCode
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// TOTP UNLOCK
// ═══════════════════════════════════════════════════════════════
function requestTotpUnlock(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });
    if (!user.email || !EMAIL_RE.test(user.email)) return jsonResponse({ ok: false, error: 'no_email' });

    const props = PropertiesService.getScriptProperties();
    const rateKey = 'totpunlockrate_' + phone;
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
        if (rate.count >= 3) return { ok: false, error: 'too_many' };
        props.setProperty('totpunlock_' + phone, JSON.stringify({ hash: hashCode_(phone, code), expiresAt: expiresAt, tries: 0 }));
        rate.count++; rate.lastAt = now;
        props.setProperty(rateKey, JSON.stringify(rate));
        return { ok: true };
    });
    if (!gate.ok) return jsonResponse(gate);

    try {
        MailApp.sendEmail({
            to: user.email,
            subject: '🔓 Unlock your Sandesai account',
            name: 'Sandesai',
            htmlBody: buildUnlockEmailHtml(code, user.name),
            body: 'Your Sandesai unlock code is ' + code + '. Expires in 15 minutes.'
        });
    } catch (e) {
        props.deleteProperty('totpunlock_' + phone);
        return jsonResponse({ ok: false, error: 'email_failed' });
    }

    const parts = user.email.split('@');
    const masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return jsonResponse({ ok: true, version: CODE_VERSION, sentTo: masked, expiresAt: expiresAt });
}

function unlockTotp(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const code = String(body.code || '').trim();
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!/^\d{6}$/.test(code)) return jsonResponse({ ok: false, error: 'invalid_code' });

    return withLock_(function () {
        const props = PropertiesService.getScriptProperties();
        const key = 'totpunlock_' + phone;
        const raw = props.getProperty(key);
        if (!raw) return jsonResponse({ ok: false, error: 'no_unlock' });
        let u;
        try { u = JSON.parse(raw); }
        catch (e) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'corrupt' }); }

        if (Date.now() > u.expiresAt) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'expired' }); }
        if (u.hash !== hashCode_(phone, code)) {
            u.tries = (u.tries || 0) + 1;
            if (u.tries >= 5) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'too_many_attempts' }); }
            props.setProperty(key, JSON.stringify(u));
            return jsonResponse({ ok: false, error: 'invalid_code', triesLeft: 5 - u.tries });
        }
        props.deleteProperty(key);
        clearTotpFailState_(phone);
        return jsonResponse({ ok: true, version: CODE_VERSION, message: 'Unlocked.' });
    });
}

// ═══════════════════════════════════════════════════════════════
// DISABLE / ENABLE TOTP, SET PASSWORD
// ═══════════════════════════════════════════════════════════════
function disableTotp(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    const newPassword = String(body.newPassword || '');

    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!verifySessionForPhone_(phone, token)) return jsonResponse({ ok: false, error: 'invalid_session' });

    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });
    if (user.authMethod === 'password') return jsonResponse({ ok: false, error: 'already_disabled' });

    let finalHash = user.passwordHash;
    let finalSalt = user.salt;

    if (finalHash) {
        if (!password) return jsonResponse({ ok: false, error: 'password_required' });
        if (!verifyPassword_(phone, password, finalHash, finalSalt)) {
            return jsonResponse({ ok: false, error: 'wrong_password' });
        }
    } else {
        if (!newPassword || newPassword.length < 6) return jsonResponse({ ok: false, error: 'new_password_required' });
        finalSalt = generateSalt_();
        finalHash = hashPassword_(phone, newPassword, finalSalt);
    }

    const sheet = getSheet(REGISTRATIONS_SHEET);
    sheet.getRange(user.row, 9).setValue('password');
    sheet.getRange(user.row, 10).setValue(finalHash);
    sheet.getRange(user.row, 13).setValue(finalSalt);
    clearTotpFailState_(phone);
    return jsonResponse({ ok: true, version: CODE_VERSION, message: 'Time code disabled.' });
}

function enableTotp(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const token = String(body.token || '').trim();
    const password = String(body.password || '');

    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!verifySessionForPhone_(phone, token)) return jsonResponse({ ok: false, error: 'invalid_session' });

    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });
    if (user.authMethod === 'both' || user.authMethod === 'totp') return jsonResponse({ ok: false, error: 'already_enabled' });
    if (!user.passwordHash) return jsonResponse({ ok: false, error: 'no_password' });
    if (!password) return jsonResponse({ ok: false, error: 'password_required' });
    if (!verifyPassword_(phone, password, user.passwordHash, user.salt)) {
        return jsonResponse({ ok: false, error: 'wrong_password' });
    }

    let offset = user.timeOffset || 0;
    if (!offset) offset = generateTimeOffset_();

    const sheet = getSheet(REGISTRATIONS_SHEET);
    sheet.getRange(user.row, 9).setValue('both');
    sheet.getRange(user.row, 11).setValue(offset);
    return jsonResponse({ ok: true, version: CODE_VERSION, message: 'Time code enabled.', offset: offset });
}

function setPassword(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const token = String(body.token || '').trim();
    const newPassword = String(body.newPassword || '');
    const currentPassword = String(body.currentPassword || '');

    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (newPassword.length < 6)     return jsonResponse({ ok: false, error: 'weak_password' });
    if (!verifySessionForPhone_(phone, token)) return jsonResponse({ ok: false, error: 'invalid_session' });

    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });

    if (user.passwordHash) {
        if (!currentPassword) return jsonResponse({ ok: false, error: 'current_required' });
        if (!verifyPassword_(phone, currentPassword, user.passwordHash, user.salt)) {
            return jsonResponse({ ok: false, error: 'wrong_password' });
        }
    }

    const newSalt = generateSalt_();
    const newHash = hashPassword_(phone, newPassword, newSalt);
    const sheet = getSheet(REGISTRATIONS_SHEET);
    sheet.getRange(user.row, 10).setValue(newHash);
    sheet.getRange(user.row, 13).setValue(newSalt);

    const curMethod = String(sheet.getRange(user.row, 9).getValue() || 'totp');
    if (curMethod === 'totp') sheet.getRange(user.row, 9).setValue('both');
    return jsonResponse({ ok: true, version: CODE_VERSION, message: 'Password saved.' });
}

// ═══════════════════════════════════════════════════════════════
// LOGOUT ALL, LIVE TOKEN, OFFSET
// ═══════════════════════════════════════════════════════════════
function logoutAllDevices(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const token = String(body.token || '').trim();
    if (!PHONE_LOOSE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!verifySessionForPhone_(phone, token)) return jsonResponse({ ok: false, error: 'invalid_session' });

    const sheet = getSheet(SESSIONS_SHEET);
    if (!sheet) return jsonResponse({ ok: true, version: CODE_VERSION, removed: 0 });
    const data = sheet.getDataRange().getValues();
    let removed = 0;
    for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][0]) === phone) { sheet.deleteRow(i + 1); removed++; }
    }
    return jsonResponse({ ok: true, version: CODE_VERSION, removed: removed });
}

function getMyCode(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const token = String(body.token || '').trim();
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!token) return jsonResponse({ ok: false, error: 'no_token' });
    if (!verifySessionForPhone_(phone, token)) return jsonResponse({ ok: false, error: 'invalid_session' });

    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });
    if (user.authMethod === 'password') return jsonResponse({ ok: false, error: 'totp_disabled' });

    const now = new Date();
    const tzOffset = resolveTimezoneOffsetMin_(Number(body.clientTimezoneOffset), user.countryCode);
    const code = formatTimeCode_(now, user.timeOffset || 0, tzOffset);
    const secondsRemaining = 60 - now.getUTCSeconds();
    return jsonResponse({
        ok: true, version: CODE_VERSION,
        code: code, secondsRemaining: secondsRemaining,
        offset: user.timeOffset || 0,
        countryCode: user.countryCode,
        timezoneOffset: tzOffset,
        hint: buildCrypticHint_(user.timeOffset || 0)
    });
}

function changeOffset(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    const newOffset = Number(body.newOffset);

    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!verifySessionForPhone_(phone, token)) return jsonResponse({ ok: false, error: 'invalid_session' });
    if (!password) return jsonResponse({ ok: false, error: 'no_password' });
    if (!Number.isInteger(newOffset) || newOffset === 0 || Math.abs(newOffset) > 9) {
        return jsonResponse({ ok: false, error: 'invalid_offset', message: 'Offset must be -9 to +9, excluding 0.' });
    }

    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });
    if (!user.passwordHash) return jsonResponse({ ok: false, error: 'no_password_set' });
    if (!verifyPassword_(phone, password, user.passwordHash, user.salt)) {
        return jsonResponse({ ok: false, error: 'wrong_password' });
    }

    const sheet = getSheet(REGISTRATIONS_SHEET);
    sheet.getRange(user.row, 11).setValue(newOffset);
    return jsonResponse({ ok: true, version: CODE_VERSION, newOffset: newOffset, message: 'Offset updated.' });
}

// ═══════════════════════════════════════════════════════════════
// RECOVERY
// ═══════════════════════════════════════════════════════════════
function resendWelcome(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });
    if (!user.email || !EMAIL_RE.test(user.email)) return jsonResponse({ ok: false, error: 'no_email' });

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
        if (rate.count >= 3) return { ok: false, error: 'too_many' };
        rate.count++; rate.lastAt = now;
        props.setProperty(rateKey, JSON.stringify(rate));
        return { ok: true };
    });
    if (!gate.ok) return jsonResponse(gate);

    if (user.authMethod === 'totp' || user.authMethod === 'both') {
        const tzOffset = resolveTimezoneOffsetMin_(null, user.countryCode);
        const code = formatTimeCode_(new Date(), user.timeOffset || 0, tzOffset);
        sendTimeBasedOTPEmail(user.email, code, user.timeOffset || 0, user.name, phone);
    } else if (user.authMethod === 'password') {
        sendPasswordWelcomeEmail(user.email, user.name, phone);
    } else {
        return jsonResponse({ ok: false, error: 'no_recovery' });
    }

    const parts = user.email.split('@');
    const masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return jsonResponse({ ok: true, version: CODE_VERSION, sentTo: masked });
}

function requestPasswordReset(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });
    if (!user.passwordHash) return jsonResponse({ ok: false, error: 'not_password' });
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
        if (rate.count >= 3) return { ok: false, error: 'too_many' };
        props.setProperty('pwreset_' + phone, JSON.stringify({
            hash: hashCode_(phone, code), email: user.email, expiresAt: expiresAt, tries: 0
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
            htmlBody: buildPasswordResetEmailHtml(code, user.name)
        });
    } catch (e) {
        props.deleteProperty('pwreset_' + phone);
        return jsonResponse({ ok: false, error: 'email_failed' });
    }

    const parts = user.email.split('@');
    const masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return jsonResponse({ ok: true, version: CODE_VERSION, sentTo: masked, expiresAt: expiresAt });
}

function resetPassword(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const code = String(body.code || '').trim();
    const newPassword = String(body.newPassword || '');
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!/^\d{6}$/.test(code)) return jsonResponse({ ok: false, error: 'invalid_code' });
    if (newPassword.length < 6) return jsonResponse({ ok: false, error: 'weak_password' });

    const user = findUserByPhone(phone);
    if (!user) return jsonResponse({ ok: false, error: 'not_found' });

    return withLock_(function () {
        const props = PropertiesService.getScriptProperties();
        const key = 'pwreset_' + phone;
        const raw = props.getProperty(key);
        if (!raw) return jsonResponse({ ok: false, error: 'no_reset' });
        let reset;
        try { reset = JSON.parse(raw); }
        catch (e) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'corrupt' }); }
        if (Date.now() > reset.expiresAt) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'expired' }); }
        if (reset.hash !== hashCode_(phone, code)) {
            reset.tries = (reset.tries || 0) + 1;
            if (reset.tries >= 5) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'too_many_attempts' }); }
            props.setProperty(key, JSON.stringify(reset));
            return jsonResponse({ ok: false, error: 'invalid_code', triesLeft: 5 - reset.tries });
        }

        const sheet = getSheet(REGISTRATIONS_SHEET);
        const newSalt = generateSalt_();
        const newHash = hashPassword_(phone, newPassword, newSalt);
        sheet.getRange(user.row, 10).setValue(newHash);
        sheet.getRange(user.row, 13).setValue(newSalt);
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
        clearTotpFailState_(phone);
        return jsonResponse({ ok: true, version: CODE_VERSION, message: 'Password updated.' });
    });
}

// ═══════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════
function logRegistration(body) {
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, version: CODE_VERSION, error: 'invalid secret' });
    }

    const name     = String(body.name     || '').trim();
    const username = String(body.username || '').trim();
    const country  = String(body.countryCode || '91').replace(/\D/g, '');
    const uid      = String(body.uid      || '').trim();
    let   email    = String(body.email    || '').trim();
    const pw       = String(body.password || '').trim();

    const pv = validatePhoneForCountry_(country, body.phone);
    if (!pv.ok) return jsonResponse({ ok: false, error: pv.error, message: pv.message });
    const phone = pv.full;

    if (!USERNAME_RE.test(username)) {
        return jsonResponse({ ok: false, error: 'invalid_username',
            message: 'Username must be 3–20 letters, numbers, underscore or dot.' });
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

    const requestedMethod = String(body.authMethod || '').toLowerCase();
    const isGoogleSignin  = requestedMethod === 'google' && !!String(body.googleIdToken || '').trim();

    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return jsonResponse({ ok: false, error: 'no_registrations_sheet' });

    const data  = sheet.getDataRange().getValues();
    const lower = username.toLowerCase();
    const phoneRows = [];
    let usernameRow = -1;
    for (let i = 1; i < data.length; i++) {
        const storedPhone = String(data[i][2] || '').replace(/\D/g, '');
        const rowUser     = String(data[i][1] || '').trim().toLowerCase();
        const match = storedPhone === phone
            || (storedPhone.length === 10 && '91' + storedPhone === phone)
            || (phone.length === 10 && storedPhone === '91' + phone);
        if (match) phoneRows.push(i + 1);
        if (rowUser === lower && !match) usernameRow = i + 1;
    }
    if (usernameRow !== -1) {
        return jsonResponse({ ok: false, error: 'username_taken',
            message: 'Username "' + username + '" is already taken.' });
    }

    if (!isGoogleSignin) {
        if (!consumeOtpVerified_(phone)) {
            return jsonResponse({ ok: false, error: 'otp_not_verified',
                message: 'Please verify your email OTP before registering.' });
        }
    }

    const nowIso = new Date().toISOString();

    if (!phoneRows.length && uid) {
        const byUid = findUserByUid(uid);
        if (byUid) phoneRows.push(byUid.row);
    }

    if (phoneRows.length) {
        for (let i = phoneRows.length - 1; i >= 1; i--) sheet.deleteRow(phoneRows[i]);
        const keepRow = phoneRows[0];
        const cur = sheet.getRange(keepRow, 1, 1, REG_HEADERS.length).getValues()[0];
        const createdAtIso = isoOrEmpty_(cur[4]) || nowIso;

        const existingEmail  = String(cur[3]  || '');
        const existingUid    = String(cur[6]  || '');
        const existingMethod = String(cur[8]  || 'totp');
        const existingHash   = String(cur[9]  || '');
        const existingOffset = Number(cur[10]) || 0;
        const existingSalt   = String(cur[12] || '');

        let finalMethod = existingMethod;
        let finalHash   = existingHash;
        let finalOffset = existingOffset;
        let finalSalt   = existingSalt;

        if (isGoogleSignin) {
            finalMethod = 'google';
        } else {
            if (!finalOffset) finalOffset = consumePendingOffset_(phone) || generateTimeOffset_();
            else              consumePendingOffset_(phone);

            if (pw) {
                if (pw.length < 6) return jsonResponse({ ok: false, error: 'weak_password' });
                finalSalt = generateSalt_();
                finalHash = hashPassword_(phone, pw, finalSalt);
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
            finalMethod, finalHash, finalOffset, country, finalSalt
        ]]);

        clearTotpFailState_(phone);
        notifyAdmin_('🔄 User re-registered: ' + (name || phone), '🔄 Re-registration', '#a78bfa',
            name, username, phone, email,
            '<p style="color:#7a89a8;font-size:13px;margin-top:16px;">Auth: ' + finalMethod + ' · Country: +' + country + '</p>');

        return jsonResponse({
            ok: true, version: CODE_VERSION, updated: true,
            row: keepRow, duplicatesRemoved: phoneRows.length - 1
        });
    }

    let finalMethod = 'totp';
    let finalHash   = '';
    let finalOffset = 0;
    let finalSalt   = '';

    if (isGoogleSignin) {
        finalMethod = 'google';
    } else {
        finalOffset = consumePendingOffset_(phone) || generateTimeOffset_();
        if (pw) {
            if (pw.length < 6) return jsonResponse({ ok: false, error: 'weak_password' });
            finalSalt = generateSalt_();
            finalHash = hashPassword_(phone, pw, finalSalt);
            finalMethod = 'both';
        }
    }

    sheet.appendRow([name, username, phone, email, nowIso, nowIso, uid, 'active',
                     finalMethod, finalHash, finalOffset, country, finalSalt]);

    notifyAdmin_('🎉 New user: ' + (name || phone), '🎉 New registration', '#a78bfa',
        name, username, phone, email,
        '<p style="color:#7a89a8;font-size:13px;margin-top:16px;">Auth: ' + finalMethod + ' · Country: +' + country + '</p>');

    return jsonResponse({ ok: true, version: CODE_VERSION, created: true, row: sheet.getLastRow() });
}

// ═══════════════════════════════════════════════════════════════
// EMAILS
// ═══════════════════════════════════════════════════════════════
function sendTimeBasedOTPEmail(email, code, offsetMinutes, userName, phone) {
    const displayName = escapeHtml_(userName || 'there');
    const abs = Math.abs(offsetMinutes);
    const stepsText = abs === 1 ? '1 step' : abs + ' steps';
    const crypticLine = offsetMinutes > 0
        ? 'You are ' + stepsText + ' ahead of your time.'
        : (offsetMinutes < 0 ? 'You are ' + stepsText + ' behind your time.' : 'You are right on time.');

    const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a 0%,#0a0818 100%);border-radius:24px;border:1px solid rgba(139,92,246,.22);overflow:hidden;">
<tr><td align="center" style="padding:40px 32px 8px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="100" height="100" style="width:100px;height:100px;border-radius:50%;border:2px solid rgba(139,92,246,.4);display:block;margin:0 auto;" />
<div style="margin-top:22px;font-size:26px;font-weight:700;color:#eef0f5;">Your live token, <span style="color:#c4b5fd;">${displayName}</span></div>
</td></tr>
<tr><td align="center" style="padding:20px 32px 8px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(139,92,246,.10);border-radius:20px;border:1px solid rgba(139,92,246,.32);">
<tr><td align="center" style="padding:22px 20px 6px 20px;"><div style="font-size:11px;letter-spacing:.20em;text-transform:uppercase;color:#a78bfa;font-weight:700;">Your live token</div></td></tr>
<tr><td align="center" style="padding:12px 20px 8px 20px;"><div style="display:inline-block;font-size:52px;font-weight:800;letter-spacing:16px;color:#ffffff;font-family:'SF Mono',Menlo,monospace;padding-left:16px;-webkit-user-select:all;user-select:all;cursor:pointer;">${code}</div></td></tr>
<tr><td align="center" style="padding:6px 20px 20px 20px;"><div style="display:inline-block;font-size:12px;color:#6ee7ff;background:rgba(110,231,255,.10);border:1px solid rgba(110,231,255,.25);border-radius:20px;padding:4px 12px;">● refreshes every minute</div></td></tr>
</table>
</td></tr>
<tr><td style="padding:22px 32px 8px 32px;">
<div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6ee7ff;font-weight:600;margin-bottom:10px;">Your secret offset</div>
<div style="font-size:15px;color:#c4b5fd;font-weight:600;">${crypticLine}</div>
<div style="font-size:13px;color:#8a98b5;margin-top:10px;line-height:1.55;">Your code is based on the time shown on your device. Adjust it by your secret offset, and format the result as HHMM (12-hour clock).</div>
</td></tr>
<tr><td align="center" style="padding:26px 32px 8px 32px;">
<a href="${APP_URL}" style="display:inline-block;padding:15px 36px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 12px 32px rgba(139,92,246,.4);">Open Sandesai →</a>
</td></tr>
<tr><td align="center" style="padding:32px 32px 36px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="36" height="36" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(139,92,246,.3);display:block;margin:0 auto;" />
</td></tr>
</table></td></tr></table></body></html>`.trim();

    try {
        MailApp.sendEmail({ to: email, subject: '🔐 Your Sandesai live token', htmlBody: htmlBody, name: 'Sandesai' });
        console.log('📧 TOTP email sent to', email);
        return { ok: true };
    } catch (e) {
        console.error('sendTimeBasedOTPEmail failed:', e);
        return { ok: false, error: String(e).slice(0, 250) };
    }
}

function sendPasswordWelcomeEmail(email, userName, phone) {
    const displayName = escapeHtml_(userName || 'there');
    const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a,#0a0818);border-radius:24px;border:1px solid rgba(139,92,246,.22);overflow:hidden;">
<tr><td align="center" style="padding:40px 32px 12px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="96" height="96" style="width:96px;height:96px;border-radius:50%;border:2px solid rgba(139,92,246,.4);display:block;margin:0 auto;" />
<div style="margin-top:22px;font-size:26px;font-weight:700;color:#eef0f5;text-align:center;">Welcome, <span style="color:#c4b5fd;">${displayName}</span>!</div>
</td></tr>
<tr><td align="center" style="padding:20px 32px 8px 32px;">
<a href="${APP_URL}" style="display:inline-block;padding:15px 36px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 12px 32px rgba(139,92,246,.4);">Open Sandesai →</a>
</td></tr>
<tr><td align="center" style="padding:28px 32px 36px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="36" height="36" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(139,92,246,.3);display:block;margin:0 auto;" />
</td></tr>
</table></td></tr></table></body></html>`;
    try {
        MailApp.sendEmail({ to: email, subject: '🎉 Welcome to Sandesai', htmlBody: htmlBody, name: 'Sandesai' });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e).slice(0, 250) };
    }
}

// ═══════════════════════════════════════════════════════════════
// WELCOME LETTER
// ═══════════════════════════════════════════════════════════════
function sendWelcomeLetterEmail(email, userName, phone) {
    const name     = escapeHtml_(userName || 'friend');
    const logo     = LOGO_URL;
    const sign     = SIGN_URL;
    const appUrl   = APP_URL;
    const letterUrl = LETTER_URL + '?name=' + encodeURIComponent(userName || 'friend');

    const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:linear-gradient(180deg,#12102a 0%,#0a0818 100%);border-radius:24px;border:1px solid rgba(139,92,246,.22);overflow:hidden;box-shadow:0 40px 100px rgba(0,0,0,.55);">

<tr><td align="center" style="padding:40px 32px 8px 32px;">
<img src="${logo}" alt="Sandesai" width="84" height="84" style="width:84px;height:84px;border-radius:50%;border:2px solid rgba(139,92,246,.4);box-shadow:0 0 60px rgba(139,92,246,.5);display:block;margin:0 auto;" />
<div style="margin-top:18px;font-size:26px;font-weight:700;letter-spacing:-.02em;color:#c4b5fd;text-align:center;">Sandesai</div>
<div style="margin-top:6px;font-size:12px;color:#8a98b5;letter-spacing:.08em;text-transform:uppercase;line-height:1.5;text-align:center;">A messenger for the people we never want to lose</div>
</td></tr>

<tr><td align="center" style="padding:20px 32px 8px 32px;"><div style="height:1px;background:linear-gradient(90deg,transparent,rgba(139,92,246,.4),transparent);"></div></td></tr>

<tr><td style="padding:22px 36px 0 36px;">
<div style="font-size:21px;font-weight:700;color:#eef0f5;margin:0 0 20px;">Dear <span style="color:#c4b5fd;">${name}</span>,</div>
<p style="font-size:16px;line-height:1.75;color:#c5cfe0;margin:0 0 18px;">
Welcome to <b style="color:#c4b5fd;">Sandesai</b>. If you're reading this, it means you're
someone I've chosen to share something deeply personal with. Not a product. Not a business.
A small, honest thing I built with my own hands for the people I love most.
</p>
<p style="font-size:16px;line-height:1.75;color:#c5cfe0;margin:0 0 18px;">
Read this letter slowly. It's the only time I'll write it.
</p>
</td></tr>

<tr><td style="padding:20px 36px 0 36px;">
<div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#6ee7ff;font-weight:700;margin-bottom:14px;">What you can do inside</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td style="background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.18);border-radius:16px;padding:14px 18px;display:block;">
<div style="font-size:15px;font-weight:700;color:#eef0f5;margin-bottom:4px;">💬 Chats that are only ours</div>
<div style="font-size:14px;line-height:1.6;color:#a5b3d0;">Messages live between you and the person you're talking to. No ads. No strangers. No algorithms deciding who reaches you.</div>
</td></tr>
<tr><td style="height:10px;"></td></tr>
<tr><td style="background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.18);border-radius:16px;padding:14px 18px;display:block;">
<div style="font-size:15px;font-weight:700;color:#eef0f5;margin-bottom:4px;">🎙️ Voice &amp; video calls</div>
<div style="font-size:14px;line-height:1.6;color:#a5b3d0;">Direct, peer-to-peer and encrypted. It doesn't matter how far away someone is, or whether they've topped up their recharge — if you have their number, you can reach them.</div>
</td></tr>
<tr><td style="height:10px;"></td></tr>
<tr><td style="background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.18);border-radius:16px;padding:14px 18px;display:block;">
<div style="font-size:15px;font-weight:700;color:#eef0f5;margin-bottom:4px;">🧠 RAGina, your quiet companion</div>
<div style="font-size:14px;line-height:1.6;color:#a5b3d0;">An assistant that can help you reflect on long conversations, remember what matters, and grow alongside you.</div>
</td></tr>
<tr><td style="height:10px;"></td></tr>
<tr><td style="background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.18);border-radius:16px;padding:14px 18px;display:block;">
<div style="font-size:15px;font-weight:700;color:#eef0f5;margin-bottom:4px;">🎵 Shared moments</div>
<div style="font-size:14px;line-height:1.6;color:#a5b3d0;">Talk, laugh, listen to music together, or just sit in silence. The call remembers what you said. So do you.</div>
</td></tr>
<tr><td style="height:10px;"></td></tr>
<tr><td style="background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.18);border-radius:16px;padding:14px 18px;display:block;">
<div style="font-size:15px;font-weight:700;color:#eef0f5;margin-bottom:4px;">📌 Reminders &amp; memories</div>
<div style="font-size:14px;line-height:1.6;color:#a5b3d0;">Long calls stay. Reminders stay. Love stays. Your memories are kept safe, so a broken phone or a lost SIM doesn't take them with it.</div>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:28px 36px 0 36px;">
<div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#6ee7ff;font-weight:700;margin-bottom:14px;">Why I built this</div>
<div style="border-left:3px solid rgba(139,92,246,.5);padding-left:18px;">
<p style="font-size:15px;line-height:1.8;color:#c5cfe0;margin:0 0 14px;">
For a long time, my wife and I lived in the same city. Every evening was ours. Then one day she
went to her parents' home — and for the first time in a long while, I found myself in a quiet
room missing her voice. Not just the sound. The <b style="color:#eef0f5;">presence</b>. The long
calls that start at eleven and end at three. The laughter that jumps across silence. The silly
arguments about which song is better. The GK discussions that always ended with one of us
learning something new about the world.
</p>
<p style="font-size:15px;line-height:1.8;color:#c5cfe0;margin:0 0 14px;">
I wanted somewhere — just for us. Not a place with strangers, not a feed, not a network. A room
with two chairs. A place where we talk, laugh, listen to music, remember our calls, our reminders,
our love. A place where the memories we make are <b style="color:#eef0f5;">safe</b> — not lost to
a bad phone, a stolen SIM, a broken backup, or an outage.
</p>
<p style="font-size:15px;line-height:1.8;color:#c5cfe0;margin:0 0 14px;">
So I built Sandesai. Not because the world needed another chat app. Because <i style="color:#c4b5fd;font-style:italic;">we</i>
needed one that respected what matters.
</p>
<p style="font-size:15px;line-height:1.8;color:#c5cfe0;margin:0;">
And then I thought — if I could give this to myself, why not share it with people who have
someone they love too? If you have someone dear, someone far away, someone whose number you
know by heart, someone you'd call regardless of recharge, distance, or timezone — this is for
you. Keep that bond. Make memories. Let them be <b style="color:#eef0f5;">kept safe</b>.
</p>
</div>
</td></tr>

<tr><td style="padding:28px 36px 0 36px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
       style="background:linear-gradient(135deg,rgba(236,72,153,.10),rgba(139,92,246,.10));border:1px solid rgba(236,72,153,.25);border-radius:20px;">
<tr><td align="center" style="padding:22px 24px;text-align:center;">
<p style="font-size:17px;font-weight:700;line-height:1.5;color:#eef0f5;margin:0 0 8px;">
That's why I say —<br>
I'm your Sun <span style="color:#fbbf24;font-size:20px;">☀️</span> and you are my Summer.
</p>
<p style="font-size:14px;color:#a5b3d0;line-height:1.6;margin:0;">
And to my dear Christina, who is also Greeshma —<br>
I hope you'll love this.
</p>
</td></tr>
</table>
</td></tr>

<tr><td align="center" style="padding:30px 36px 0 36px;">
<a href="${appUrl}" style="display:inline-block;padding:15px 36px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 12px 32px rgba(139,92,246,.4);">
Open Sandesai →
</a>
<div style="margin-top:10px;font-size:12px;color:#8a98b5;text-align:center;">
or <a href="${letterUrl}" style="color:#c4b5fd;text-decoration:underline;">read the letter online</a>
</div>
</td></tr>

<tr><td align="center" style="padding:24px 36px 0 36px;">
<p style="font-size:14px;line-height:1.7;color:#a5b3d0;text-align:center;margin:0;">
If you have ideas, feedback, or just want to say hi — reply to
<a href="mailto:sandesai@gmail.com" style="color:#c4b5fd;text-decoration:underline;">sandesai@gmail.com</a>.
Every message lands in my inbox. I read them all. 🥰
</p>
</td></tr>

<tr><td align="center" style="padding:32px 36px 36px 36px;">
<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);margin-bottom:24px;"></div>
<img src="${sign}" alt="" width="130" height="130" style="width:130px;height:130px;object-fit:contain;opacity:.92;display:block;margin:0 auto 8px;" />
<div style="font-size:16px;font-weight:700;color:#eef0f5;text-align:center;">Sai Surya <span style="color:#fbbf24;">☀️</span></div>
<div style="font-size:14px;color:#8a98b5;margin:4px 0 0;text-align:center;">For Greeshma — with all my heart</div>
<div style="font-size:13px;color:#6b7a96;margin:18px 0 0;line-height:1.6;text-align:center;">
Made with <b style="color:#c4b5fd;">care</b> between two cups of chai,<br>
for the person whose voice I'd cross any distance to hear.
</div>
</td></tr>

</table>
<div style="max-width:600px;margin-top:22px;font-size:11px;color:#3d4a5f;text-align:center;line-height:1.6;">
© ${new Date().getFullYear()} Sandesai · This letter is yours alone.<br>
If it wasn't meant for you, you can safely ignore it.
</div>
</td></tr>
</table>
</body></html>`;

    try {
        MailApp.sendEmail({
            to: email,
            subject: 'A letter from Sandesai 💌',
            htmlBody: htmlBody,
            name: 'Sai Surya · Sandesai'
        });
        return true;
    } catch (e) {
        console.error('sendWelcomeLetterEmail failed:', e);
        return false;
    }
}

function buildPasswordResetEmailHtml(code, userName) {
    const name = escapeHtml_(userName || 'there');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a,#0a0818);border-radius:24px;border:1px solid rgba(139,92,246,.22);overflow:hidden;">
<tr><td align="center" style="padding:40px 32px 8px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="88" height="88" style="width:88px;height:88px;border-radius:50%;border:2px solid rgba(139,92,246,.4);display:block;margin:0 auto;" />
<div style="margin-top:22px;font-size:24px;font-weight:700;color:#eef0f5;text-align:center;">Reset your password, <span style="color:#c4b5fd;">${name}</span></div>
</td></tr>
<tr><td align="center" style="padding:24px 32px 8px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(139,92,246,.08);border-radius:20px;border:1px solid rgba(139,92,246,.28);">
<tr><td align="center" style="padding:20px 20px 6px 20px;"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#a78bfa;font-weight:600;">Your reset code</div></td></tr>
<tr><td align="center" style="padding:10px 20px 22px 20px;"><div style="display:inline-block;font-size:42px;font-weight:800;letter-spacing:12px;color:#ffffff;font-family:'SF Mono',Menlo,monospace;padding-left:12px;-webkit-user-select:all;user-select:all;cursor:pointer;">${code}</div></td></tr>
</table></td></tr>
<tr><td style="padding:20px 32px 8px 32px;"><div style="font-size:13px;color:#6b7a96;line-height:1.6;text-align:center;">⏱️ <b style="color:#a5b3d0;">Expires in 15 minutes.</b></div></td></tr>
<tr><td align="center" style="padding:22px 32px 8px 32px;">
<a href="${APP_URL}" style="display:inline-block;padding:15px 36px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 12px 32px rgba(139,92,246,.4);">Return to Sandesai →</a>
</td></tr>
<tr><td align="center" style="padding:28px 32px 36px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="32" height="32" style="width:32px;height:32px;border-radius:50%;border:1px solid rgba(139,92,246,.3);display:block;margin:0 auto 8px;" />
<div style="font-size:13px;font-weight:600;color:#a78bfa;text-align:center;">Sandesai</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

function buildUnlockEmailHtml(code, userName) {
    const name = escapeHtml_(userName || 'there');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a,#0a0818);border-radius:24px;border:1px solid rgba(110,231,255,.25);overflow:hidden;">
<tr><td align="center" style="padding:40px 32px 8px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="88" height="88" style="width:88px;height:88px;border-radius:50%;border:2px solid rgba(110,231,255,.4);display:block;margin:0 auto;" />
<div style="margin-top:22px;font-size:24px;font-weight:700;color:#eef0f5;text-align:center;">Unlock your account, <span style="color:#6ee7ff;">${name}</span></div>
</td></tr>
<tr><td align="center" style="padding:24px 32px 8px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(110,231,255,.08);border-radius:20px;border:1px solid rgba(110,231,255,.28);">
<tr><td align="center" style="padding:20px 20px 6px 20px;"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6ee7ff;font-weight:600;">Your unlock code</div></td></tr>
<tr><td align="center" style="padding:10px 20px 22px 20px;"><div style="display:inline-block;font-size:42px;font-weight:800;letter-spacing:12px;color:#ffffff;font-family:'SF Mono',Menlo,monospace;padding-left:12px;-webkit-user-select:all;user-select:all;cursor:pointer;">${code}</div></td></tr>
</table></td></tr>
<tr><td style="padding:20px 32px 8px 32px;"><div style="font-size:13px;color:#6b7a96;line-height:1.6;text-align:center;">⏱️ <b style="color:#a5b3d0;">Expires in 15 minutes.</b></div></td></tr>
<tr><td align="center" style="padding:22px 32px 8px 32px;">
<a href="${APP_URL}" style="display:inline-block;padding:15px 36px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 12px 32px rgba(139,92,246,.4);">Return to Sandesai →</a>
</td></tr>
<tr><td align="center" style="padding:28px 32px 36px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="32" height="32" style="width:32px;height:32px;border-radius:50%;border:1px solid rgba(110,231,255,.3);display:block;margin:0 auto 8px;" />
<div style="font-size:13px;font-weight:600;color:#6ee7ff;text-align:center;">Sandesai</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

function buildPasswordChangedEmailHtml(userName) {
    const name = escapeHtml_(userName || 'there');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07050e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07050e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:linear-gradient(180deg,#12102a,#0a0818);border-radius:24px;border:1px solid rgba(47,217,146,.25);overflow:hidden;">
<tr><td align="center" style="padding:40px 32px 16px 32px;">
<img src="${LOGO_URL}" alt="Sandesai" width="80" height="80" style="width:80px;height:80px;border-radius:50%;border:2px solid rgba(47,217,146,.4);display:block;margin:0 auto;" />
<div style="margin-top:20px;font-size:22px;font-weight:700;color:#eef0f5;text-align:center;">✅ Password updated</div>
<div style="margin-top:10px;font-size:14px;color:#a5b3d0;text-align:center;">Hi ${name}, your password was changed.</div>
</td></tr>
<tr><td style="padding:20px 32px 8px 32px;"><div style="font-size:13px;color:#6b7a96;line-height:1.6;text-align:center;">If this wasn't you, email <b style="color:#a78bfa;">sandesai@gmail.com</b> immediately.</div></td></tr>
<tr><td align="center" style="padding:22px 32px 36px 32px;">
<a href="${APP_URL}" style="display:inline-block;padding:13px 32px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;">Open Sandesai →</a>
</td></tr>
</table></td></tr></table></body></html>`;
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
                    '<p><b>Phone:</b> +' + escapeHtml_(phone) + '</p>' +
                    '<p><b>Email:</b> ' + escapeHtml_(email || '—') + '</p>' +
                    (extraHtml || '') +
                '</div>'
        });
    } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════
// USER LOOKUPS
// ═══════════════════════════════════════════════════════════════
function findUserByPhone(phone) {
    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return null;
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        const stored = String(data[i][2] || '').replace(/\D/g, '');
        if (!stored) continue;
        if (stored === digits) return rowToUser_(data[i], i + 1);
        if (stored.length === 10 && ('91' + stored) === digits) return rowToUser_(data[i], i + 1);
        if (digits.length === 10 && stored === '91' + digits)      return rowToUser_(data[i], i + 1);
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
        row: row, name: r[0] || '', username: r[1] || '',
        phone: String(r[2] || ''), email: String(r[3] || ''),
        createdAt: r[4], lastLogin: r[5], uid: r[6] || '',
        status: String(r[7] || 'active'),
        authMethod: String(r[8] || 'totp'),
        passwordHash: String(r[9] || ''),
        timeOffset: Number(r[10]) || 0,
        countryCode: String(r[11] || '91'),
        salt: String(r[12] || '')
    };
}

function checkAvailability(body) {
    const phone    = normalizePhone_(body.countryCode, body.phone);
    const username = String(body.username || '').trim();
    const result = { ok: true, version: CODE_VERSION };
    if (phone)    result.phoneAvailable = !findUserByPhone(phone);
    if (username) {
        const byUser = findUserByUsername(username);
        result.usernameAvailable = !byUser || (!!phone && byUser.phone === phone);
    }
    return jsonResponse(result);
}

// ═══════════════════════════════════════════════════════════════
// DELETE, PUSH, SESSIONS, USERS
// ═══════════════════════════════════════════════════════════════
function deleteAccount(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const token = String(body.token || '').trim();
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!token) return jsonResponse({ ok: false, error: 'no_token', message: 'Session token required.' });
    if (!verifySessionForPhone_(phone, token)) {
        return jsonResponse({ ok: false, error: 'invalid_session',
            message: 'Please log in again to delete your account.' });
    }

    const existing = findUserByPhone(phone);
    if (!existing) return jsonResponse({ ok: false, error: 'not_found' });

    const suppliedUid = String(body.uid || '').trim();
    if (existing.uid && suppliedUid && suppliedUid !== existing.uid) {
        return jsonResponse({ ok: false, error: 'uid_mismatch', message: 'Verification failed.' });
    }

    const usersDeleted    = deleteRowsWhere_(REGISTRATIONS_SHEET, 2, existing.phone);
    const convDeleted     = deleteRowsWhere_(CONVERSATIONS_SHEET, 1, existing.phone);
    const tokensDeleted   = deleteRowsWhere_(PUSH_TOKENS_SHEET, 1, existing.phone);
    const sessionsDeleted = deleteRowsWhere_(SESSIONS_SHEET, 0, existing.phone);

    try {
        const props = PropertiesService.getScriptProperties();
        ['otp_','otprate_','otpok_','otpemail_','pwreset_','pwresetrate_','resendrate_',
         'totpfail_','totpunlock_','totpunlockrate_','pendingoffset_','welcomeletter_sent_']
        .forEach(function (prefix) { props.deleteProperty(prefix + existing.phone); });
    } catch (e) {}

    notifyAdmin_('🗑️ Account deleted: ' + (existing.name || phone), '🗑️ Account deleted', '#ef4444',
        existing.name, existing.username, existing.phone, existing.email, '');

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

function registerPushToken(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
    const token = String(body.token || '').trim();
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
    const phone = normalizePhone_(body.countryCode, body.phone);
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

function registerSession(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone  = normalizePhone_(body.countryCode, body.phone);
    const token  = String(body.token || '').trim();
    const device = String(body.device || 'web').trim().slice(0, 120);
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    if (!token || token.length < 16) return jsonResponse({ ok: false, error: 'invalid_token' });

    const sheet = getSheet(SESSIONS_SHEET);
    if (!sheet) return jsonResponse({ ok: false, error: 'no_sessions_sheet' });

    const hash = hashCode_(phone, token);
    const now  = Date.now();
    const expiresIso = new Date(now + SESSION_TTL_MS).toISOString();
    const nowIso     = new Date(now).toISOString();

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === phone && String(data[i][1]) === hash) {
            sheet.getRange(i + 1, 5, 1, 2).setValues([[nowIso, expiresIso]]);
            return jsonResponse({ ok: true, version: CODE_VERSION, refreshed: true });
        }
    }
    sheet.appendRow([phone, hash, device, nowIso, nowIso, expiresIso]);
    return jsonResponse({ ok: true, version: CODE_VERSION, created: true });
}

function verifySession(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
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

            withLock_(function () {
                try {
                    const props = PropertiesService.getScriptProperties();
                    const sentKey = 'welcomeletter_sent_' + phone;
                    if (!props.getProperty(sentKey)) {
                        const user = findUserByPhone(phone);
                        if (user && user.email && EMAIL_RE.test(user.email)) {
                            const ok = sendWelcomeLetterEmail(user.email, user.name, phone);
                            if (ok) {
                                props.setProperty(sentKey, String(Date.now()));
                                console.log('💌 Welcome letter sent on first login to ' + user.email);
                            }
                        } else {
                            props.setProperty(sentKey, String(Date.now()));
                        }
                    }
                } catch (e) { console.error('First-login welcome failed:', e); }
            });

            return jsonResponse({ ok: true, version: CODE_VERSION, valid: true });
        }
    }
    return jsonResponse({ ok: false, error: 'not_found' });
}

function removeSession(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    const phone = normalizePhone_(body.countryCode, body.phone);
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

function readUsers() {
    const sheet = getSheet(REGISTRATIONS_SHEET);
    if (!sheet) return [];
    return sheet.getDataRange().getValues().slice(1).map(function (r) {
        return {
            name: r[0] || '', username: r[1] || '', phone: String(r[2] || ''), email: String(r[3] || ''),
            createdAt: toMillis_(r[4]), lastLogin: toMillis_(r[5]), uid: r[6] || '',
            status: String(r[7] || 'active'), authMethod: String(r[8] || 'totp'),
            countryCode: String(r[11] || '91')
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

function logConversation(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, version: CODE_VERSION, error: 'invalid secret' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(CONVERSATIONS_SHEET);
    if (!sheet) {
        sheet = ss.insertSheet(CONVERSATIONS_SHEET);
        sheet.appendRow(['Timestamp', 'Session ID', 'Email', 'Query', 'Answer', 'Feedback', 'Source']);
    }
    sheet.appendRow([
        new Date().toISOString(),
        body.sessionId || '', body.email || '', body.query || '',
        body.answer || '', body.feedback || '', body.source || 'concierge'
    ]);
    return jsonResponse({ ok: true, version: CODE_VERSION, row: sheet.getLastRow() });
}

function readConversations() {
    const sheet = getSheet(CONVERSATIONS_SHEET);
    if (!sheet) return [];
    return sheet.getDataRange().getValues().slice(1).map(function (r) {
        return {
            timestamp: toMillis_(r[0]), sessionId: String(r[1] || ''), email: String(r[2] || ''),
            query: String(r[3] || ''), answer: String(r[4] || ''), feedback: String(r[5] || ''), source: String(r[6] || '')
        };
    });
}

function readUserConversations(phone, limit) {
    const rows = readConversations().filter(function (c) { return c.sessionId === phone; });
    rows.sort(function (a, b) { return a.timestamp - b.timestamp; });
    return rows.slice(-1 * limit);
}

// ═══════════════════════════════════════════════════════════════
// OTP HELPERS
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
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });

    const country = String(body.countryCode || '91').replace(/\D/g, '');
    const pv = validatePhoneForCountry_(country, body.phone);
    if (!pv.ok) return jsonResponse({ ok: false, error: pv.error, message: pv.message });
    const phone = pv.full;

    const email = String(body.email || '').trim();
    if (!EMAIL_RE.test(email)) return jsonResponse({ ok: false, error: 'invalid_email' });

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
        if (rate.count >= OTP_RATE_PER_HR) return { ok: false, error: 'too_many_requests' };
        props.setProperty('otp_' + phone, JSON.stringify({
            hash: hashCode_(phone, code), email: email, expiresAt: expiresAt, tries: 0, createdAt: now
        }));
        props.setProperty('otpemail_' + phone, email);
        rate.count++; rate.lastAt = now;
        props.setProperty(rateKey, JSON.stringify(rate));
        return { ok: true };
    });
    if (!gate.ok) return jsonResponse(gate);

    try {
        MailApp.sendEmail({
            to: email,
            subject: '🔐 Your Sandesai verification code',
            htmlBody: '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:32px 24px;background:#0f0d24;color:#eef0f5;border-radius:16px;">' +
                        '<img src="' + LOGO_URL + '" width="72" height="72" style="border-radius:50%;display:block;margin:0 auto 12px;" />' +
                        '<h1 style="font-size:22px;text-align:center;color:#a78bfa;">Sandesai</h1>' +
                        '<div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;background:rgba(139,92,246,0.15);border-radius:12px;padding:20px 12px;color:#fff;margin:20px 0;-webkit-user-select:all;user-select:all;cursor:pointer;">' + code + '</div>' +
                        '<p style="color:#7a89a8;font-size:13px;text-align:center;">This code expires in 10 minutes.</p>' +
                        '<div style="text-align:center;margin-top:20px;"><a href="' + APP_URL + '" style="display:inline-block;padding:14px 30px;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-weight:700;text-decoration:none;">Open Sandesai →</a></div>' +
                      '</div>'
        });
    } catch (e) {
        props.deleteProperty('otp_' + phone);
        return jsonResponse({ ok: false, error: 'email_failed' });
    }

    const parts = email.split('@');
    const masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return jsonResponse({ ok: true, version: CODE_VERSION, sentTo: masked, expiresAt: expiresAt });
}

function verifyOtp(body) {
    if (SECRET && body.secret !== SECRET) return jsonResponse({ ok: false, error: 'invalid secret' });
    return _verifyOtpCore(
        normalizePhone_(body.countryCode, body.phone),
        String(body.code || '').trim()
    );
}

function _verifyOtpCore(phone, code) {
    if (!PHONE_E164_RE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });
    return withLock_(function () {
        const props = PropertiesService.getScriptProperties();
        const key = 'otp_' + phone;
        const raw = props.getProperty(key);
        if (!raw) return jsonResponse({ ok: false, error: 'no_otp', message: 'Request a new code.' });
        let otp;
        try { otp = JSON.parse(raw); }
        catch (e) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'corrupt_otp' }); }
        if (Date.now() > otp.expiresAt) { props.deleteProperty(key); return jsonResponse({ ok: false, error: 'expired' }); }
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
        props.deleteProperty(key);
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
            } else if (k.indexOf('otprate_') === 0 || k.indexOf('pwresetrate_') === 0 || k.indexOf('resendrate_') === 0 || k.indexOf('totpunlockrate_') === 0) {
                if (JSON.parse(all[k]).resetAt < now) { props.deleteProperty(k); cleaned++; }
            } else if (k.indexOf('pwreset_') === 0 || k.indexOf('totpunlock_') === 0) {
                if (JSON.parse(all[k]).expiresAt < now) { props.deleteProperty(k); cleaned++; }
            } else if (k.indexOf('pendingoffset_') === 0) {
                if (JSON.parse(all[k]).expiresAt < now) { props.deleteProperty(k); cleaned++; }
            } else if (k.indexOf('totpfail_') === 0) {
                const s = JSON.parse(all[k]);
                if (s.lockedUntil && s.lockedUntil < now && now - s.firstFailAt > TOTP_FAIL_WINDOW) {
                    props.deleteProperty(k); cleaned++;
                }
            }
        } catch (e) { props.deleteProperty(k); cleaned++; }
    });
    Logger.log('cleanupOtps → props:' + cleaned);
    return cleaned;
}

// ═══════════════════════════════════════════════════════════════
// MANUAL HELPERS
// ═══════════════════════════════════════════════════════════════
function authTest() {
    MailApp.sendEmail(Session.getActiveUser().getEmail(), 'Sandesai mail test', 'MailApp authorized. Quota: ' + safeMailQuota_());
    Logger.log('Mail OK. Quota: ' + safeMailQuota_());
}

function runMigrationNow() {
    resetSchemaFlag();
    ensureSchema_();
    Logger.log('Migration complete. Users: ' + countUsers());
}

function forceSendWelcomeNow(phone) {
    const user = findUserByPhone(String(phone || '').trim());
    if (!user || !user.email) { Logger.log('No user/email for ' + phone); return; }
    const ok = sendWelcomeLetterEmail(user.email, user.name, user.phone);
    Logger.log('Force-sent welcome letter: ' + ok);
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
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON)
        .setHeaders({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
}