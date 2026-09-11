// ============================================================
// js/mediaStorage.js
// IndexedDB blob storage for Sandesai media (images, video, PDF…)
// Exposes: window.MediaStore
// ============================================================
(function (global) {
    'use strict';

    const DB_NAME = 'sandesaiMedia';
    const DB_VERSION = 1;
    const STORE = 'media';
    let _db = null;

    function openDB() {
        return new Promise((resolve, reject) => {
            if (_db) return resolve(_db);
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => { _db = req.result; resolve(_db); };
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const store = db.createObjectStore(STORE, { keyPath: 'mediaId' });
                    store.createIndex('chatId', 'chatId', { unique: false });
                    store.createIndex('messageId', 'messageId', { unique: false });
                }
            };
        });
    }

    async function saveMediaFile(file, chatId, messageId) {
        const db = await openDB();
        const mediaId = 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        const record = {
            mediaId, chatId: chatId || '', messageId: messageId || '',
            blob: file,
            fileName: file.name || 'unnamed',
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            createdAt: new Date().toISOString()
        };
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const req = tx.objectStore(STORE).add(record);
            req.onsuccess = () => resolve(mediaId);
            req.onerror = () => {
                if (req.error && req.error.name === 'QuotaExceededError') {
                    reject(new Error('Storage quota exceeded. Free up space and retry.'));
                } else reject(req.error);
            };
        });
    }

    async function getMedia(mediaId) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(mediaId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function deleteMedia(mediaId) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const req = tx.objectStore(STORE).delete(mediaId);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async function createMediaURL(mediaId) {
        const rec = await getMedia(mediaId);
        if (!rec) throw new Error('Media not found: ' + mediaId);
        return URL.createObjectURL(rec.blob);
    }

    function revokeMediaURL(url) {
        if (url && typeof url === 'string' && url.startsWith('blob:')) {
            try { URL.revokeObjectURL(url); } catch (e) {}
        }
    }

    // Render a small inline preview element based on mimeType
    async function renderMediaElement(mediaId, opts) {
        const rec = await getMedia(mediaId);
        if (!rec) return null;
        const url = URL.createObjectURL(rec.blob);
        const mt = rec.mimeType || '';
        let el;
        if (mt.startsWith('image/')) {
            el = document.createElement('img');
            el.src = url;
            el.style.cssText = 'max-width:100%;border-radius:10px;display:block;';
            el.onload = () => revokeMediaURL(url);
        } else if (mt.startsWith('video/')) {
            el = document.createElement('video');
            el.src = url; el.controls = true;
            el.style.cssText = 'max-width:100%;border-radius:10px;display:block;';
            el.onloadeddata = () => {}; // keep URL alive while playing
        } else if (mt.startsWith('audio/')) {
            el = document.createElement('audio');
            el.src = url; el.controls = true;
            el.style.cssText = 'width:100%;';
        } else {
            el = document.createElement('a');
            el.href = url;
            el.download = rec.fileName || 'file';
            el.textContent = '📎 ' + (rec.fileName || 'Download') +
                ' (' + Math.round((rec.size || 0) / 1024) + ' KB)';
            el.style.cssText = 'color:#a78bfa;text-decoration:underline;font-size:0.85rem;';
        }
        return { el, url, record: rec };
    }

    async function estimateQuota() {
        if (!navigator.storage || !navigator.storage.estimate) return null;
        try { return await navigator.storage.estimate(); } catch (e) { return null; }
    }

    global.MediaStore = {
        saveMediaFile,
        getMedia,
        deleteMedia,
        createMediaURL,
        revokeMediaURL,
        renderMediaElement,
        estimateQuota,
        _openDB: openDB
    };

    // ensure DB is ready as soon as possible
    openDB().then(() => console.log('📦 MediaStore ready')).catch(e => console.warn('MediaStore init failed', e));
})(window); 