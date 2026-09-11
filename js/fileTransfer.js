// ============================================================
// js/fileTransfer.js
// Chunked PeerJS file transfer (16 KB chunks) – works with PeerJS DataConnection
// Exposes: window.FileTransfer
// ============================================================
(function (global) {
    'use strict';

    const CHUNK_SIZE = 16 * 1024; // 16 KB – safe for all browsers
    const incoming = new Map(); // fileId -> { meta, chunks[], received }

    // ---- Sender side ----
    async function sendFileOverDataChannel(conn, file, chatId, messageId, onProgress) {
        if (!conn || !conn.open) throw new Error('DataConnection not open');
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const fileId = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);

        // 1) metadata
        conn.send({
            type: 'sandesai-file-meta',
            fileId, chatId, messageId,
            fileName: file.name, mimeType: file.type || 'application/octet-stream',
            size: file.size, totalChunks
        });

        // 2) chunks (arraybuffer)
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const buf = await file.slice(start, end).arrayBuffer();
            conn.send({ type: 'sandesai-file-chunk', fileId, chunkIndex: i, data: buf });
            if (onProgress) onProgress(i + 1, totalChunks);
            // small yield to avoid blocking UI
            if (i % 8 === 0) await new Promise(r => setTimeout(r, 0));
        }

        // 3) done
        conn.send({ type: 'sandesai-file-end', fileId });
        return fileId;
    }

    // ---- Receiver side ----
    // Call this from conn.on('data', data => { if (FileTransfer.handleIncoming(data)) return; ... })
    // Returns true if the data packet was a file-transfer packet (handled).
    function handleIncoming(data) {
        if (!data || !data.type || !data.type.startsWith('sandesai-file-')) return false;

        if (data.type === 'sandesai-file-meta') {
            incoming.set(data.fileId, {
                meta: data,
                chunks: new Array(data.totalChunks),
                received: 0
            });
            return true;
        }

        if (data.type === 'sandesai-file-chunk') {
            const st = incoming.get(data.fileId);
            if (!st) return true;
            st.chunks[data.chunkIndex] = data.data;
            st.received++;
            return true;
        }

        if (data.type === 'sandesai-file-end') {
            const st = incoming.get(data.fileId);
            if (!st) return true;
            const { meta, chunks } = st;
            incoming.delete(data.fileId);

            try {
                const blob = new Blob(chunks, { type: meta.mimeType });
                const file = new File([blob], meta.fileName, { type: meta.mimeType });

                if (global.MediaStore) {
                    global.MediaStore.saveMediaFile(file, meta.chatId, meta.messageId)
                        .then(mediaId => {
                            console.log('📥 Received file saved, mediaId =', mediaId);
                            // Notify anyone listening (script.js can subscribe)
                            global.dispatchEvent(new CustomEvent('sandesai:file-received', {
                                detail: { mediaId, meta, file }
                            }));
                        })
                        .catch(err => console.error('Save received file failed:', err));
                }
            } catch (e) {
                console.error('File reassembly failed:', e);
            }
            return true;
        }
        return true;
    }

    global.FileTransfer = {
        CHUNK_SIZE,
        sendFileOverDataChannel,
        handleIncoming
    };
})(window); 