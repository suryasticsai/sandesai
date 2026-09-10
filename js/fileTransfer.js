// js/fileTransfer.js
const CHUNK_SIZE = 16 * 1024; // 16 KB

/**
 * Send a file over a PeerJS DataConnection in chunks.
 * @param {DataConnection} conn - PeerJS connection
 * @param {File} file
 * @param {string} chatId
 * @param {string} messageId
 * @param {function} onProgress - (sent, total) => void
 */
export async function sendFileOverDataChannel(conn, file, chatId, messageId, onProgress) {
  if (!conn || !conn.open) throw new Error('DataConnection not open');

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // 1. Send metadata
  conn.send({
    type: 'file-meta',
    fileId,
    chatId,
    messageId,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    totalChunks
  });

  // 2. Send chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const arrayBuffer = await chunk.arrayBuffer();
    conn.send({
      type: 'file-chunk',
      fileId,
      chunkIndex: i,
      data: arrayBuffer
    });

    if (onProgress) onProgress(i + 1, totalChunks);
  }

  // 3. Send end signal
  conn.send({ type: 'file-end', fileId });
}

/**
 * Handle incoming file chunks. Call this from your conn.on('data') handler.
 * Maintains a temporary map of fileId -> { meta, chunks[] }.
 */
const incomingFiles = new Map();

export function handleIncomingFileChunk(data) {
  if (data.type === 'file-meta') {
    incomingFiles.set(data.fileId, {
      meta: data,
      chunks: new Array(data.totalChunks),
      received: 0
    });
    return;
  }

  if (data.type === 'file-chunk') {
    const fileState = incomingFiles.get(data.fileId);
    if (!fileState) return;
    fileState.chunks[data.chunkIndex] = data.data;
    fileState.received++;
    return;
  }

  if (data.type === 'file-end') {
    const fileState = incomingFiles.get(data.fileId);
    if (!fileState) return;

    // Reassemble Blob
    const blob = new Blob(fileState.chunks, { type: fileState.meta.mimeType });
    const file = new File([blob], fileState.meta.fileName, { type: fileState.meta.mimeType });

    // Save to IndexedDB
    import('./mediaStorage.js').then(({ saveMediaFile }) => {
      saveMediaFile(file, fileState.meta.chatId, fileState.meta.messageId)
        .then(mediaId => {
          // Insert message into AlaSQL (or call your existing message handler)
          // Example:
          // alasql('INSERT INTO messages ...', [..., mediaId]);
          console.log('File received and saved, mediaId:', mediaId);
        })
        .catch(err => console.error('Failed to save received file:', err));
    });

    incomingFiles.delete(data.fileId);
  }
}