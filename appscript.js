// ═══════════════════════════════════════════════════════════════
// Sandesai Apps Script · v10-schema-sessions
//
// Endpoints
//   GET  ?type=health | business | knowledge
//   GET  ?type=sendOtp&phone=…&email=…&secret=…
//   GET  ?type=checkOtp&phone=…&code=…
//   GET  ?type=checkAvailability&phone=…&username=…
//   GET  ?type=userConversations&phone=…
//   GET  ?pass=…[&type=conversations|pushTokens|sessions|users]
//   POST {type: conversation | sendOtp | verifyOtp | checkAvailability |
//               deleteAccount | registerPushToken | removePushToken |
//               registerSession | verifySession | removeSession}
//   POST {…registration…}                            (default)
//
// Changes vs v9
//   • Sheet1 schema: Name|Username|Phone|Email|Created At|Last Login|UID|Status
//     Auto-migration from the old 5-column layout, with phone-based dedupe.
//   • Created At is preserved on re-registration; Last Login is updated.
//   • Indian mobile validation (/^[6-9]\d{9}$/) for new sign-ups.
//   • deleteAccount removes EVERY row for that phone, not just the first.
//   • deleteAccount now REQUIRES a matching UID when one is stored.
//   • OTPs sheet gains a Verified At column + 7-day auto-purge.
//   • New Sessions sheet + registerSession / verifySession / removeSession.
//   • Email captured at registration (and backfilled from the OTP record).
//   • checkAvailability / sendOtp still work over GET (readable responses).
// ═══════════════════════════════════════════════════════════════

const CODE_VERSION = 'v10-schema-sessions';

// ── App versioning ──
const APP_VERSION     = '0.5';
const MIN_APP_VERSION = '0.4';
const UPDATE_MESSAGE  = 'A new version of Sandesai is available. Please refresh to continue.';

// ── Sheets ──
const REGISTRATIONS_SHEET = 'Sheet1';
const BUSINESS_SHEET      = 'Business';
const KNOWLEDGE_SHEET     = 'Knowledge';
const CONVERSATIONS_SHEET = 'Conversations';
const OTP_SHEET           = 'OTPs';
const PUSH_TOKENS_SHEET   = 'PushTokens';
const SESSIONS_SHEET      = 'Sessions';

const REG_HEADERS     = ['Name', 'Username', 'Phone', 'Email', 'Created At', 'Last Login', 'UID', 'Status'];
const OTP_HEADERS     = ['Timestamp', 'Phone', 'Email', 'Code', 'Expires At', 'Email Status', 'Error', 'Verified At'];
const SESSION_HEADERS = ['Phone', 'Token Hash', 'Device', 'Created', 'Last Seen', 'Expires'];

const NOTIFY_EMAIL   = 'sandesaiapp@gmail.com';
const SECRET         = 'sandesai-webhook-2026';
const ADMIN_PASSWORD = 'sandesai-admin-2026';

// ── Validation ──
const PHONE_RE    = /^[6-9]\d{9}$/;              // Indian mobile
const PHONE_LOOSE = /^\d{10}$/;                  // legacy / cleanup paths
const EMAIL_RE    = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

// ── OTP config ──
const OTP_TTL_MS          = 10 * 60 * 1000;
const OTP_VERIFIED_TTL_MS = 30 * 60 * 1000;
const OTP_MAX_TRIES       = 5;
const OTP_RATE_PER_HR     = 5;
const OTP_MIN_GAP_MS      = 30 * 1000;
const OTP_RETENTION_DAYS  = 7;

// ── Session config ──
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const REQUIRE_OTP_FOR_REGISTRATION = true;

const SCHEMA_FLAG = 'schema_v10_done';

// ═══════════════════════════════════════════════════════════════
// POST
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
            case 'conversation':      return logConversation(body);
            case 'sendOtp':           return sendOtp(body);
            case 'verifyOtp':         return verifyOtp(body);
            case 'checkOtp':          return verifyOtp(body);
            case 'checkAvailability': return checkAvailability(body);
            case 'deleteAccount':     return deleteAccount(body);
            case 'registerPushToken': return registerPushToken(body);
            case 'removePushToken':   return removePushToken(body);
            case 'registerSession':   return registerSession(body);
            case 'verifySession':     return verifySession(body);
            case 'removeSession':     return removeSession(body);
            case 'registration':
            case 'register':
            default:                  return logRegistration(body);
        }
    } catch (err) {
        return jsonResponse({ ok: false, version: CODE_VERSION, error: String(err) });
    }
}

// ═══════════════════════════════════════════════════════════════
// GET
// ═══════════════════════════════════════════════════════════════
function doGet(e) {
    ensureSchema_();

    const params = (e && e.parameter) ? e.parameter : {};
    const type = String(params.type || 'users').toLowerCase();

    // ─── PUBLIC ───
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

    if (type === 'sendotp') {
        return sendOtp({
            secret: params.secret,
            phone:  params.phone,
            email:  params.email
        });
    }
    if (type === 'checkotp') return _verifyOtpCore(String(params.phone || '').trim(), String(params.code || '').trim());

    if (type === 'checkavailability') {
        return checkAvailability({ phone: params.phone, username: params.username });
    }

    // ─── PER-USER ───
    if (type === 'userconversations') {
        const phone = String(params.phone || '').trim();
        const limit = Math.min(parseInt(params.limit || '20', 10) || 20, 100);
        if (!phone) {
            return jsonResponse({ ok: false, version: CODE_VERSION, error: 'phone required' });
        }
        return jsonResponse({
            ok: true,
            version: CODE_VERSION,
            conversations: readUserConversations(phone, limit)
        });
    }

    // ─── ADMIN ───
    const pass = String(params.pass || '');
    if (pass !== ADMIN_PASSWORD) {
        return jsonResponse({
            ok: false,
            version: CODE_VERSION,
            error: 'forbidden',
            debug: { receivedType: type, receivedPass: pass ? '(set)' : '(empty)' }
        });
    }

    if (type === 'conversations') {
        return jsonResponse({ ok: true, version: CODE_VERSION, conversations: readConversations() });
    }
    if (type === 'pushtokens') {
        return jsonResponse({ ok: true, version: CODE_VERSION, tokens: readPushTokens() });
    }
    if (type === 'sessions') {
        return jsonResponse({ ok: true, version: CODE_VERSION, sessions: readSessions() });
    }
    if (type === 'maintenance') {
        return jsonResponse({
            ok: true,
            version: CODE_VERSION,
            otpRowsPurged: purgeOldOtpRows_(),
            sessionsPurged: purgeExpiredSessions_(),
            propertyKeysCleaned: cleanupOtps(),
            duplicatesRemoved: dedupeAllRegistrations_()
        });
    }

    return jsonResponse({ ok: true, version: CODE_VERSION, users: readUsers() });
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA MIGRATION
// ═══════════════════════════════════════════════════════════════
function ensureSchema_() {
    try {
        const props = PropertiesService.getScriptProperties();
        if (props.getProperty(SCHEMA_FLAG) === '1') return;
        migrateRegistrationsSheet_();
        migrateOtpSheet_();
        ensureSessionsSheet_();
        props.setProperty(SCHEMA_FLAG, '1');
    } catch (e) {
        console.error('ensureSchema_ failed:', e);
    }
}

// Run once manually if you ever need to force the migration to run again.
function resetSchemaFlag() {
    PropertiesService.getScriptProperties().deleteProperty(SCHEMA_FLAG);
    Logger.log('Schema flag cleared — migration will run on the next request.');
}

function migrateRegistrationsSheet_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(REGISTRATIONS_SHEET);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    const headers = (data[0] || []).map(function (h) { return String(h || '').trim(); });

    // Already new schema?
    if (headers[0] === 'Name' && headers[3] === 'Email' && headers[4] === 'Created At') return;

    const hasOldData = data.length > 1 && data.slice(1).some(function (r) {
        return String(r[2] || '').trim();
    });

    // Empty sheet — just write the new header
    if (!hasOldData) {
        sheet.clearContents();
        sheet.getRange(1, 1, 1, REG_HEADERS.length).setValues([REG_HEADERS]);
        return;
    }

    // Old layout: Name | Username | Phone | Registered At | UID
    const byPhone = {};
    const order = [];

    for (let i = 1; i < data.length; i++) {
        const r = data[i];
        const phone = String(r[2] || '').trim();
        if (!phone) continue;

        const createdMs = toMillis_(r[3]);
        const name   = String(r[0] || '').trim();
        const uname  = String(r[1] || '').trim();
        const uid    = String(r[4] || '').trim();

        if (!byPhone[phone]) {
            byPhone[phone] = {
                name: name, username: uname, phone: phone, email: '',
                createdAt: createdMs, lastLogin: createdMs, uid: uid, status: 'active'
            };
            order.push(phone);
        } else {
            const rec = byPhone[phone];
            if (name)  rec.name = name;             // keep the latest non-empty
            if (uname) rec.username = uname;
            if (uid)   rec.uid = uid;
            if (createdMs && (!rec.createdAt || createdMs < rec.createdAt)) rec.createdAt = createdMs;
            if (createdMs && createdMs > rec.lastLogin) rec.lastLogin = createdMs;
        }
    }

    const rows = order.map(function (phone) {
        const u = byPhone[phone];
        return [
            u.name,
            u.username,
            u.phone,
            u.email,
            u.createdAt ? new Date(u.createdAt).toISOString() : '',
            u.lastLogin ? new Date(u.lastLogin).toISOString() : '',
            u.uid,
            u.status
        ];
    });

    sheet.clearContents();
    sheet.getRange(1, 1, 1, REG_HEADERS.length).setValues([REG_HEADERS]);
    if (rows.length) {
        sheet.getRange(2, 1, rows.length, REG_HEADERS.length).setValues(rows);
    }

    console.log('✅ Sheet1 migrated. Unique users kept:', rows.length);
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
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
        return String(h || '').trim();
    });
    if (headers.indexOf('Verified At') !== -1) return;
    sheet.getRange(1, headers.length + 1).setValue('Verified At');
    console.log('✅ OTPs sheet: added "Verified At" column.');
}

function ensureSessionsSheet_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SESSIONS_SHEET);
    if (!sheet) {
        sheet = ss.insertSheet(SESSIONS_SHEET);
        sheet.getRange(1, 1, 1, SESSION_HEADERS.length).setValues([SESSION_HEADERS]);
        console.log('✅ Sessions sheet created.');
    }
}

// ═══════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════
function logRegistration(body) {
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, version: CODE_VERSION, error: 'invalid secret' });
    }

    const name     = String(body.name || '').trim();
    const username = String(body.username || '').trim();
    const phone    = String(body.phone || '').trim();
    const uid      = String(body.uid || '').trim();
    let   email    = String(body.email || '').trim();

    if (!PHONE_RE.test(phone)) {
        return jsonResponse({
            ok: false,
            error: 'invalid_phone',
            message: 'Enter a valid 10-digit Indian mobile number (starts with 6–9).'
        });
    }
    if (!USERNAME_RE.test(username)) {
        return jsonResponse({
            ok: false,
            error: 'invalid_username',
            message: 'Username must be 3–20 letters, numbers, underscore or dot.'
        });
    }

    // Registration must follow a verified OTP for this phone
    if (REQUIRE_OTP_FOR_REGISTRATION && !consumeOtpVerified_(phone)) {
        return jsonResponse({
            ok: false,
            error: 'otp_not_verified',
            message: 'Verify your email OTP before registering.'
        });
    }

    // Backfill email from the OTP record if the client didn't send one
    if (!email) {
        try {
            const props = PropertiesService.getScriptProperties();
            const cached = props.getProperty('otpemail_' + phone);
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
        return jsonResponse({
            ok: false,
            error: 'username_taken',
            message: 'Username "' + username + '" is already taken. Please choose another.'
        });
    }

    const nowIso = new Date().toISOString();

    // ── Re-registration (possibly with stale duplicate rows) ──
    if (phoneRows.length) {
        // Delete everything below the first match (bottom-up so indices stay valid)
        for (let i = phoneRows.length - 1; i >= 1; i--) sheet.deleteRow(phoneRows[i]);

        const keepRow = phoneRows[0];
        const cur = sheet.getRange(keepRow, 1, 1, REG_HEADERS.length).getValues()[0];

        const createdAtIso = isoOrEmpty_(cur[4]) || nowIso;   // preserve original signup
        const existingEmail = String(cur[3] || '');
        const existingUid   = String(cur[6] || '');

        sheet.getRange(keepRow, 1, 1, REG_HEADERS.length).setValues([[
            name || cur[0] || '',
            username,
            phone,
            email || existingEmail,
            createdAtIso,
            nowIso,                       // Last Login
            uid || existingUid,
            'active'
        ]]);

        notifyAdmin_(
            '🔄 Sandesai user re-registered: ' + (name || phone),
            '🔄 Re-registration', '#a78bfa',
            name, username, phone, email,
            '<p style="color:#7a89a8;font-size:13px;margin-top:16px;">' +
                'Duplicates removed: ' + (phoneRows.length - 1) +
            '</p>'
        );

        return jsonResponse({
            ok: true,
            version: CODE_VERSION,
            updated: true,
            row: keepRow,
            duplicatesRemoved: phoneRows.length - 1
        });
    }

    // ── New user ──
    sheet.appendRow([name, username, phone, email, nowIso, nowIso, uid, 'active']);
    notifyAdmin_(
        '🎉 New Sandesai user: ' + (name || phone),
        '🎉 New registration', '#a78bfa',
        name, username, phone, email, ''
    );

    return jsonResponse({ ok: true, version: CODE_VERSION, created: true, row: sheet.getLastRow() });
}

function notifyAdmin_(subject, heading, color, name, username, phone, email, extraHtml) {
    try {
        MailApp.sendEmail({
            to: NOTIFY_EMAIL,
            subject: subject,
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
    } catch (e) {
        console.error('notifyAdmin_ failed:', e);
    }
}

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
        status: String(r[7] || 'active')
    };
}

function checkAvailability(body) {
    const phone    = String(body.phone || '').trim();
    const username = String(body.username || '').trim();
    const result = { ok: true, version: CODE_VERSION };

    if (phone) {
        result.phoneAvailable = !findUserByPhone(phone);
    }
    if (username) {
        const byUser = findUserByUsername(username);
        // A user's own username (same phone) still counts as available
        result.usernameAvailable = !byUser || (!!phone && byUser.phone === phone);
    }
    return jsonResponse(result);
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNT DELETION
// ═══════════════════════════════════════════════════════════════
function deleteAccount(body) {
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, error: 'invalid secret' });
    }

    const phone = String(body.phone || '').trim();
    if (!PHONE_LOOSE.test(phone)) {
        return jsonResponse({ ok: false, error: 'invalid_phone' });
    }

    const existing = findUserByPhone(phone);
    if (!existing) {
        return jsonResponse({ ok: false, error: 'not_found', message: 'No account found for +91 ' + phone });
    }

    // UID is now REQUIRED when we have one on file
    const suppliedUid = String(body.uid || '').trim();
    if (existing.uid) {
        if (!suppliedUid) {
            return jsonResponse({
                ok: false,
                error: 'uid_required',
                message: 'Please sign in again and retry — we could not verify this device.'
            });
        }
        if (suppliedUid !== existing.uid) {
            return jsonResponse({ ok: false, error: 'uid_mismatch', message: 'Verification failed.' });
        }
    }

    // Remove EVERY row for this phone, not just the first
    const usersDeleted   = deleteRowsWhere_(REGISTRATIONS_SHEET, 2, phone);
    const convDeleted    = deleteRowsWhere_(CONVERSATIONS_SHEET, 1, phone);
    const tokensDeleted  = deleteRowsWhere_(PUSH_TOKENS_SHEET, 1, phone);
    const sessionsDeleted = deleteRowsWhere_(SESSIONS_SHEET, 0, phone);

    try {
        const props = PropertiesService.getScriptProperties();
        props.deleteProperty('otp_' + phone);
        props.deleteProperty('otprate_' + phone);
        props.deleteProperty('otpok_' + phone);
        props.deleteProperty('otpemail_' + phone);
    } catch (e) {}

    notifyAdmin_(
        '🗑️ Account deleted: ' + (existing.name || phone),
        '🗑️ Account deleted', '#ef4444',
        existing.name, existing.username, phone, existing.email,
        '<p style="color:#7a89a8;font-size:13px;margin-top:16px;">' +
            'User rows deleted: ' + usersDeleted + '<br>' +
            'Conversations deleted: ' + convDeleted + '<br>' +
            'Push tokens deleted: ' + tokensDeleted + '<br>' +
            'Sessions deleted: ' + sessionsDeleted +
        '</p>'
    );

    return jsonResponse({
        ok: true,
        version: CODE_VERSION,
        deleted: {
            user: usersDeleted,
            conversations: convDeleted,
            pushTokens: tokensDeleted,
            sessions: sessionsDeleted
        },
        message: 'Account deleted successfully.'
    });
}

// Delete every row whose column `colIdx` equals `value` (bottom-up). Returns count.
function deleteRowsWhere_(sheetName, colIdx, value) {
    const sheet = getSheet(sheetName);
    if (!sheet) return 0;
    const data = sheet.getDataRange().getValues();
    let n = 0;
    for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][colIdx]) === String(value)) {
            sheet.deleteRow(i + 1);
            n++;
        }
    }
    return n;
}

// ═══════════════════════════════════════════════════════════════
// PUSH TOKENS
// ═══════════════════════════════════════════════════════════════
function registerPushToken(body) {
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, error: 'invalid secret' });
    }

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
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, error: 'invalid secret' });
    }
    const phone = String(body.phone || '').trim();
    if (!PHONE_LOOSE.test(phone)) return jsonResponse({ ok: false, error: 'invalid_phone' });

    const deleted = deleteRowsWhere_(PUSH_TOKENS_SHEET, 1, phone);
    return jsonResponse({ ok: true, version: CODE_VERSION, removed: deleted });
}

function readPushTokens() {
    const sheet = getSheet(PUSH_TOKENS_SHEET);
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    return data.slice(1).map(function (r) {
        return {
            timestamp: toMillis_(r[0]),
            phone: String(r[1] || ''),
            token: String(r[2] || ''),
            platform: String(r[3] || 'web')
        };
    });
}

function countPushTokens() {
    try { return readPushTokens().length; } catch (e) { return 0; }
}

// ═══════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════
function registerSession(body) {
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, error: 'invalid secret' });
    }

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
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, error: 'invalid secret' });
    }

    const phone = String(body.phone || '').trim();
    const token = String(body.token || '').trim();
    if (!PHONE_LOOSE.test(phone) || !token) {
        return jsonResponse({ ok: false, error: 'invalid_request' });
    }

    const sheet = getSheet(SESSIONS_SHEET);
    if (!sheet) return jsonResponse({ ok: false, error: 'no_sessions_sheet' });

    const hash = hashCode_(phone, token);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][1]) === hash && String(data[i][0]) === phone) {
            const expires = toMillis_(data[i][5]);
            if (expires && Date.now() > expires) {
                sheet.deleteRow(i + 1);
                return jsonResponse({ ok: false, error: 'expired', message: 'Session expired. Please sign in again.' });
            }
            sheet.getRange(i + 1, 5).setValue(new Date().toISOString());
            return jsonResponse({ ok: true, version: CODE_VERSION, valid: true });
        }
    }

    return jsonResponse({ ok: false, error: 'not_found', message: 'Session not recognised.' });
}

function removeSession(body) {
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, error: 'invalid secret' });
    }

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
            phone: String(r[0] || ''),
            tokenHash: String(r[1] || ''),
            device: String(r[2] || ''),
            created: toMillis_(r[3]),
            lastSeen: toMillis_(r[4]),
            expires: toMillis_(r[5])
        };
    }).filter(function (s) { return s.phone; });
}

function countSessions() {
    try { return readSessions().length; } catch (e) { return 0; }
}

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
    const data = sheet.getDataRange().getValues();
    return data.slice(1).map(function (r) {
        return {
            name: r[0] || '',
            username: r[1] || '',
            phone: String(r[2] || ''),
            email: String(r[3] || ''),
            createdAt: toMillis_(r[4]),
            lastLogin: toMillis_(r[5]),
            uid: r[6] || '',
            status: String(r[7] || 'active')
        };
    }).filter(function (u) { return u.phone; });
}

function countUsers() {
    try { return readUsers().length; } catch (e) { return 0; }
}

// Manual / maintenance helper: collapse duplicate phones in Sheet1.
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
// CONCIERGE
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
    const data = sheet.getDataRange().getValues();
    return data.slice(1).map(function (r) {
        return {
            question: String(r[0] || '').trim(),
            answer: String(r[1] || '').trim(),
            category: String(r[2] || '').trim()
        };
    }).filter(function (k) { return k.question && k.answer; });
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════════════════════════
function logConversation(body) {
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, version: CODE_VERSION, error: 'invalid secret' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(CONVERSATIONS_SHEET);

    if (!sheet) {
        sheet = ss.insertSheet(CONVERSATIONS_SHEET);
        sheet.appendRow(['Timestamp', 'Session ID', 'Email', 'Query', 'Answer', 'Feedback', 'Source']);
    } else {
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        if (headers.indexOf('Source') === -1) {
            sheet.getRange(1, headers.length + 1).setValue('Source');
        }
    }

    sheet.appendRow([
        new Date().toISOString(),
        body.sessionId || '',
        body.email || '',
        body.query || '',
        body.answer || '',
        body.feedback || '',
        body.source || 'concierge'
    ]);

    return jsonResponse({ ok: true, version: CODE_VERSION, row: sheet.getLastRow() });
}

function rowToConversation_(r) {
    return {
        timestamp: toMillis_(r[0]),
        sessionId: String(r[1] || ''),
        email: String(r[2] || ''),
        query: String(r[3] || ''),
        answer: String(r[4] || ''),
        feedback: String(r[5] || ''),
        source: String(r[6] || '')
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
// OTP
// ═══════════════════════════════════════════════════════════════
function hashCode_(phone, code) {
    const bytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        SECRET + '|' + phone + '|' + code
    );
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
        return jsonResponse({
            ok: false,
            error: 'invalid_phone',
            message: 'Enter a valid 10-digit Indian mobile number (starts with 6–9).'
        });
    }
    if (!EMAIL_RE.test(email)) {
        return jsonResponse({ ok: false, error: 'invalid_email', message: 'Enter a valid email.' });
    }

    const props   = PropertiesService.getScriptProperties();
    const rateKey = 'otprate_' + phone;
    const now     = Date.now();
    const code    = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = now + OTP_TTL_MS;

    // ── Rate limit + store code (atomic) ──
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
            return { ok: false, error: 'too_many_requests', message: 'Too many OTP requests. Try again in ' + m + ' min.' };
        }

        props.setProperty('otp_' + phone, JSON.stringify({
            hash: hashCode_(phone, code),
            email: email,
            expiresAt: expiresAt,
            tries: 0,
            createdAt: now
        }));
        props.setProperty('otpemail_' + phone, email);
        rate.count++;
        rate.lastAt = now;
        props.setProperty(rateKey, JSON.stringify(rate));
        return { ok: true };
    });

    if (!gate.ok) return jsonResponse(gate);

    // ── Audit log first (code is NOT stored) ──
    let logRowIndex = -1;
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet = ss.getSheetByName(OTP_SHEET);
        if (!sheet) {
            sheet = ss.insertSheet(OTP_SHEET);
            sheet.getRange(1, 1, 1, OTP_HEADERS.length).setValues([OTP_HEADERS]);
        }
        sheet.appendRow([
            new Date().toISOString(), phone, email, '••••••',
            new Date(expiresAt).toISOString(), 'pending', '', ''
        ]);
        logRowIndex = sheet.getLastRow();
    } catch (e) {
        console.error('Audit log failed:', e);
    }

    // ── Send email ──
    let emailStatus = 'sent';
    let emailError  = '';
    try {
        MailApp.sendEmail({
            to: email,
            subject: '🔐 Your Sandesai verification code',
            htmlBody:
                '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:32px 24px;background:#0f0d24;color:#eef0f5;border-radius:16px;">' +
                    '<h1 style="font-size:22px;margin:0 0 12px;color:#a78bfa;">Sandesai</h1>' +
                    '<p style="color:#a5b3d0;font-size:14px;margin:0 0 20px;">Use this code to verify your account:</p>' +
                    '<div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:12px;padding:20px 12px;color:#fff;margin:0 0 20px;">' +
                        code +
                    '</div>' +
                    '<p style="color:#7a89a8;font-size:13px;margin:0;">This code expires in <b style="color:#c4b5fd;">10 minutes</b>.</p>' +
                    '<p style="color:#5a6885;font-size:12px;margin:20px 0 0;">If you didn\'t request this, ignore this email.</p>' +
                '</div>',
            body: 'Your Sandesai verification code is ' + code + '. It expires in 10 minutes.'
        });
    } catch (e) {
        emailStatus = 'failed';
        emailError  = String(e).slice(0, 250) + ' (quota left: ' + safeMailQuota_() + ')';
        console.error('MailApp.sendEmail failed:', e);
    }

    // ── Update audit row ──
    try {
        if (logRowIndex > 0) {
            const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(OTP_SHEET);
            sheet.getRange(logRowIndex, 6).setValue(emailStatus);
            sheet.getRange(logRowIndex, 7).setValue(emailError);
        }
    } catch (e) {}

    if (emailStatus !== 'sent') {
        // Don't punish the user for our failure
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
        return jsonResponse({
            ok: false,
            error: 'email_failed',
            message: 'Could not send email: ' + emailError
        });
    }

    const parts  = email.split('@');
    const masked = parts[0].slice(0, 2) + '***@' + parts[1];
    return jsonResponse({ ok: true, version: CODE_VERSION, sentTo: masked, expiresAt: expiresAt });
}

function verifyOtp(body) {
    if (SECRET && body.secret !== SECRET) {
        return jsonResponse({ ok: false, error: 'invalid secret' });
    }
    return _verifyOtpCore(String(body.phone || '').trim(), String(body.code || '').trim());
}

function _verifyOtpCore(phone, code) {
    if (!PHONE_RE.test(phone)) {
        return jsonResponse({ ok: false, error: 'invalid_phone', message: 'Invalid phone number.' });
    }

    return withLock_(function () {
        const props = PropertiesService.getScriptProperties();
        const key = 'otp_' + phone;
        const raw = props.getProperty(key);

        if (!raw) {
            return jsonResponse({ ok: false, error: 'no_otp', message: 'Please request a new code.' });
        }

        let otp;
        try { otp = JSON.parse(raw); }
        catch (e) {
            props.deleteProperty(key);
            return jsonResponse({ ok: false, error: 'corrupt_otp', message: 'Please request a new code.' });
        }

        if (Date.now() > otp.expiresAt) {
            props.deleteProperty(key);
            return jsonResponse({ ok: false, error: 'expired', message: 'Code expired. Request a new one.' });
        }

        if (otp.hash !== hashCode_(phone, code)) {
            otp.tries = (otp.tries || 0) + 1;
            if (otp.tries >= OTP_MAX_TRIES) {
                props.deleteProperty(key);
                return jsonResponse({
                    ok: false,
                    error: 'too_many_attempts',
                    message: 'Too many wrong tries. Request a new code.'
                });
            }
            props.setProperty(key, JSON.stringify(otp));
            return jsonResponse({
                ok: false,
                error: 'invalid_code',
                triesLeft: OTP_MAX_TRIES - otp.tries,
                message: 'Wrong code. ' + (OTP_MAX_TRIES - otp.tries) + ' tries left.'
            });
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
    } catch (e) {
        console.error('markOtpVerified_ failed:', e);
    }
}

function consumeOtpVerified_(phone) {
    return withLock_(function () {
        const props = PropertiesService.getScriptProperties();
        const key = 'otpok_' + phone;
        const raw = props.getProperty(key);
        if (!raw) return false;
        const valid = Date.now() < Number(raw);
        // Keep the flag until expiry so retries of the same registration still work
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

// Daily time-driven trigger → this keeps everything tidy.
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
            } else if (k.indexOf('otprate_') === 0) {
                if (JSON.parse(all[k]).resetAt < now) { props.deleteProperty(k); cleaned++; }
            } else if (k.indexOf('otpemail_') === 0) {
                const phone = k.slice('otpemail_'.length);
                if (!props.getProperty('otpok_' + phone) && !props.getProperty('otp_' + phone)) {
                    props.deleteProperty(k); cleaned++;
                }
            }
        } catch (e) { props.deleteProperty(k); cleaned++; }
    });

    const otpRows = purgeOldOtpRows_();
    const sessions = purgeExpiredSessions_();
    const dupes = dedupeAllRegistrations_();

    Logger.log('cleanupOtps → properties:' + cleaned +
               ' otpRows:' + otpRows +
               ' sessions:' + sessions +
               ' duplicates:' + dupes);
    return cleaned;
}

// Run ONCE from the editor to grant the Gmail/MailApp permission, then redeploy.
function authTest() {
    MailApp.sendEmail(Session.getActiveUser().getEmail(), 'Sandesai mail test', 'MailApp is authorized. Quota left: ' + safeMailQuota_());
    Logger.log('Mail OK. Remaining quota: ' + safeMailQuota_());
}

// Run ONCE manually to see what the migration did.
function runMigrationNow() {
    resetSchemaFlag();
    ensureSchema_();
    Logger.log('Migration complete. Users: ' + countUsers() + ' | Sessions tab: ' + (!!getSheet(SESSIONS_SHEET)));
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
        .setMimeType(ContentService.MimeType.JSON);
}