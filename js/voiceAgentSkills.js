// ================================================================
// js/voiceAgentSkills.js — VAD-FREE VERSION
// Works alongside Chrome's SpeechRecognition (no mic conflict).
//   • Barge-in via SpeechRecognition interimResults
//   • Turn-taking with adaptive endpointing
//   • Latency tracking
//   • Streaming TTS (sentence-by-sentence)
//   • Spoken-line log
//   • Event bus
// ================================================================
(function () {
    'use strict';

    const TARGET_LATENCY_MS = 800;
    const MIN_ENDPOINT_MS   = 300;
    const MAX_ENDPOINT_MS   = 900;

    let isSpeaking = false;
    let userSpeaking = false;
    let speechStartedAt = 0;
    let speechEndedAt = 0;
    let endpointingMs = 500;
    let lastTurnDuration = 0;
    let bargeInEnabled = true;
    let bargeInCount = 0;

    let turnStartTime = 0;
    let lastLatency = 0;
    let avgLatency = 0;
    let latencySamples = [];

    const spokenLog = [];

    // Event bus
    const listeners = {};
    function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
    function off(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(f => f !== fn);
    }
    function emit(evt, detail) {
        (listeners[evt] || []).forEach(fn => {
            try { fn({ detail }); } catch (e) {}
        });
    }

    // Speech events — called by app.js
    function notifySpeechStart(source) {
        if (userSpeaking) return;
        userSpeaking = true;
        speechStartedAt = Date.now();
        emit('speech-start', { ts: speechStartedAt, source: source || 'unknown' });
    }

    function notifySpeechEnd(source) {
        if (!userSpeaking) return;
        userSpeaking = false;
        speechEndedAt = Date.now();
        lastTurnDuration = speechEndedAt - speechStartedAt;
        const avgSpeechRate = lastTurnDuration / 1000;
        endpointingMs = Math.max(
            MIN_ENDPOINT_MS,
            Math.min(MAX_ENDPOINT_MS, 500 - (avgSpeechRate * 30))
        );
        emit('speech-end', {
            duration: lastTurnDuration,
            endpointing: endpointingMs,
            source: source || 'unknown'
        });
    }

    function notifyBargeIn() {
        if (!bargeInEnabled) return;
        bargeInCount++;
        console.log('⚡ Barge-in detected (#' + bargeInCount + ')');
        emit('barge-in', { count: bargeInCount });
    }

    function setBargeIn(enabled) {
        bargeInEnabled = !!enabled;
        emit('barge-in-toggle', { enabled: bargeInEnabled });
    }

    function markTurnStart() { turnStartTime = Date.now(); }
    function markTurnEnd() {
        if (!turnStartTime) return;
        lastLatency = Date.now() - turnStartTime;
        latencySamples.push(lastLatency);
        if (latencySamples.length > 20) latencySamples.shift();
        avgLatency = latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;
        console.log('📊 RAGina turn latency:', lastLatency, 'ms (avg ' + Math.round(avgLatency) + 'ms)');
        emit('latency', {
            ms: lastLatency,
            avg: Math.round(avgLatency),
            target: TARGET_LATENCY_MS,
            overBudget: lastLatency > TARGET_LATENCY_MS,
        });
        turnStartTime = 0;
    }

    function setSpeaking(v) {
        isSpeaking = !!v;
        emit('speaking', { isSpeaking });
    }

    function isSpeakingNow() { return isSpeaking; }

    function cancelSpeech() {
        if (window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        setSpeaking(false);
    }

    function splitSentences(text) {
        const parts = String(text).match(/[^.!?]+[.!?]*/g) || [text];
        const out = [];
        let buf = '';
        parts.forEach((p, idx) => {
            buf += p;
            if (buf.trim().length >= 20 || idx === parts.length - 1) {
                out.push(buf.trim());
                buf = '';
            }
        });
        if (buf.trim()) out.push(buf.trim());
        return out;
    }

    function speak(text) {
        return new Promise((resolve) => {
            if (!window.speechSynthesis) return resolve();
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'en-US';
            u.rate = 1.02;
            u.onstart = () => setSpeaking(true);
            u.onend = () => { resolve(); };
            u.onerror = () => { resolve(); };
            try { window.speechSynthesis.speak(u); } catch (e) { resolve(); }
        });
    }

    async function streamSpeak(text, onChunk) {
        if (!text) return;
        const sentences = splitSentences(text);
        setSpeaking(true);
        for (let i = 0; i < sentences.length; i++) {
            if (!isSpeaking) break;
            const s = sentences[i];
            if (!s.trim()) continue;
            if (onChunk) onChunk(s, i, sentences.length);
            await speak(s);
        }
        setSpeaking(false);
    }

    function recordSpoken(line) {
        spokenLog.push({ text: line, ts: Date.now() });
        if (spokenLog.length > 100) spokenLog.shift();
    }
    function getSpokenLog() { return spokenLog.slice(); }

    window.VoiceSkills = {
        on, off, emit,
        notifySpeechStart,
        notifySpeechEnd,
        notifyBargeIn,
        setSpeaking,
        isSpeaking: isSpeakingNow,
        cancelSpeech,
        streamSpeak,
        setBargeIn,
        markTurnStart,
        markTurnEnd,
        getEndpointing: () => endpointingMs,
        getLatency: () => ({
            last: lastLatency,
            avg: Math.round(avgLatency),
            samples: latencySamples.slice(),
            target: TARGET_LATENCY_MS,
        }),
        recordSpoken,
        getSpokenLog,
        // Backwards-compat stubs
        startListening: () => Promise.resolve(),
        stopListening: () => {},
        start: () => Promise.resolve(),
    };

    console.log('📦 voiceAgentSkills.js loaded — VAD-free, barge-in ready');
})();