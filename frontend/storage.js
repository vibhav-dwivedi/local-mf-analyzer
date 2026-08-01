/**
 * storage.js — IndexedDB wrapper for saving/loading analysis snapshots.
 *
 * Each snapshot stores:
 *   - id: auto-incremented
 *   - timestamp: ISO string
 *   - summary: { total_invested, current_value, overall_xirr, ... }
 *   - data: full analysis result
 */

const DB_NAME = 'mf-analyzer';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Save an analysis snapshot.
 * @param {Object} data — Full analysis result (the `data` key from analyze_cas)
 * @returns {Promise<number>} — The snapshot ID
 */
async function saveSnapshot(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
            timestamp: new Date().toISOString(),
            summary: data.summary,
            data: data,
        };
        const req = store.add(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get the most recent snapshot.
 * @returns {Promise<Object|null>}
 */
async function getLatestSnapshot() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const req = index.openCursor(null, 'prev'); // newest first
        req.onsuccess = () => {
            const cursor = req.result;
            resolve(cursor ? cursor.value : null);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get all snapshots (sorted newest first).
 * @returns {Promise<Array>}
 */
async function getAllSnapshots() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
            const results = req.result || [];
            results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            resolve(results);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Delete a specific snapshot by ID.
 * @param {number} id
 */
async function deleteSnapshot(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Clear all snapshots.
 */
async function clearAllSnapshots() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// Export for use in app.js (loaded as a regular script, not a module)
window.MFStorage = {
    saveSnapshot,
    getLatestSnapshot,
    getAllSnapshots,
    deleteSnapshot,
    clearAllSnapshots,
};
