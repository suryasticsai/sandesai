// ============================================================
// APP.JS – Calling Core, Registration, PeerJS, RAGina
// Integrated into Sandesai without breaking existing chat
// ============================================================

(function(global) {
    'use strict';

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CONSTANTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const RAGINA_NUMBER = '0000000000';
    const API_URL = 'https://ragina-crawler-ragina.vercel.app/api/ask';

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STATE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let peer = null;
    let myNumber = null;
    let activeCall = null;
    let incomingCall = null;
    let localStream = null;
    let inCall = false;
    let muted = false;
    let speakerOn = false;
    let videoOn = false;
    let raginaCallActive = false;
    let raginaRecognition = null;
    let raginaIsMuted = false;
    let isSpeaking = false;
    let liveRecognition = null;
    let currentLog = null;
    let lastLog = null;
    let timerInterval = null;
    let timerSeconds = 0;
    let ringtoneTimer = null;
    let ttsVoices = [];
    let speechUnlocked = false;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // AUDIO HELPERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let actx = null;

    function audioCtx() {
        if (!actx) {
            try {
                actx = new(window.AudioContext || window.webkitAudioContext)();
            } catch (e) { return null; }
        }
        if (actx.state === 'suspended') actx.resume().catch(() => {});
        return actx;
    }

    function beep(f1, f2, dur) {
        const ctx = audioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        g.connect(ctx.destination);
        [f1, f2].forEach(f => {
            if (!f) return;
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = f;
            o.connect(g);
            o.start(now);
            o.stop(now + dur);
        });
    }

    const DTMF = {
        '1': [697, 1209],
        '2': [697, 1336],
        '3': [697, 1477],
        '4': [770, 1209],
        '5': [770, 1336],
        '6': [770, 1477],
        '7': [852, 1209],
        '8': [852, 1336],
        '9': [852, 1477],
        '*': [941, 1209],
        '0': [941, 1336],
        '#': [941, 1477]
    };

    function playDtmf(d) {
        const t = DTMF[d];
        if (t) beep(t[0], t[1], 0.08);
    }

    function startRingtone() {
        stopRingtone();
        beep(440, 480, 0.35);
        ringtoneTimer = setInterval(() => beep(440, 480, 0.35), 1600);
    }

    function stopRingtone() {
        if (ringtoneTimer) {
            clearInterval(ringtoneTimer);
            ringtoneTimer = null;
        }
    }

    function vibrate(p) {
        if (navigator.vibrate) {
            try { navigator.vibrate(p); } catch (e) {}
        }
    }
    global.vibrate = vibrate;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TIMER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function startTimer() {
        stopTimer();
        timerSeconds = 0;
        const el = document.getElementById('callTimer');
        timerInterval = setInterval(() => {
            timerSeconds++;
            if (el) {
                el.textContent = String(Math.floor(timerSeconds / 60)).padStart(2, '0') +
                    ':' + String(timerSeconds % 60).padStart(2, '0');
            }
        }, 1000);
    }

    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        const out = String(Math.floor(timerSeconds / 60)).padStart(2, '0') +
            ':' + String(timerSeconds % 60).padStart(2, '0');
        timerSeconds = 0;
        return out;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CALL LOGS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function getLogs() {
        try {
            return JSON.parse(localStorage.getItem('premCallLogs')) || [];
        } catch (e) { return []; }
    }

    function saveLogs(l) {
        try {
            localStorage.setItem('premCallLogs', JSON.stringify(l));
        } catch (e) {}
    }

    function startLog(number, type, direction) {
        currentLog = {
            id: Date.now(),
            number,
            type,
            direction,
            started: Date.now(),
            ended: null,
            duration: '',
            summary: '',
            messages: []
        };
        persistActiveLog();
    }

    function persistActiveLog() {
        try {
            localStorage.setItem('premCallActiveLog', JSON.stringify(currentLog));
        } catch (e) {}
    }

    function clearActiveLog() {
        try {
            localStorage.removeItem('premCallActiveLog');
        } catch (e) {}
    }

    function logMsg(role, text) {
        if (!currentLog) return;
        currentLog.messages.push({ role, text, timestamp: Date.now() });
        if (currentLog.messages.length > 300) currentLog.messages.shift();
        persistActiveLog();
        appendTranscriptUI(role, text);
    }

    function endLog(duration) {
        if (!currentLog) return null;
        currentLog.ended = Date.now();
        currentLog.duration = duration;
        const logs = getLogs();
        logs.unshift(currentLog);
        if (logs.length > 50) logs.length = 50;
        saveLogs(logs);
        clearActiveLog();
        lastLog = currentLog;
        const done = currentLog;
        currentLog = null;
        // Update call history in UI
        if (global.renderCallList) global.renderCallList();
        return done;
    }

    function updateLogSummary(id, sum) {
        const logs = getLogs();
        const l = logs.find(x => x.id === id);
        if (l) { l.summary = sum;
            saveLogs(logs); }
    }

    function appendTranscriptUI(role, text) {
        const c = document.getElementById('callTranscript');
        if (!c) return;
        const h = c.querySelector('.empty-hint');
        if (h) h.remove();
        const d = document.createElement('div');
        d.className = 'msg';
        const w = document.createElement('span');
        w.className = 'who ' + role;
        w.textContent = role === 'user' ? 'You' : 'RAGina';
        const t = document.createElement('span');
        t.textContent = text;
        d.appendChild(w);
        d.appendChild(t);
        c.appendChild(d);
        c.scrollTop = c.scrollHeight;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function unlockSpeech() {
        if (!window.speechSynthesis || speechUnlocked) return;
        const p = new SpeechSynthesisUtterance(' ');
        p.volume = 0;
        p.onend = () => speechUnlocked = true;
        window.speechSynthesis.speak(p);
        setTimeout(() => speechUnlocked = true, 500);
    }

    let speechQueue = Promise.resolve();

    function speakText(text) {
        if (!window.speechSynthesis) return;
        const clean = String(text).replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
        if (!clean) return;
        if (!speechUnlocked) { unlockSpeech();
            setTimeout(() => speakText(clean), 300); return; }
        speechQueue = speechQueue.then(() => new Promise(resolve => {
            if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
            setTimeout(() => {
                const u = new SpeechSynthesisUtterance(clean);
                u.lang = 'en-US';
                u.volume = speakerOn ? 1 : 0.9;
                u.voice = ttsVoices.find(v => v.lang.startsWith('en') && /female|zira|samantha|google/i.test(v.name)) ||
                    ttsVoices.find(v => v.lang.startsWith('en')) || ttsVoices[0] || null;
                u.onstart = () => { isSpeaking = true; };
                u.onend = () => { isSpeaking = false;
                    resolve(); };
                u.onerror = () => { isSpeaking = false;
                    resolve(); };
                setTimeout(() => resolve(), 12000);
                try { window.speechSynthesis.speak(u); } catch (e) { resolve(); }
            }, 60);
        }));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // AI
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    async function askRAGina(query) {
        try {
            const resp = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: 'You are RAGina, a friendly assistant. Answer concisely:\n' + query })
            });
            if (!resp.ok) throw 0;
            return (await resp.json()).text || 'No response.';
        } catch (e) {
            return "I'm having trouble answering right now. Please try again.";
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PEERJS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    async function getLocalStream() {
        if (localStream && localStream.getAudioTracks().length) return localStream;
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
                video: false
            });
            return localStream;
        } catch (e) {
            showToast('Microphone access denied.');
            return null;
        }
    }

    function showIncomingOverlay(id) {
        const overlay = document.getElementById('incomingOverlay');
        if (!overlay) return;
        document.getElementById('incomingAvatar').textContent = id.slice(0, 2).toUpperCase() || '👤';
        document.getElementById('incomingName').textContent = id;
        document.getElementById('incomingNumber').textContent = id;
        overlay.classList.add('active');
        startRingtone();
        vibrate([300, 200, 300]);
    }

    function hideIncomingOverlay() {
        const overlay = document.getElementById('incomingOverlay');
        if (overlay) overlay.classList.remove('active');
        stopRingtone();
    }

    function wireCallEvents(call) {
        activeCall = call;
        inCall = true;
        call.on('stream', stream => {
            const ra = document.getElementById('remoteAudio');
            if (ra) {
                ra.srcObject = stream;
                ra.play().catch(() => {});
            }
            document.getElementById('callSubstatus').textContent = 'Connected';
            const wrap = document.getElementById('callRingWrap');
            if (wrap) wrap.classList.remove('ring-anim');
            if (!timerInterval) startTimer();
            startLiveTranscription();
        });
        call.on('close', () => endPeerCall());
        call.on('error', () => endPeerCall());
    }

    function showCallScreenPeer(id, isCaller) {
        const avatar = document.getElementById('callAvatar');
        if (avatar) avatar.textContent = id.slice(0, 2).toUpperCase() || '👤';
        document.getElementById('callName').textContent = id;
        document.getElementById('callNumber').textContent = id;
        document.getElementById('callSubstatus').textContent = isCaller ? 'Ringing…' : 'Connecting…';
        document.getElementById('callTimer').textContent = '00:00';
        const wrap = document.getElementById('callRingWrap');
        if (wrap) wrap.classList.add('ring-anim');
        document.getElementById('callScreen').classList.add('active');
        document.getElementById('dialCallBtn')?.classList.add('disabled');
        document.getElementById('callTranscript').innerHTML = '<div class="empty-hint">Live transcript will appear here…</div>';
        // Dim main UI
        document.querySelectorAll('.view, .list-footer, .list-header, .fab-button').forEach(el => {
            el.style.opacity = '0.15';
            el.style.pointerEvents = 'none';
        });
        document.querySelector('.fab-button')?.classList.add('hidden');
    }

    function endPeerCall() {
        if (activeCall) { try { activeCall.close(); } catch (e) {} }
        if (!inCall) return;
        activeCall = null;
        inCall = false;
        stopLiveTranscription();
        const dur = stopTimer();
        const numEl = document.getElementById('callNumber');
        const number = numEl ? numEl.textContent : 'unknown';
        const log = endLog(dur);
        document.getElementById('callScreen').classList.remove('active');
        const wrap = document.getElementById('callRingWrap');
        if (wrap) wrap.classList.remove('ring-anim');
        document.getElementById('dialCallBtn')?.classList.remove('disabled');
        const ra = document.getElementById('remoteAudio');
        if (ra) ra.srcObject = null;
        // Restore UI
        document.querySelectorAll('.view, .list-footer, .list-header, .fab-button').forEach(el => {
            el.style.opacity = '';
            el.style.pointerEvents = '';
        });
        document.querySelector('.fab-button')?.classList.remove('hidden');
        if (log) {
            global.addHistoryEntry(log.number, log.direction, dur, log.id);
        } else if (number) {
            global.addHistoryEntry(number, 'outgoing', dur);
        }
        showToast('Call ended');
    }

    function attachPeerHandlers() {
        if (!peer) return;
        const dot = document.getElementById('headerStatusDot');
        peer.on('open', () => {
            if (dot) {
                dot.className = 'status-dot online';
                dot.title = 'Online';
            }
        });
        peer.on('disconnected', () => {
            if (dot) {
                dot.className = 'status-dot offline';
                dot.title = 'Offline';
            }
            setTimeout(() => {
                if (peer && !peer.destroyed) try { peer.reconnect(); } catch (e) {}
            }, 3000);
        });
        peer.on('error', err => {
            showToast('Network: ' + err.type);
        });
        peer.on('call', call => {
            if (inCall || raginaCallActive) { call.close(); return; }
            incomingCall = call;
            showIncomingOverlay(call.peer);
        });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // LIVE TRANSCRIPTION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function startLiveTranscription() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        stopLiveTranscription();
        const rec = new SR();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = 'en-US';
        liveRecognition = rec;
        rec.onresult = e => {
            logMsg('user', e.results[0][0].transcript);
        };
        rec.onend = () => {
            liveRecognition = null;
            if (inCall) setTimeout(startLiveTranscription, 700);
        };
        rec.onerror = () => {};
        try { rec.start(); } catch (e) {}
    }

    function stopLiveTranscription() {
        if (liveRecognition) {
            try { liveRecognition.stop(); } catch (e) {}
            liveRecognition = null;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RAGINA CALL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let conversationState = 0;
    let userName = '';

    function startRAGinaCall() {
        if (raginaCallActive || inCall) { showToast('Already in a call.'); return; }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { showToast('Voice calls not supported in this browser.'); return; }
        unlockSpeech();
        if (window.speechSynthesis) {
            ttsVoices = window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => ttsVoices = window.speechSynthesis.getVoices();
        }
        raginaCallActive = true;
        conversationState = 0;
        userName = '';
        startLog(RAGINA_NUMBER, 'ragina', 'outgoing');
        document.getElementById('callTranscript').innerHTML = '<div class="empty-hint">Live transcript will appear here…</div>';
        const avatar = document.getElementById('callAvatar');
        if (avatar) avatar.innerHTML = '🤖';
        document.getElementById('callName').textContent = 'RAGina';
        document.getElementById('callNumber').textContent = RAGINA_NUMBER;
        document.getElementById('callSubstatus').textContent = 'Connecting…';
        document.getElementById('callTimer').textContent = '00:00';
        const wrap = document.getElementById('callRingWrap');
        if (wrap) wrap.classList.add('ring-anim');
        document.getElementById('callScreen').classList.add('active');
        document.getElementById('dialCallBtn')?.classList.add('disabled');
        document.querySelectorAll('.view, .list-footer, .list-header, .fab-button').forEach(el => {
            el.style.opacity = '0.15';
            el.style.pointerEvents = 'none';
        });
        document.querySelector('.fab-button')?.classList.add('hidden');
        startTimer();
        setTimeout(() => {
            if (!raginaCallActive) return;
            document.getElementById('callSubstatus').textContent = 'Connected';
            const wrap2 = document.getElementById('callRingWrap');
            if (wrap2) wrap2.classList.remove('ring-anim');
            const g = "Hello! I'm RAGina. What is your name?";
            logMsg('ragina', g);
            speakText(g);
            setTimeout(listenToRAGina, 800);
        }, 1200);
    }

    function listenToRAGina() {
        if (!raginaCallActive || raginaIsMuted || isSpeaking || raginaRecognition) {
            if (raginaCallActive && !raginaIsMuted && !raginaRecognition) {
                setTimeout(listenToRAGina, 600);
            }
            return;
        }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        const rec = new SR();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = 'en-US';
        rec.maxAlternatives = 1;

        rec.onresult = async (e) => {
            if (isSpeaking) return;
            const text = e.results[0][0].transcript;
            if (!text.trim()) return;
            logMsg('user', text.trim());

            if (conversationState === 0) {
                let name = text.trim();
                const stopWords = ['um', 'uh', 'my name is', 'i am', "i'm"];
                for (let sw of stopWords) {
                    if (name.toLowerCase().startsWith(sw)) {
                        name = name.slice(sw.length).trim();
                        break;
                    }
                }
                userName = name || 'Friend';
                conversationState = 1;
                const r = 'Nice to meet you, ' + userName + '. What can I help you with today?';
                logMsg('ragina', r);
                speakText(r);
                setTimeout(listenToRAGina, 800);
            } else {
                document.getElementById('callSubstatus').textContent = 'RAGina is thinking…';
                const ans = await askRAGina(text);
                if (!raginaCallActive) return;
                document.getElementById('callSubstatus').textContent = 'Connected';
                logMsg('ragina', ans);
                speakText(ans);
                setTimeout(listenToRAGina, 800);
            }
        };

        rec.onerror = (e) => {
            console.warn('RAGina recognition error:', e.error);
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                showToast('Microphone denied. Ending call.');
                endRAGinaCall();
                return;
            }
            raginaRecognition = null;
            if (raginaCallActive && !raginaIsMuted && !isSpeaking) {
                setTimeout(listenToRAGina, 600);
            }
        };

        rec.onend = () => {
            raginaRecognition = null;
            if (raginaCallActive && !raginaIsMuted && !isSpeaking) {
                setTimeout(listenToRAGina, 500);
            }
        };

        raginaRecognition = rec;
        try { rec.start(); } catch (e) {
            raginaRecognition = null;
            if (raginaCallActive && !raginaIsMuted) setTimeout(listenToRAGina, 600);
        }
    }

    function endRAGinaCall() {
        if (!raginaCallActive) return;
        raginaCallActive = false;
        isSpeaking = false;
        if (raginaRecognition) {
            try { raginaRecognition.stop(); } catch (e) {}
            raginaRecognition = null;
        }
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        const dur = stopTimer();
        const log = endLog(dur);
        document.getElementById('callScreen').classList.remove('active');
        const wrap = document.getElementById('callRingWrap');
        if (wrap) wrap.classList.remove('ring-anim');
        document.getElementById('dialCallBtn')?.classList.remove('disabled');
        document.querySelectorAll('.view, .list-footer, .list-header, .fab-button').forEach(el => {
            el.style.opacity = '';
            el.style.pointerEvents = '';
        });
        document.querySelector('.fab-button')?.classList.remove('hidden');
        if (log) {
            global.addHistoryEntry(log.number, log.direction, dur, log.id);
        }
        showToast('Call with RAGina ended');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PUBLIC API
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const PremCall = {
        RAGINA_NUMBER,

        init: function(num) {
            myNumber = num;
            if (typeof global.Peer !== 'undefined' && num && num !== RAGINA_NUMBER) {
                try {
                    peer = new global.Peer(num, { debug: 0 });
                    attachPeerHandlers();
                    const dot = document.getElementById('headerStatusDot');
                    if (dot) dot.className = 'status-dot connecting';
                } catch (e) {
                    console.warn('Peer init failed:', e);
                }
            }
        },

        call: function(target) {
            if (target === RAGINA_NUMBER) { startRAGinaCall(); return; }
            if (!peer) { showToast('Register to call real numbers.'); return; }
            if (!/^\d{10}$/.test(target)) { showToast('Enter exactly 10 digits'); return; }
            getLocalStream().then(stream => {
                if (!stream) return;
                const call = peer.call(target, stream);
                if (!call) { showToast('Unreachable.'); return; }
                startLog(target, 'peer', 'outgoing');
                showCallScreenPeer(target, true);
                wireCallEvents(call);
            }).catch(() => showToast('Microphone denied.'));
        },

        answer: async function() {
            if (!incomingCall) return;
            const call = incomingCall;
            incomingCall = null;
            hideIncomingOverlay();
            try {
                const stream = await getLocalStream();
                if (!stream) return;
                startLog(call.peer, 'peer', 'incoming');
                call.answer(stream);
                showCallScreenPeer(call.peer, false);
                wireCallEvents(call);
            } catch (e) { showToast('Microphone denied.'); }
        },

        reject: function() {
            if (incomingCall) {
                const id = incomingCall.peer;
                incomingCall.close();
                incomingCall = null;
                global.addHistoryEntry(id, 'missed', '—');
            }
            hideIncomingOverlay();
        },

        hangup: function() {
            if (raginaCallActive) endRAGinaCall();
            else endPeerCall();
        },

        mute: function() {
            if (raginaCallActive) {
                raginaIsMuted = !raginaIsMuted;
                if (raginaIsMuted && raginaRecognition) {
                    try { raginaRecognition.stop(); } catch (e) {}
                    raginaRecognition = null;
                }
                return raginaIsMuted;
            }
            muted = !muted;
            if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !muted);
            return muted;
        },

        speaker: function() {
            speakerOn = !speakerOn;
            const ra = document.getElementById('remoteAudio');
            if (ra) ra.volume = speakerOn ? 1 : 0.8;
            return speakerOn;
        },

        video: function() {
            videoOn = !videoOn;
            if (localStream) {
                localStream.getVideoTracks().forEach(t => t.enabled = videoOn);
            }
            return videoOn;
        },

        isInCall: () => inCall || raginaCallActive,

        checkStatus: function(number) {
            return new Promise(resolve => {
                if (number === RAGINA_NUMBER) return resolve(true);
                if (!peer) return resolve(false);
                try {
                    const conn = peer.connect(number);
                    let done = false;
                    const finish = v => { if (!done) { done = true;
                            resolve(v);
                            try { conn.close(); } catch (e) {} } };
                    conn.on('open', () => finish(true));
                    conn.on('error', () => finish(false));
                    setTimeout(() => finish(false), 3000);
                } catch (e) { resolve(false); }
            });
        },

        getLogs,
        getLastLog: () => lastLog,

        exportLog: function(log, format) {
            if (!log) { showToast('No call selected.'); return; }
            let content, filename, mime;
            const stamp = new Date(log.started).toISOString().replace(/[:.]/g, '-');
            const buildLogText = (l) => {
                let out = 'Sandesai Transcript\nNumber: ' + l.number + '\nType: ' + (l.type === 'ragina' ? 'RAGina AI Call' : 'Voice Call') +
                    '\nDirection: ' + l.direction + '\nStarted: ' + new Date(l.started).toLocaleString() + '\nDuration: ' + (l
                        .duration || '—') + '\n';
                if (l.summary) out += 'AI Recap: ' + l.summary + '\n';
                out += '\n' + (l.messages.length ? l.messages.map(m => '[' + new Date(m.timestamp).toLocaleTimeString() +
                    '] ' + (m.role === 'user' ? 'You' : (l.type === 'ragina' ? 'RAGina' : 'Live')) + ': ' + m.text).join(
                    '\n') : '(no transcript recorded)');
                return out;
            };
            const buildLogJSON = (l) => {
                return { number: l.number, type: l.type, direction: l.direction, started: new Date(l.started).toISOString(),
                    ended: l.ended ? new Date(l.ended).toISOString() : null, duration: l.duration || null,
                    aiSummary: l.summary || null, messages: l.messages };
            };
            if (format === 'json') {
                content = JSON.stringify(buildLogJSON(log), null, 2);
                filename = 'sandesai-' + stamp + '.json';
                mime = 'application/json';
            } else {
                content = buildLogText(log);
                filename = 'sandesai-' + stamp + '.txt';
                mime = 'text/plain';
            }
            const url = URL.createObjectURL(new Blob([content], { type: mime }));
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            showToast('Saved ' + format.toUpperCase());
        },

        unlockSpeech,
        playDtmf,
        vibrate,
        speakText,
        askRAGina
    };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TOAST
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function showToast(msg) {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.style.cssText =
                'position:fixed;bottom:calc(28px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%) translateY(20px);background:rgba(18,16,36,0.95);border:1px solid rgba(255,255,255,0.06);color:#eef0f5;padding:0.65rem 1.3rem;border-radius:40px;font-size:0.83rem;opacity:0;pointer-events:none;transition:opacity .25s ease,transform .25s ease;z-index:6000;max-width:88%;text-align:center;font-family:Inter,sans-serif;backdrop-filter:blur(12px);';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
        }, 2200);
    }
    global.showToast = showToast;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // EXPOSE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    global.PremCall = PremCall;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RECOVER INTERRUPTED LOG
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    (function recover() {
        try {
            const raw = localStorage.getItem('premCallActiveLog');
            if (raw) {
                localStorage.removeItem('premCallActiveLog');
                const l = JSON.parse(raw);
                if (l && l.messages && l.messages.length) {
                    l.ended = Date.now();
                    l.duration = 'interrupted';
                    const logs = getLogs();
                    logs.unshift(l);
                    if (logs.length > 50) logs.length = 50;
                    saveLogs(logs);
                    lastLog = l;
                }
            }
        } catch (e) {}
        if (!lastLog) lastLog = getLogs().find(l => l.messages && l.messages.length) || null;
    })();

})(window);