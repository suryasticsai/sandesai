// js/mediaStorage.js
const DB_NAME = 'sandesaiMedia';
const DB_VERSION = 1;
const STORE_NAME = 'media';

let db = null;

/**
 * Initialize IndexedDB. Call once at app startup.
 * @returns {Promise<IDBDatabase>}
 */
export function initMediaStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'mediaId' });
        store.createIndex('chatId', 'chatId', { unique: false });
        store.createIndex('messageId', 'messageId', { unique: false });
      }
    };
  });
}

/**
 * Save a File/Blob to IndexedDB.
 * @param {File|Blob} file
 * @param {string} chatId
 * @param {string} messageId
 * @returns {Promise<string>} mediaId
 */
export function saveMediaFile(file, chatId, messageId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Media DB not initialized'));

    const mediaId = `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record = {
      mediaId,
      chatId,
      messageId,
      blob: file,
      fileName: file.name || 'unnamed',
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      createdAt: new Date().toISOString()
    };

    const request = store.add(record);

    request.onsuccess = () => resolve(mediaId);
    request.onerror = () => {
      if (request.error.name === 'QuotaExceededError') {
        reject(new Error('Storage quota exceeded. Please free up space.'));
      } else {
        reject(request.error);
      }
    };
  });
}

/**
 * Retrieve a media record by mediaId.
 * @param {string} mediaId
 * @returns {Promise<Object|null>}
 */
export function getMedia(mediaId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Media DB not initialized'));

    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(mediaId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a media record.
 * @param {string} mediaId
 * @returns {Promise<void>}
 */
export function deleteMedia(mediaId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Media DB not initialized'));

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(mediaId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Create an object URL for a media blob.
 * @param {string} mediaId
 * @returns {Promise<string>} objectURL
 */
export async function createMediaURL(mediaId) {
  const record = await getMedia(mediaId);
  if (!record) throw new Error('Media not found');
  return URL.createObjectURL(record.blob);
}

/**
 * Revoke an object URL to free memory.
 * @param {string} url
 */
export function revokeMediaURL(url) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}