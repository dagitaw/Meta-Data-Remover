/*
 * Background removal:
 *   1. ffmpeg decodes the image (applying EXIF rotation) and resizes it to the
 *      model's input size as raw RGB; `showinfo` reports the real frame size.
 *   2. ONNX Runtime predicts a mask (DirectML GPU on Windows, else CPU).
 *   3. ffmpeg scales the mask back to full size and merges it as the alpha
 *      channel (optional trim / solid background), writing PNG or WebP.
 * No image library is needed beyond the ffmpeg already bundled.
 */
const fs = require('fs');
const { captureFfmpeg } = require('./ffmpeg');
const { buildOutputPath, releaseOutputPath } = require('./fileUtils');
const models = require('./bgModels');

const OUTPUT_FORMATS = {
    png: { ext: '.png', muxer: 'image2', label: 'PNG' },
    webp: { ext: '.webp', muxer: 'webp', label: 'WebP' }
};

/* ------------------------------------------------------------------ */
/* ONNX sessions (one model kept in memory at a time)                  */
/* ------------------------------------------------------------------ */

let ort = null;
let cached = null; // { id, promise }
let idleTimer = null;
const IDLE_UNLOAD_MS = 5 * 60 * 1000; // free the model's memory after 5 idle minutes

function loadOrt() {
    if (!ort) ort = require('onnxruntime-node'); // loaded on first use: keeps app start-up fast
    return ort;
}

function releaseSession(entry) {
    entry?.promise.then((session) => session.release?.()).catch(() => {});
}

async function createSession(model) {
    const file = models.modelPath(model);
    if (!fs.existsSync(file)) throw new Error(`${model.label} isn't downloaded yet.`);

    const { InferenceSession } = loadOrt();
    // Try the GPU (DirectML) first on Windows; fall back to CPU if it isn't available.
    const attempts = process.platform === 'win32' ? [['dml', 'cpu'], ['cpu']] : [['cpu']];
    let lastError;
    for (const executionProviders of attempts) {
        try {
            return await InferenceSession.create(file, { executionProviders, graphOptimizationLevel: 'all' });
        } catch (error) {
            lastError = error;
        }
    }
    throw new Error(`Could not load ${model.label} (${lastError?.message}). Delete it and download it again.`);
}

function scheduleIdleUnload() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        releaseSession(cached);
        cached = null;
    }, IDLE_UNLOAD_MS);
    idleTimer.unref?.(); // never keep the process alive just for this
}

function getSession(model) {
    clearTimeout(idleTimer);
    if (cached?.id === model.id) return cached.promise;
    releaseSession(cached);

    const promise = createSession(model);
    cached = { id: model.id, promise };
    promise.catch(() => { if (cached?.promise === promise) cached = null; });
    return promise;
}

/** Free a model's memory (called when it is deleted). */
function unloadModel(id) {
    if (cached?.id !== id) return;
    releaseSession(cached);
    cached = null;
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

/** Real decoded frame size (after EXIF rotation), from ffmpeg's showinfo filter. */
function parseFrameSize(stderr) {
    const match = stderr.match(/Parsed_showinfo[^\n]*?\ss:(\d+)x(\d+)/);
    if (!match) throw new Error('Could not read the image.');
    return { width: Number(match[1]), height: Number(match[2]) };
}

/** Model input size for an image: fixed, or scaled so the short side matches (MODNet). */
function inputSizeFor(model, width, height) {
    const spec = model.input.size;
    if (Array.isArray(spec)) return spec;
    const scale = spec.shortSide / Math.min(width, height);
    const fit = (v) => Math.max(spec.multiple, Math.round((v * scale) / spec.multiple) * spec.multiple);
    return [fit(width), fit(height)];
}

async function run(step, hooks) {
    hooks.registerCancel?.(step.cancel);
    return step.promise;
}

/** Decode + resize to the model input; returns raw RGB plus the frame size. */
async function decodeForModel(model, inputPath, hooks) {
    const decodeArgs = (filters) => [
        '-nostdin', '-i', inputPath, '-map', '0:v:0', '-frames:v', '1',
        '-vf', filters, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
    ];

    let frame;
    let size;
    if (Array.isArray(model.input.size)) {
        size = model.input.size;
        const { stdout, stderr } = await run(captureFfmpeg(decodeArgs(`showinfo,scale=${size[0]}:${size[1]}:flags=bilinear`)), hooks);
        frame = parseFrameSize(stderr);
        return { rgb: stdout, size, frame };
    }

    // Dynamic input size: find the frame size first.
    const probe = await run(captureFfmpeg(['-nostdin', '-i', inputPath, '-map', '0:v:0', '-frames:v', '1', '-vf', 'showinfo', '-f', 'null', '-']), hooks);
    frame = parseFrameSize(probe.stderr);
    size = inputSizeFor(model, frame.width, frame.height);
    const { stdout } = await run(captureFfmpeg(decodeArgs(`scale=${size[0]}:${size[1]}:flags=bilinear`)), hooks);
    return { rgb: stdout, size, frame };
}

/** HWC uint8 RGB -> normalised CHW float32. */
function toTensorData(rgb, [w, h], { mean, std }) {
    const plane = w * h;
    if (rgb.length < plane * 3) throw new Error('Could not decode the image.');
    const data = new Float32Array(plane * 3);
    const scale = [1 / (255 * std[0]), 1 / (255 * std[1]), 1 / (255 * std[2])];
    const offset = [mean[0] / std[0], mean[1] / std[1], mean[2] / std[2]];
    for (let i = 0, p = 0; i < plane; i += 1, p += 3) {
        data[i] = rgb[p] * scale[0] - offset[0];
        data[plane + i] = rgb[p + 1] * scale[1] - offset[1];
        data[2 * plane + i] = rgb[p + 2] * scale[2] - offset[2];
    }
    return data;
}

/** Model output -> 8-bit mask, plus the subject's bounding box (for trimming). */
function toMask(values, w, h, { normalize }) {
    const count = w * h;
    let min = 0;
    let range = 1;
    if (normalize) {
        min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < count; i += 1) {
            const v = values[i];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        range = max - min || 1;
    }

    const mask = Buffer.allocUnsafe(count);
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0, i = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1, i += 1) {
            const v = Math.round(((values[i] - min) / range) * 255);
            const a = v < 0 ? 0 : v > 255 ? 255 : v;
            mask[i] = a;
            if (a > 12) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    const box = maxX < 0 ? null : { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
    return { mask, box };
}

async function predictMask(model, rgb, size) {
    const session = await getSession(model);
    const { Tensor } = loadOrt();
    const [w, h] = size;
    const input = new Tensor('float32', toTensorData(rgb, size, model.input), [1, 3, h, w]);
    const results = await session.run({ [session.inputNames[0]]: input });
    const output = results[session.outputNames[0]];
    const [oh, ow] = output.dims.slice(-2);
    return { ...toMask(output.data, ow, oh, model.output), width: ow, height: oh };
}

function hexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(value || '') ? `0x${value.slice(1)}` : '0xffffff';
}

/** Build the ffmpeg compose command (mask arrives on stdin as raw gray). */
function composeArgs({ inputPath, outputPath, frame, prediction, options }) {
    const format = OUTPUT_FORMATS[options.format] || OUTPUT_FORMATS.png;
    const { width: W, height: H } = frame;
    const filters = [
        '[0:v]format=rgba[img]',
        `[1:v]scale=${W}:${H}:flags=bicubic,format=gray[mask]`
    ];

    let cut = '[img][mask]alphamerge';
    let outW = W;
    let outH = H;
    if (options.trim && prediction.box) {
        const sx = W / prediction.width;
        const sy = H / prediction.height;
        const x = Math.max(0, Math.floor(prediction.box.x0 * sx));
        const y = Math.max(0, Math.floor(prediction.box.y0 * sy));
        outW = Math.min(W, Math.ceil(prediction.box.x1 * sx)) - x;
        outH = Math.min(H, Math.ceil(prediction.box.y1 * sy)) - y;
        cut += `,crop=${outW}:${outH}:${x}:${y}`;
    }

    const opaque = options.background === 'white' || options.background === 'color';
    if (opaque) {
        const color = options.background === 'white' ? '0xffffff' : hexColor(options.color);
        filters.push(`${cut}[cut]`, `color=c=${color}:s=${outW}x${outH}[bg]`, '[bg][cut]overlay=0:0:format=auto,format=rgb24[out]');
    } else {
        filters.push(`${cut}[out]`);
    }

    const codec = format === OUTPUT_FORMATS.webp
        ? ['-c:v', 'libwebp', '-quality', '90', '-pix_fmt', opaque ? 'yuv420p' : 'yuva420p']
        : ['-c:v', 'png', '-pix_fmt', opaque ? 'rgb24' : 'rgba'];

    return {
        size: { width: outW, height: outH },
        args: [
            '-i', inputPath,
            '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${prediction.width}x${prediction.height}`, '-i', 'pipe:0',
            '-filter_complex', filters.join(';'),
            '-map', '[out]', '-frames:v', '1',
            ...codec,
            '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
            '-f', format.muxer, ...(format.muxer === 'image2' ? ['-update', '1'] : []),
            outputPath
        ]
    };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {object} job { inputPath, settings: { bg: { model, format, background, color, trim } }, outputFolder, outputFileName }
 * @param {object} hooks { onProgress, registerCancel }
 */
async function removeBackground(job, hooks = {}) {
    const options = job.settings?.bg || {};
    const model = models.getModel(options.model) || models.getModel(models.DEFAULT_MODEL);
    if (!models.isDownloaded(model)) throw new Error(`${model.label} isn't downloaded yet. Download it from the Model menu.`);

    const format = OUTPUT_FORMATS[options.format] || OUTPUT_FORMATS.png;
    const started = Date.now();
    let cancelled = false;
    const registerCancel = (cancel) => hooks.registerCancel?.(() => { cancelled = true; cancel(); });
    const checkCancelled = () => {
        if (!cancelled) return;
        const error = new Error('Cancelled');
        error.cancelled = true;
        throw error;
    };

    const outputPath = buildOutputPath({
        inputPath: job.inputPath,
        outputFolder: job.outputFolder,
        outputFileName: job.outputFileName,
        suffix: '_nobg',
        extension: format.ext
    });

    try {
        const { rgb, size, frame } = await decodeForModel(model, job.inputPath, { registerCancel });
        hooks.onProgress?.(0.15);
        checkCancelled();

        const prediction = await predictMask(model, rgb, size);
        hooks.onProgress?.(0.8);
        checkCancelled();
        if (!prediction.box) throw new Error('No subject was found in this image.');

        const compose = composeArgs({ inputPath: job.inputPath, outputPath, frame, prediction, options });
        // The mask is streamed to ffmpeg on stdin — no temp files.
        await run(captureFfmpeg(compose.args, { stdin: prediction.mask }), { registerCancel });
        hooks.onProgress?.(1);

        return {
            success: true,
            inputPath: job.inputPath,
            outputPath,
            width: compose.size.width,
            height: compose.size.height,
            model: model.label,
            ms: Date.now() - started
        };
    } catch (error) {
        fs.promises.unlink(outputPath).catch(() => {});
        throw error;
    } finally {
        releaseOutputPath(outputPath);
        scheduleIdleUnload();
    }
}

module.exports = { removeBackground, unloadModel, OUTPUT_FORMATS, inputSizeFor, toTensorData, toMask, composeArgs };
