/* App state: user settings (persisted), the file queue, and the conversion catalog. */

export const DEFAULT_SETTINGS = Object.freeze({
    mode: 'clean', // 'clean' | 'convert'
    stripMetadata: true,
    outputFolder: null,
    video: { format: 'mp4', codec: 'h264', quality: 'balanced', resolution: 'original', fps: 'original', audio: 'keep' },
    image: { format: 'jpg', quality: 85, size: 'original' },
    audio: { format: 'mp3', quality: 'balanced' }
});

const STORAGE_KEY = 'mdr-settings-v1';

function loadSettings() {
    const defaults = structuredClone(DEFAULT_SETTINGS);
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (!saved) return defaults;
        return {
            ...defaults,
            ...saved,
            video: { ...defaults.video, ...saved.video },
            image: { ...defaults.image, ...saved.image },
            audio: { ...defaults.audio, ...saved.audio }
        };
    } catch {
        return defaults;
    }
}

export const state = {
    settings: loadSettings(),
    catalog: null,     // formats/codecs from the main process
    items: [],         // queue: { id, path, name, size, type, status, progress, outputPath, error }
    processing: false
};

export function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); } catch { /* storage unavailable */ }
}

/* ---------------- Queue ---------------- */

let nextId = 1;

/** Add resolved files; returns counts so the UI can report what was skipped. */
export function addFiles(files) {
    const known = new Set(state.items.map((i) => i.path.toLowerCase()));
    const counts = { added: 0, unsupported: 0, duplicate: 0 };

    for (const f of files) {
        const key = f.path.toLowerCase();
        if (!f.supported) { counts.unsupported += 1; continue; }
        if (known.has(key)) { counts.duplicate += 1; continue; }
        known.add(key);
        state.items.push({
            id: nextId++,
            path: f.path,
            name: f.name,
            size: f.size,
            type: f.type,
            status: 'queued', // queued | processing | done | error | cancelled
            progress: 0,
            outputPath: null,
            error: null
        });
        counts.added += 1;
    }
    return counts;
}

export function removeItem(id) {
    const index = state.items.findIndex((i) => i.id === id);
    if (index !== -1) state.items.splice(index, 1);
}

export function clearItems() {
    state.items.length = 0;
}

export function requeue(item, { keepOutput = false } = {}) {
    item.status = 'queued';
    item.progress = 0;
    item.error = null;
    if (!keepOutput) item.outputPath = null;
}

export const queuedTypes = () => new Set(state.items.map((i) => i.type));
