// ============================================================
// js/aiAgent.js
// RAGina voice/text agent that drives the existing #aiView UI.
// Uses: RAGina Pro (already on page), AlaSQL, Web Speech.
// Exposes: window.AIAgent
// ============================================================
(function (global) {
    'use strict';

    const API_URL = 'https://ragina-crawler-ragina.vercel.app/api/ask';

    let recognition = null;
    let isListening = false;
    let isSpeaking = false;
    let _initDone = false;

    // ---------- AlaSQL conversation log ----------
    function ensureTable() {
        if (typeof alasql === 'undefined') return;
        try {
            alasql('CREATE TABLE IF NOT EXISTS ai_conversations (id INT AUTOINCREMENT, role STRING, text STRING, ts STRING)');
        } catch (e) { /* ignore */ }
    }
    function logConv(role, text) {
        if (typeof alasql === 'undefined') return;
        try {
            alasql('INSERT INTO ai_conversations (role, text, ts) VALUES (?,?,?)',
                [role, text, new Date().toISOString()]);
        } catch (e) { /* ignore */ }
    }
    function loadHistory(limit) {
        if (typeof alasql === 'undefined') return [];
        try {
            return alasql('SELECT * FROM ai_conversations ORDER BY id ASC LIMIT ?', [limit || 100]);
        } catch (e) { return []; }
    }
    function clearHistory() {
        if (typeof alasql === 'undefined') return;
        try { alasql('DELETE FROM ai_conversations'); } catch (e) {}
    }

    // ---------- Ask RAGina ----------
    async function askRAGina(prompt) {
        try {
            const resp = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: 'You are RAGina, a friendly assistant for Sandesai messenger. Answer concisely:\n' + prompt
                })
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            return data.text || 'No response.';
        } catch (e) {
            console.error('RAGina error:', e);
            return "I'm having trouble answering right now. Please try again.";
        }
    }

    // ---------- Speech ----------
    function pickVoice() {
        if (!window.speechSynthesis) return null;
        const voices = window.speechSynthesis.getVoices();
        return voices.find(v => /en[-_]?US/i.test(v.lang) && /female|zira|samantha|google/i.test(v.name))
            || voices.find(v => /en/i.test(v.lang)) || voices[0] || null;
    }

    function speak(text) {
        if (!window.speechSynthesis || !text) return Promise.resolve();
        return new Promise((resolve) => {
            try {
                if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
                const u = new SpeechSynthesisUtterance(String(text).replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim());
                u.lang = 'en-US';
                u.voice = pickVoice();
                u.onstart = () => { isSpeaking = true; };
                u.onend = () => { isSpeaking = false; resolve(); };
                u.onerror = () => { isSpeaking = false; resolve(); };
                window.speechSynthesis.speak(u);
            } catch (e) { isSpeaking = false; resolve(); }
        });
    }

    function initRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return null;
        const rec = new SR();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = 'en-US';
        rec.onresult = async (e) => {
            const text = e.results[0][0].transcript.trim();
            if (!text) return;
            stopMicUI();
            addBubble('user', text);
            logConv('user', text);
            const aiBubble = addBubble('ai', '…');
            const answer = await askRAGina(text);
            aiBubble.textContent = answer;
            logConv('ai', answer);
            await speak(answer);
        };
        rec.onerror = (e) => {
            console.warn('Recognition error:', e.error);
            stopMicUI();
        };
        rec.onend = () => { stopMicUI(); };
        return rec;
    }

    // ---------- UI ----------
    function addBubble(role, text) {
        const box = document.getElementById('aiMessages');
        if (!box) return null;
        const div = document.createElement('div');
        div.className = 'msg ' + (role === 'user' ? 'sent' : 'received');
        div.innerHTML = escapeHtml(text);
        const t = document.createElement('span');
        t.className = 'time-tag';
        t.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        div.appendChild(t);
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
        return div;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function openAIChat() {
        document.getElementById('aiView')?.classList.add('open');
        document.getElementById('listView')?.classList.add('shrink');
        renderHistory();
        document.getElementById('aiInput')?.focus();
    }
    function closeAIChat() {
        document.getElementById('aiView')?.classList.remove('open');
        document.getElementById('listView')?.classList.remove('shrink');
    }

    function renderHistory() {
        const box = document.getElementById('aiMessages');
        if (!box) return;
        box.innerHTML = '';
        const rows = loadHistory(100);
        if (!rows.length) {
            addBubble('ai', "Hi! I'm RAGina — your Sandesai assistant. Ask me anything about the app.");
            return;
        }
        rows.forEach(r => addBubble(r.role === 'user' ? 'user' : 'ai', r.text));
    }

    // ---------- Mic ----------
    function startMicUI() {
        isListening = true;
        const b = document.getElementById('aiMicBtn');
        if (b) { b.classList.add('active'); b.innerHTML = '<i class="fas fa-stop"></i>'; }
    }
    function stopMicUI() {
        isListening = false;
        const b = document.getElementById('aiMicBtn');
        if (b) { b.classList.remove('active'); b.innerHTML = '<i class="fas fa-microphone"></i>'; }
    }

    function toggleMic() {
        if (!recognition) {
            global.showToast && showToast('Voice input not supported in this browser');
            return;
        }
        if (isListening) { try { recognition.stop(); } catch (e) {} stopMicUI(); return; }
        try {
            // unlock speech on user gesture
            if (global.PremCall && PremCall.unlockSpeech) PremCall.unlockSpeech();
            recognition.start(); startMicUI();
        } catch (e) { console.warn(e); stopMicUI(); }
    }

    // ---------- Send text ----------
    async function sendText() {
        const inp = document.getElementById('aiInput');
        if (!inp) return;
        const text = inp.value.trim();
        if (!text) return;
        inp.value = '';
        addBubble('user', text);
        logConv('user', text);
        const aiBubble = addBubble('ai', '…');
        const answer = await askRAGina(text);
        aiBubble.textContent = answer;
        logConv('ai', answer);
        await speak(answer);
    }

    // ---------- Export ----------
    function exportConversation() {
        const rows = loadHistory(500);
        if (!rows.length) { global.showToast && showToast('No conversation to export'); return; }
        const text = rows.map(r =>
            '[' + new Date(r.ts).toLocaleString() + '] ' + (r.role === 'user' ? 'You' : 'RAGina') + ': ' + r.text
        ).join('\n');
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'sandesai-ragina-' + Date.now() + '.txt';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    // ---------- Init ----------
    function init() {
        if (_initDone) return;
        _initDone = true;
        ensureTable();
        recognition = initRecognition();

        document.getElementById('openAiChatBtn')?.addEventListener('click', openAIChat);
        document.getElementById('aiBackBtn')?.addEventListener('click', closeAIChat);
        document.getElementById('aiSendBtn')?.addEventListener('click', sendText);
        document.getElementById('aiInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
        document.getElementById('aiMicBtn')?.addEventListener('click', toggleMic);
        document.getElementById('aiClearBtn')?.addEventListener('click', () => {
            if (!confirm('Clear AI conversation history?')) return;
            clearHistory();
            renderHistory();
            global.showToast && showToast('AI chat cleared');
        });
        document.getElementById('aiExportBtn')?.addEventListener('click', exportConversation);

        // Preload voices (Chrome needs a nudge)
        if (window.speechSynthesis) {
            window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => {};
        }

        console.log('🧠 AIAgent ready');
    }

    global.AIAgent = { init, openAIChat, closeAIChat, askRAGina, logConv, loadHistory, clearHistory };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window);