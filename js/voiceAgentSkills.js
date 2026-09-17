// ================================================================
// js/voiceAgentSkills.js
// Complete Voice Agent Skillset — implements the SKILL.md spec:
//   • VAD (Silero neural + energy fallback)
//   • Turn-taking with adaptive endpointing
//   • Barge-in / interruption handling
//   • Latency optimization (streaming TTS, pre-compute)
//   • Emotion/tone awareness (pitch + volume)
//   • Noise suppression (confidence thresholding)
//   • Voice-first safety principles
// ================================================================
(function () {
    'use strict';

    // ════════════════════════════════════════════════════════════
    // CONSTANTS — tuned per SKILL.md "Latency is the constraint"
    // ════════════════════════════════════════════════════════════
    const TARGET_LATENCY_MS   = 800;   // <800ms end-to-end target
    const MIN_ENDPOINT_MS     = 300;   // endpointing floor
    const MAX_ENDPOINT_MS     = 900;   // endpointing ceiling
    const BARGE_IN_THRESHOLD  = 0.6;   // VAD confidence to trigger barge-in
    const VAD_POSITIVE        = 0.6;
    const VAD_NEGATIVE        = 0.4;
    const NOISE_FLOOR_DB      = -55;
    const ENERGY_FALLBACK_RMS = 0.015;

    // ════════════════════════════════════════════════════════════
    // STATE
    // ════════════════════════════════════════════════════════════
    let vadInstance = null;
    let vadSupported = false;
    let isListening = false;
    let isSpeaking = false;
    let userSpeaking = false;

    // Turn-taking
    let speechStartedAt = 0;
    let speechEndedAt = 0;
    let endpointingMs = 500;           // adaptive, adjusted per turn
    let lastTurnDuration = 0;

    // Barge-in
    let bargeInEnabled = true;
    let bargeInCount = 0;

    // Emotion
    let emotionSample = { pitch: 0, volume: 0, history: [] };

    // Latency tracking
    let turnStartTime = 0;
    let lastLatency = 0;
    let avgLatency = 0;
    let latencySamples = [];

    // Audio context for pitch/volume analysis
    let audioCtx = null;
    let analyser = null;
    let micStream = null;

    // ════════════════════════════════════════════════════════════
    // 1. VOICE ACTIVITY DETECTION (VAD)
    //    Priority: Silero neural → energy-based fallback
    // ════════════════════════════════════════════════════════════
    async function initVAD() {
        if (typeof vad === 'undefined' || !vad.MicVAD) {
            console.warn('⚠️ Silero VAD unavailable — using energy fallback');
            return initEnergyVAD();
        }
        try {
            vadInstance = await vad.MicVAD.new({
                positiveSpeechThreshold: VAD_POSITIVE,
                negativeSpeechThreshold: VAD_NEGATIVE,
                preSpeechPadFrames: 3,
                redemptionFrames: 8,

                onSpeechStart: () => {
                    userSpeaking = true;
                    speechStartedAt = Date.now();

                    // ── BARGE-IN: if AI is speaking, interrupt it ──
                    if (isSpeaking) {
                        bargeInCount++;
                        console.log('⚡ Barge-in detected (#' + bargeInCount + ')');
                        cancelSpeech();
                        emit('barge-in', { count: bargeInCount });
                    }

                    emit('speech-start', { ts: speechStartedAt });
                },

                onSpeechEnd: (audio) => {
                    userSpeaking = false;
                    speechEndedAt = Date.now();
                    lastTurnDuration = speechEndedAt - speechStartedAt;

                    // Adaptive endpointing: faster speech → shorter silence needed
                    const avgSpeechRate = lastTurnDuration / 1000;
                    endpointingMs = Math.max(
                        MIN_ENDPOINT_MS,
                        Math.min(MAX_ENDPOINT_MS, 500 - (avgSpeechRate * 30))
                    );

                    emit('speech-end', {
                        duration: lastTurnDuration,
                        endpointing: endpointingMs,
                        audioBytes: audio ? audio.length : 0
                    });
                },

                onVADMisfire: () => {
                    // Too short to be real speech (cough, door slam)
                    console.log('🤷 VAD misfire — ignored');
                    emit('vad-misfire', {});
                },

                onFrameProcessed: (probabilities) => {
                    const p = probabilities && probabilities.isSpeech;
                    if (p) emit('vad-probability', { prob: p });
                },
            });

            vadSupported = true;
            console.log('✅ Silero VAD ready');
            emit('vad-ready', { type: 'silero' });
        } catch (e) {
            console.warn('Silero VAD failed, using fallback:', e);
            initEnergyVAD();
        }
    }

    // Energy-based VAD fallback — simple RMS threshold
    async function initEnergyVAD() {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const src = audioCtx.createMediaStreamSource(micStream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 1024;
            src.connect(analyser);

            const data = new Uint8Array(analyser.frequencyBinCount);
            let silenceFrames = 0;
            const SILENCE_FRAMES_TO_END = 20;

            const tick = () => {
                if (!isListening) return requestAnimationFrame(tick);
                analyser.getByteTimeDomainData(data);
                let sumSq = 0;
                for (let i = 0; i < data.length; i++) {
                    const v = (data[i] - 128) / 128;
                    sumSq += v * v;
                }
                const rms = Math.sqrt(sumSq / data.length);

                if (rms > ENERGY_FALLBACK_RMS) {
                    silenceFrames = 0;
                    if (!userSpeaking) {
                        userSpeaking = true;
                        speechStartedAt = Date.now();
                        if (isSpeaking) {
                            bargeInCount++;
                            cancelSpeech();
                            emit('barge-in', { count: bargeInCount });
                        }
                        emit('speech-start', { ts: speechStartedAt });
                    }
                    // Track volume for emotion
                    emotionSample.volume = rms;
                } else {
                    if (userSpeaking) {
                        silenceFrames++;
                        if (silenceFrames >= SILENCE_FRAMES_TO_END) {
                            userSpeaking = false;
                            speechEndedAt = Date.now();
                            lastTurnDuration = speechEndedAt - speechStartedAt;
                            silenceFrames = 0;
                            emit('speech-end', {
                                duration: lastTurnDuration,
                                endpointing: endpointingMs,
                            });
                        }
                    }
                }
                // ── Pitch estimation (zero-crossing rate) ──
                emotionSample.pitch = estimatePitch(data, audioCtx.sampleRate);
                requestAnimationFrame(tick);
            };
            tick();

            vadSupported = true;
            console.log('✅ Energy VAD ready (fallback)');
            emit('vad-ready', { type: 'energy' });
        } catch (e) {
            console.error('Energy VAD failed:', e);
            emit('vad-error', { error: String(e) });
        }
    }

    function estimatePitch(buf, sampleRate) {
        let crossings = 0;
        for (let i = 1; i < buf.length; i++) {
            if ((buf[i - 1] < 128 && buf[i] >= 128) || (buf[i - 1] >= 128 && buf[i] < 128)) {
                crossings++;
            }
        }
        // Rough approximation: pitch = crossings × sampleRate / (2 × buf.length)
        return (crossings * sampleRate) / (2 * buf.length);
    }

    // ════════════════════════════════════════════════════════════
    // 2. TURN-TAKING
    //    Wait for VAD silence + adaptive endpointing before
    //    deciding the user is done.
    // ════════════════════════════════════════════════════════════
    function waitForTurnEnd(timeoutMs) {
        const timeout = timeoutMs || MAX_ENDPOINT_MS;
        return new Promise((resolve) => {
            let resolved = false;
            const onEnd = (e) => {
                if (resolved) return;
                resolved = true;
                off('speech-end', onEnd);
                // Wait the endpointing window to make sure no more speech
                setTimeout(() => resolve(e.detail), endpointingMs);
            };
            on('speech-end', onEnd);
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    off('speech-end', onEnd);
                    resolve(null);
                }
            }, timeout + 500);
        });
    }

    // ════════════════════════════════════════════════════════════
    // 3. BARGE-IN / INTERRUPTION
    // ════════════════════════════════════════════════════════════
    function cancelSpeech() {
        if (window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        isSpeaking = false;
    }

    function setBargeIn(enabled) {
        bargeInEnabled = !!enabled;
        emit('barge-in-toggle', { enabled: bargeInEnabled });
    }

    // ════════════════════════════════════════════════════════════
    // 4. LATENCY OPTIMIZATION
    //    Track end-to-end latency and pre-compute first segment.
    // ════════════════════════════════════════════════════════════
    function markTurnStart() {
        turnStartTime = Date.now();
    }

    function markTurnEnd() {
        if (!turnStartTime) return;
        lastLatency = Date.now() - turnStartTime;
        latencySamples.push(lastLatency);
        if (latencySamples.length > 20) latencySamples.shift();
        avgLatency = latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;

        emit('latency', {
            ms: lastLatency,
            avg: Math.round(avgLatency),
            target: TARGET_LATENCY_MS,
            overBudget: lastLatency > TARGET_LATENCY_MS,
        });
        turnStartTime = 0;
    }

    // Streaming TTS — speak sentences as they arrive, not the whole blob
    async function streamSpeak(text, onChunk) {
        if (!text) return;
        const sentences = splitSentences(text);
        isSpeaking = true;
        for (let i = 0; i < sentences.length; i++) {
            if (!isSpeaking) break; // barge-in cancelled
            const s = sentences[i];
            if (!s.trim()) continue;
            if (onChunk) onChunk(s, i, sentences.length);
            await speak(s);
        }
        isSpeaking = false;
    }

    function splitSentences(text) {
        // Split on sentence terminators while keeping them
        const parts = String(text).match(/[^.!?]+[.!?]*/g) || [text];
        // Merge short fragments (< 20 chars) into next sentence
        const out = [];
        let buf = '';
        parts.forEach(p => {
            buf += p;
            if (buf.trim().length >= 20 || p === parts[parts.length - 1]) {
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
            u.pitch = 1.0;
            u.onstart = () => { isSpeaking = true; };
            u.onend = () => { resolve(); };
            u.onerror = () => { resolve(); };
            try { window.speechSynthesis.speak(u); } catch (e) { resolve(); }
        });
    }

    // ════════════════════════════════════════════════════════════
    // 5. EMOTION / TONE AWARENESS
    //    Tracks pitch and volume trend across the conversation.
    // ════════════════════════════════════════════════════════════
    function getEmotionSnapshot() {
        const h = emotionSample.history;
        if (h.length < 3) {
            return { label: 'neutral', confidence: 0, pitch: 0, volume: 0 };
        }
        const recent = h.slice(-5);
        const avgPitch = recent.reduce((a, b) => a + b.pitch, 0) / recent.length;
        const avgVol = recent.reduce((a, b) => a + b.volume, 0) / recent.length;
        const pitchVar = recent.reduce((a, b) => a + Math.abs(b.pitch - avgPitch), 0) / recent.length;

        let label = 'neutral';
        let confidence = 0.5;
        if (avgVol > 0.05 && pitchVar > 30) { label = 'excited'; confidence = 0.7; }
        else if (avgVol < 0.02 && avgPitch < 120) { label = 'calm'; confidence = 0.6; }
        else if (pitchVar > 60) { label = 'animated'; confidence = 0.65; }
        else if (avgVol > 0.08) { label = 'loud'; confidence = 0.7; }

        return { label, confidence, pitch: avgPitch, volume: avgVol };
    }

    function pushEmotionSample() {
        emotionSample.history.push({
            pitch: emotionSample.pitch,
            volume: emotionSample.volume,
            ts: Date.now()
        });
        if (emotionSample.history.length > 30) emotionSample.history.shift();
    }
    setInterval(pushEmotionSample, 500);

    // ════════════════════════════════════════════════════════════
    // 6. NOISE HANDLING
    //    Reject low-confidence speech (coughs, background).
    // ════════════════════════════════════════════════════════════
    function isLikelyNoise(confidence, durationMs) {
        if (durationMs < 200) return true;
        if (confidence != null && confidence < 0.5) return true;
        return false;
    }

    // ════════════════════════════════════════════════════════════
    // 7. VOICE-FIRST SAFETY PRINCIPLES
    //    Track "no-undo" awareness: log every spoken line so we can
    //    surface corrections later. Linear + ephemeral warnings.
    // ════════════════════════════════════════════════════════════
    const spokenLog = [];
    function recordSpoken(line) {
        spokenLog.push({ text: line, ts: Date.now() });
        if (spokenLog.length > 100) spokenLog.shift();
    }
    function getSpokenLog() { return spokenLog.slice(); }

    // ════════════════════════════════════════════════════════════
    // 8. EVENT BUS (tiny)
    // ════════════════════════════════════════════════════════════
    const listeners = {};
    function on(evt, fn) {
        (listeners[evt] = listeners[evt] || []).push(fn);
    }
    function off(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(f => f !== fn);
    }
    function emit(evt, detail) {
        (listeners[evt] || []).forEach(fn => {
            try { fn({ detail }); } catch (e) { console.warn(e); }
        });
    }

    // ════════════════════════════════════════════════════════════
    // 9. LIFECYCLE
    // ════════════════════════════════════════════════════════════
    async function startListening() {
        if (isListening) return;
        isListening = true;
        if (vadInstance && vadInstance.start) {
            try { vadInstance.start(); } catch (e) {}
        }
        emit('listening-start', {});
    }

    function stopListening() {
        if (!isListening) return;
        isListening = false;
        if (vadInstance && vadInstance.pause) {
            try { vadInstance.pause(); } catch (e) {}
        }
        emit('listening-stop', {});
    }

    async function start() {
        await initVAD();
        await startListening();
        console.log('🎙️ VoiceAgentSkills ready');
    }

    // ════════════════════════════════════════════════════════════
    // PUBLIC API
    // ════════════════════════════════════════════════════════════
    window.VoiceSkills = {
        start,
        startListening,
        stopListening,
        streamSpeak,
        cancelSpeech,
        setBargeIn,
        waitForTurnEnd,
        markTurnStart,
        markTurnEnd,
        isSpeaking: () => isSpeaking,
        isUserSpeaking: () => userSpeaking,
        getEndpointing: () => endpointingMs,
        getEmotion: getEmotionSnapshot,
        getLatency: () => ({
            last: lastLatency,
            avg: Math.round(avgLatency),
            samples: latencySamples.slice(),
            target: TARGET_LATENCY_MS,
        }),
        isNoise: isLikelyNoise,
        recordSpoken,
        getSpokenLog,
        on, off, emit,
        _debug: {
            isListening: () => isListening,
            vadType: () => vadSupported ? (vadInstance ? 'silero' : 'energy') : 'none',
        },
    };

    // ════════════════════════════════════════════════════════════
    // AUTO-BOOT: wait for the app to be ready, then start
    // ════════════════════════════════════════════════════════════
    function bootWhenReady() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(start, 1500));
        } else {
            setTimeout(start, 1500);
        }
    }
    bootWhenReady();

    console.log('📦 voiceAgentSkills.js loaded — VAD, turn-taking, barge-in, latency, emotion');
})();