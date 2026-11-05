/*
 * Background-removal models: what they are, where they come from, how each one
 * wants its input prepared, and downloading/deleting them on this computer.
 *
 * Models live in <userData>/models (e.g. %APPDATA%/Metadata Remover/models),
 * outside the app folder, so they survive app updates.
 */
const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./download');

let app = null;
try {
    ({ app } = require('electron'));
} catch {
    // Outside Electron (tests)
}

const REMBG = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0';

/**
 * input.size:  [w, h] fixed input, or { shortSide, multiple } for dynamic input (MODNet)
 * input.mean/std: per-channel normalisation after scaling pixels to 0..1
 * output.normalize: stretch the mask to 0..1 (min/max) — what each model's reference code does
 */
const MODELS = [
    {
        id: 'u2netp',
        label: 'U²-Net-p',
        description: 'Fastest. Fine for simple images — edges are rougher.',
        url: `${REMBG}/u2netp.onnx`,
        file: 'u2netp.onnx',
        size: 4574861,
        sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
        license: 'Apache-2.0',
        input: { size: [320, 320], mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
        output: { normalize: true }
    },
    {
        id: 'modnet',
        label: 'MODNet',
        description: 'Portraits and selfies. Very good on hair. Not for objects.',
        tag: 'people',
        url: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx',
        file: 'modnet.onnx',
        size: 25900000, // approximate: verified against the server's Content-Length instead
        approximateSize: true,
        license: 'Apache-2.0',
        input: { size: { shortSide: 512, multiple: 32 }, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
        output: { normalize: false }
    },
    {
        id: 'isnet',
        label: 'ISNet',
        description: 'Most images — people, products, animals. Clean edges.',
        tag: 'recommended',
        url: `${REMBG}/isnet-general-use.onnx`,
        file: 'isnet-general-use.onnx',
        size: 178648008,
        sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
        license: 'Apache-2.0',
        input: { size: [1024, 1024], mean: [0.5, 0.5, 0.5], std: [1, 1, 1] },
        output: { normalize: true }
    },
    {
        id: 'u2net',
        label: 'U²-Net',
        description: 'Good all-round. Older — ISNet usually looks better.',
        url: `${REMBG}/u2net.onnx`,
        file: 'u2net.onnx',
        size: 175997641,
        sha256: '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491',
        license: 'Apache-2.0',
        input: { size: [320, 320], mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
        output: { normalize: true }
    },
    {
        id: 'rmbg14',
        label: 'BRIA RMBG-1.4',
        description: 'Best quality on most photos. Personal use only.',
        tag: 'non-commercial',
        url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
        file: 'rmbg-1.4-quantized.onnx',
        size: 44400000, // approximate: verified against the server's Content-Length instead
        approximateSize: true,
        license: 'bria-rmbg-1.4 (non-commercial)',
        input: { size: [1024, 1024], mean: [0.5, 0.5, 0.5], std: [1, 1, 1] },
        output: { normalize: true }
    }
];

const DEFAULT_MODEL = 'isnet';
const TRUSTED_HOSTS = new Set(['github.com', 'huggingface.co']);

const getModel = (id) => MODELS.find((m) => m.id === id) || null;

function modelsDir() {
    const base = app?.getPath ? app.getPath('userData') : path.join(require('os').tmpdir(), 'metadata-remover-test');
    return path.join(base, 'models');
}

const modelPath = (model) => path.join(modelsDir(), model.file);
const isDownloaded = (model) => fs.existsSync(modelPath(model));

/* ------------------------------------------------------------------ */
/* Download queue                                                      */
/* ------------------------------------------------------------------ */

const queue = [];            // model ids waiting
let active = null;           // { id, progress, controller }
const failures = new Map();  // id -> error message from the last attempt
let listener = () => {};

/** Called with the full status list whenever anything changes. */
function onModelsChanged(callback) {
    listener = callback;
}

function listModels() {
    return MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
        tag: m.tag || null,
        license: m.license,
        size: m.size,
        downloaded: isDownloaded(m),
        state: active?.id === m.id ? 'downloading' : queue.includes(m.id) ? 'queued' : null,
        progress: active?.id === m.id ? active.progress : 0,
        error: failures.get(m.id) || null
    }));
}

const notify = () => listener(listModels());

async function pump() {
    if (active || queue.length === 0) return;

    const model = getModel(queue.shift());
    active = { id: model.id, progress: 0, controller: new AbortController() };
    failures.delete(model.id);
    notify();

    let lastNotify = 0;
    try {
        if (!TRUSTED_HOSTS.has(new URL(model.url).hostname)) throw new Error('Untrusted model source.');
        await downloadFile(model.url, modelPath(model), {
            expectedSize: model.approximateSize ? undefined : model.size,
            sha256: model.sha256,
            signal: active.controller.signal,
            onProgress: (fraction) => {
                active.progress = fraction;
                const now = Date.now();
                if (now - lastNotify > 250) { lastNotify = now; notify(); }
            }
        });
    } catch (error) {
        if (!error.cancelled) failures.set(model.id, error.message);
    } finally {
        active = null;
        notify();
        pump();
    }
}

/** Queue models for download (already downloaded / queued ones are ignored). */
function downloadModels(ids) {
    for (const id of ids) {
        const model = getModel(id);
        if (!model || isDownloaded(model) || queue.includes(id) || active?.id === id) continue;
        queue.push(id);
    }
    notify();
    pump();
}

/** Cancel the current download and everything queued. */
function cancelDownloads() {
    queue.length = 0;
    active?.controller.abort();
    notify();
}

async function deleteModel(id) {
    const model = getModel(id);
    if (!model) return;
    if (active?.id === id) active.controller.abort();
    const index = queue.indexOf(id);
    if (index !== -1) queue.splice(index, 1);
    await fs.promises.rm(modelPath(model), { force: true });
    require('./removeBackground').unloadModel(id);
    notify();
}

module.exports = {
    MODELS,
    DEFAULT_MODEL,
    getModel,
    modelPath,
    isDownloaded,
    listModels,
    downloadModels,
    cancelDownloads,
    deleteModel,
    onModelsChanged
};
