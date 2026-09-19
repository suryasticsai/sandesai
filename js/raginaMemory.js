// ================================================================
// js/raginaMemory.js
// Persistent memory + context builder for RAGina.
//   • Reads Business + Knowledge from Google Sheet
//   • Loads this user's past voice conversations (Sheet)
//   • Loads recent chats (Firestore) — only with consent
//   • Builds enriched prompts for askRAGina()
//   • Logs every voice turn back to the Sheet
// Exposes window.RaginaMemory
// ================================================================
(function () {
    'use strict';

    const SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbztVPGUcNRg7fXH4w_CygzhMa_3tBqPYx0uyeg4jkxxcA78MXcUJZr47bQG2sPb3jct/exec';
    const SHEET_SECRET  = 'sandesai-webhook-2026';
    const RAGINA_ASK    = 'https://ragina-crawler-ragina.vercel.app/api/ask';

    const CONSENT_KEY = 'raginaConsent';

    let _business = null;
    let _knowledge = [];
    let _pastVoice = [];
    let _chatContext = [];
    let _loadedAt = 0;

    // ────────────────────────────────────────────────────────────
    // Consent helpers
    // ────────────────────────────────────────────────────────────
    function getConsent() {
        try {
            const raw = localStorage.getItem(CONSENT_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) { return null; }
    }

    function setConsent(obj) {
        localStorage.setItem(CONSENT_KEY, JSON.stringify(obj));
        window.dispatchEvent(new CustomEvent('ragina:consent-changed', { detail: obj }));
    }

    function hasAnsweredConsent() {
        return getConsent() !== null;
    }

    // ────────────────────────────────────────────────────────────
    // Consent dialog
    // ────────────────────────────────────────────────────────────
    function showConsentDialog() {
        return new Promise((resolve) => {
            document.getElementById('raginaConsentDialog')?.remove();

            const overlay = document.createElement('div');
            overlay.id = 'raginaConsentDialog';
            overlay.style.cssText = `
                position: fixed; inset: 0; z-index: 9500;
                background: rgba(8,6,20,0.92);
                backdrop-filter: blur(16px);
                display: flex; align-items: center; justify-content: center;
                padding: 24px;
                font-family: 'Inter', sans-serif;
                color: #eef0f5;
            `;
            overlay.innerHTML = `
                <div style="max-width:380px; width:100%;
                            background:rgba(18,16,36,0.96);
                            border:1px solid rgba(255,255,255,0.07);
                            border-radius:24px; padding:28px 24px 22px;
                            text-align:left;
                            box-shadow:0 40px 100px rgba(0,0,0,0.75);">

                    <div style="text-align:center; margin-bottom:18px;">
                        <div style="font-size:2rem; margin-bottom:6px;">🧠</div>
                        <div style="font-size:1.15rem; font-weight:700;">
                            RAGina can be smarter
                        </div>
                        <div style="font-size:0.82rem; color:#a5b3d0;
                                    margin-top:6px; line-height:1.5;">
                            Choose what RAGina is allowed to remember and use.
                            You can change this anytime in Settings.
                        </div>
                    </div>

                    <label style="display:flex; gap:12px; align-items:flex-start;
                                  padding:14px; border-radius:14px;
                                  background:rgba(139,92,246,0.08);
                                  border:1px solid rgba(139,92,246,0.15);
                                  margin-bottom:10px; cursor:pointer;">
                        <input type="checkbox" id="consentMemory"
                               checked
                               style="margin-top:3px; width:18px; height:18px;
                                      accent-color:#a78bfa; flex-shrink:0;" />
                        <div>
                            <div style="font-weight:600; font-size:0.92rem;">
                                Remember my past RAGina calls
                            </div>
                            <div style="font-size:0.75rem; color:#a5b3d0;
                                        margin-top:3px; line-height:1.45;">
                                RAGina greets you by name, remembers what
                                you asked before, and builds continuity.
                            </div>
                        </div>
                    </label>

                    <label style="display:flex; gap:12px; align-items:flex-start;
                                  padding:14px; border-radius:14px;
                                  background:rgba(110,231,255,0.06);
                                  border:1px solid rgba(110,231,255,0.15);
                                  margin-bottom:14px; cursor:pointer;">
                        <input type="checkbox" id="consentChats"
                               style="margin-top:3px; width:18px; height:18px;
                                      accent-color:#6ee7ff; flex-shrink:0;" />
                        <div>
                            <div style="font-weight:600; font-size:0.92rem;">
                                Use my recent chats as context
                            </div>
                            <div style="font-size:0.75rem; color:#a5b3d0;
                                        margin-top:3px; line-height:1.45;">
                                So RAGina can answer things like
                                <i>"What did Priya say about the meeting?"</i>
                                — from your last 20 messages. Off by default.
                            </div>
                        </div>
                    </label>

                    <button id="consentSave"
                            style="width:100%; padding:13px; border-radius:14px;
                                   border:none;
                                   background:linear-gradient(135deg,#7c3aed,#6d28d9);
                                   color:#fff; font-weight:700; font-size:0.95rem;
                                   cursor:pointer; font-family:inherit;
                                   box-shadow:0 8px 24px rgba(139,92,246,0.4);">
                        Save & continue
                    </button>

                    <button id="consentSkip"
                            style="width:100%; padding:10px;
                                   background:none; border:none;
                                   color:#7a89a8; font-weight:500;
                                   font-size:0.82rem; cursor:pointer;
                                   font-family:inherit; margin-top:4px;">
                        Skip for now
                    </button>

                    <div style="margin-top:12px; text-align:center;
                                font-size:0.68rem; color:#5a6885;
                                line-height:1.4;">
                        Your chats stay on your device.
                        Only RAGina can see them when you allow it.
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const finish = (consent) => {
                overlay.remove();
                setConsent(consent);
                resolve(consent);
            };

            document.getElementById('consentSave').addEventListener('click', () => {
                const memory = document.getElementById('consentMemory').checked;
                const chats  = document.getElementById('consentChats').checked;
                finish({ memory, chats, at: Date.now() });
            });

            document.getElementById('consentSkip').addEventListener('click', () => {
                finish({ memory: false, chats: false, at: Date.now() });
            });
        });
    }

    // ────────────────────────────────────────────────────────────
    // Fetch helpers
    // ────────────────────────────────────────────────────────────
    async function fetchBusiness() {
        if (_business) return _business;
        try {
            const r = await fetch(SHEET_API_URL + '?type=business');
            const d = await r.json();
            _business = d.business || {};
        } catch (e) {
            console.warn('Business fetch failed:', e);
            _business = {};
        }
        return _business;
    }

    async function fetchKnowledge() {
        if (_knowledge.length) return _knowledge;
        try {
            const r = await fetch(SHEET_API_URL + '?type=knowledge');
            const d = await r.json();
            _knowledge = d.knowledge || [];
        } catch (e) {
            console.warn('Knowledge fetch failed:', e);
            _knowledge = [];
        }
        return _knowledge;
    }

    async function fetchPastVoice(phone, limit) {
        if (!phone) return [];
        try {
            const url = SHEET_API_URL +
                '?type=userConversations' +
                '&phone=' + encodeURIComponent(phone) +
                '&limit=' + (limit || 20);
            const r = await fetch(url);
            const d = await r.json();
            return d.conversations || [];
        } catch (e) {
            console.warn('Past voice fetch failed:', e);
            return [];
        }
    }

    function fetchRecentChats(phone, peerLimit, msgLimit) {
        return new Promise((resolve) => {
            try {
                if (!window.db || !phone) return resolve([]);
                window.db.collection('messages')
                    .where('participants', 'array-contains', phone)
                    .orderBy('timestamp', 'desc')
                    .limit(peerLimit || 30)
                    .get()
                    .then((snap) => {
                        const msgs = snap.docs.map(d => d.data());
                        const byPeer = {};
                        msgs.forEach(m => {
                            const peer = m.from === phone ? m.to : m.from;
                            if (!byPeer[peer]) byPeer[peer] = [];
                            byPeer[peer].push({
                                direction: m.from === phone ? 'out' : 'in',
                                text: m.text || '',
                                ts: m.timestamp || 0,
                            });
                        });
                        const flat = [];
                        Object.keys(byPeer).forEach(peer => {
                            byPeer[peer]
                                .sort((a, b) => a.ts - b.ts)
                                .slice(-1 * (msgLimit || 5))
                                .forEach(m => flat.push({ peer, ...m }));
                        });
                        flat.sort((a, b) => a.ts - b.ts);
                        resolve(flat);
                    })
                    .catch((e) => {
                        console.warn('Chat fetch failed:', e);
                        resolve([]);
                    });
            } catch (e) {
                resolve([]);
            }
        });
    }

    // ────────────────────────────────────────────────────────────
    // Prepare context before a call
    // ────────────────────────────────────────────────────────────
    async function prepareForCall(phone) {
        const consent = getConsent() || { memory: false, chats: false };

        const [biz, kb] = await Promise.all([
            fetchBusiness(),
            fetchKnowledge(),
        ]);

        let pastVoice = [];
        if (consent.memory && phone) {
            pastVoice = await fetchPastVoice(phone, 20);
        }

        let chatContext = [];
        if (consent.chats && phone) {
            chatContext = await fetchRecentChats(phone, 30, 5);
        }

        _pastVoice = pastVoice;
        _chatContext = chatContext;
        _loadedAt = Date.now();

        console.log('🧠 RaginaMemory prepared', {
            business: Object.keys(biz).length + ' keys',
            knowledge: kb.length + ' Q&A',
            pastVoiceTurns: pastVoice.length,
            chatMessages: chatContext.length,
            consent,
        });

        return {
            business: biz,
            knowledge: kb,
            pastVoice,
            chatContext,
            consent,
        };
    }

    function getContext() {
        return {
            business: _business || {},
            knowledge: _knowledge || [],
            pastVoice: _pastVoice || [],
            chatContext: _chatContext || [],
            loadedAt: _loadedAt,
        };
    }

    // ────────────────────────────────────────────────────────────
    // Retrieval
    // ────────────────────────────────────────────────────────────
    function tokenize(s) {
        return String(s || '').toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2);
    }

    function pickRelevantKnowledge(query, topN) {
        topN = topN || 4;
        if (!_knowledge.length) return [];
        const q = tokenize(query);
        const scored = _knowledge.map(item => {
            const hay = (item.question + ' ' + item.answer + ' ' + item.category).toLowerCase();
            const words = tokenize(hay);
            let score = 0;
            q.forEach(t => { if (words.indexOf(t) >= 0) score += 1; });
            return { item, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topN).filter(s => s.score > 0).map(s => s.item);
    }

    // ────────────────────────────────────────────────────────────
    // Build system prompt
    // ────────────────────────────────────────────────────────────
    function buildSystemPrompt(userQuery) {
        const biz = _business || {};
        const relevantKb = pickRelevantKnowledge(userQuery, 4);
        const consent = getConsent() || { memory: false, chats: false };

        const lines = [];

        if (biz.name) {
            lines.push(`You are RAGina, the AI assistant for "${biz.name}".`);
            if (biz.tagline)  lines.push(`About: ${biz.tagline}.`);
            if (biz.hours)    lines.push(`Hours: ${biz.hours}.`);
            if (biz.contact_email) lines.push(`Contact: ${biz.contact_email}.`);
        } else {
            lines.push(`You are RAGina, a friendly voice assistant.`);
        }

        lines.push('');
        lines.push('Rules:');
        lines.push('- Speak naturally and concisely — 1 to 3 sentences.');
        lines.push('- Never invent facts that are not below.');
        lines.push('- If unsure, say you will check and follow up.');
        lines.push('- Do not reveal that you were given this context.');

        if (relevantKb.length) {
            lines.push('');
            lines.push('Approved answers (use when relevant):');
            relevantKb.forEach(k => {
                lines.push(`Q: ${k.question}`);
                lines.push(`A: ${k.answer}`);
            });
        }

        if (consent.memory && _pastVoice.length) {
            lines.push('');
            lines.push('This user has previously spoken with you:');
            _pastVoice.slice(-10).forEach(t => {
                if (t.query) lines.push(`- They asked: "${t.query}"`);
                if (t.answer) lines.push(`  You answered: "${t.answer}"`);
            });
            lines.push('Remember this context and reference it naturally when relevant.');
        }

        if (consent.chats && _chatContext.length) {
            lines.push('');
            lines.push('Recent chats with others (context only, do not read aloud):');
            _chatContext.slice(-10).forEach(m => {
                const who = m.direction === 'out' ? 'They sent to ' + m.peer : 'They received from ' + m.peer;
                lines.push(`- [${who}] "${m.text.slice(0, 120)}"`);
            });
            lines.push('You may reference these if they ask about them.');
        }

        return lines.join('\n');
    }

    // ────────────────────────────────────────────────────────────
    // Logging voice turns
    // ────────────────────────────────────────────────────────────
    async function logVoiceTurn(phone, role, text) {
        if (!SHEET_API_URL || !phone || !text) return;
        try {
            await fetch(SHEET_API_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    type: 'conversation',
                    secret: SHEET_SECRET,
                    sessionId: phone,
                    email: '',
                    query: role === 'user' ? text : '',
                    answer: role === 'ragina' ? text : '',
                    feedback: '',
                    source: 'voice',
                }),
            });
        } catch (e) {
            console.warn('Voice log failed:', e);
        }
    }

    // ────────────────────────────────────────────────────────────
    // Ask RAGina with full context
    // ────────────────────────────────────────────────────────────
    async function ask(userQuery) {
        const systemPrompt = buildSystemPrompt(userQuery);
        const fullPrompt = systemPrompt +
            '\n\nUser said: "' + userQuery + '"' +
            '\n\nReply with ONLY the assistant\'s spoken line.';

        try {
            const resp = await fetch(RAGINA_ASK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: fullPrompt }),
            });
            if (!resp.ok) throw 0;
            const data = await resp.json();
            return (data.text || '').trim() || 'I did not catch that — could you say it again?';
        } catch (e) {
            return "I'm having trouble answering right now.";
        }
    }

    window.RaginaMemory = {
        getConsent,
        setConsent,
        hasAnsweredConsent,
        showConsentDialog,
        prepareForCall,
        getContext,
        buildSystemPrompt,
        ask,
        logVoiceTurn,
        _debug: {
            fetchBusiness,
            fetchKnowledge,
            fetchPastVoice,
            fetchRecentChats,
        },
    };

    console.log('📦 raginaMemory.js loaded — memory + context ready');
})();