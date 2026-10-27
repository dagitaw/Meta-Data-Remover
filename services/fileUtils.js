const path = require('path');
const fs = require('fs');
let app = null;
try {
    ({ app } = require('electron'));
} catch {
    // Running outside Electron (e.g. tests) — fall back to the dev bin folder.
}

const IMAGE_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.avif',
    '.heic', '.heif', '.tif', '.tiff', '.ico'
]);

const VIDEO_EXTENSIONS = new Set([
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv',
    '.mpeg', '.mpg', '.3gp', '.m4v', '.ts', '.mts', '.m2ts'
]);

const AUDIO_EXTENSIONS = new Set([
    '.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.opus', '.wma'
]);

const ALL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]
    .map((ext) => ext.slice(1));

/** 'image' | 'video' | 'audio' | null */
function getMediaType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    return null;
}

/**
 * Path to a bundled binary — ALWAYS the copy in the project's bin folder
 * (dev: <project>/bin, installed app: resources/bin). Never falls back to PATH.
 */
function getBinPath(binaryName) {
    const base = app && app.isPackaged
        ? path.join(process.resourcesPath, 'bin')
        : path.join(__dirname, '..', 'bin');

    const exe = process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
    const bundled = path.join(base, exe);

    if (!fs.existsSync(bundled)) {
        throw new Error(`${exe} was not found in the bin folder (${base}).`);
    }
    return bundled;
}

/** Strip characters Windows does not allow in file names. */
function sanitizeName(name) {
    return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
}

// Output paths handed out to jobs that are still running. Jobs run in parallel,
// so the file may not exist on disk yet when the next job picks a name.
const reservedOutputs = new Set();
const pathKey = (p) => path.resolve(p).toLowerCase();

/**
 * Build an output path that never overwrites an existing file, the input itself,
 * or another running job's output: "name.mp4" -> "name (1).mp4" -> ...
 * Call releaseOutputPath() when the job finishes.
 */
function buildOutputPath({ inputPath, outputFolder, outputFileName, suffix, extension }) {
    const targetDir = outputFolder || path.dirname(inputPath);
    const requested = outputFileName ? sanitizeName(outputFileName) : '';

    const base = requested
        ? requested.slice(0, requested.length - path.extname(requested).length) || requested
        : `${path.basename(inputPath, path.extname(inputPath))}${suffix || ''}`;

    const inputKey = pathKey(inputPath);
    const isTaken = (candidate) => {
        const key = pathKey(candidate);
        return key === inputKey || reservedOutputs.has(key) || fs.existsSync(candidate);
    };

    let candidate = path.join(targetDir, `${base}${extension}`);
    for (let counter = 1; isTaken(candidate); counter += 1) {
        candidate = path.join(targetDir, `${base} (${counter})${extension}`);
    }

    reservedOutputs.add(pathKey(candidate));
    return candidate;
}

function releaseOutputPath(outputPath) {
    if (outputPath) reservedOutputs.delete(pathKey(outputPath));
}

const MAX_FOLDER_DEPTH = 3;

async function describeFile(filePath, size) {
    const type = getMediaType(filePath);
    if (size === undefined && type) {
        size = (await fs.promises.stat(filePath)).size;
    }
    return { path: filePath, name: path.basename(filePath), size, type, supported: Boolean(type) };
}

/** List supported media inside a folder. Unsupported files are skipped without a stat call. */
async function scanFolder(folder, depth) {
    if (depth > MAX_FOLDER_DEPTH) return [];

    let entries;
    try {
        entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch {
        return [];
    }

    const nested = await Promise.all(entries.map((entry) => {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) return scanFolder(full, depth + 1);
        if (entry.isFile() && getMediaType(full)) return describeFile(full).then((f) => [f], () => []);
        return [];
    }));
    return nested.flat();
}

/**
 * Turn dropped/selected paths into media file descriptions (all stats run in parallel).
 * Folders are expanded up to MAX_FOLDER_DEPTH levels; files the user picked directly are
 * always returned (unsupported ones flagged) so the UI can say how many were skipped.
 */
async function resolveMediaPaths(paths) {
    const resolved = await Promise.all(paths.map(async (p) => {
        let stat;
        try {
            stat = await fs.promises.stat(p);
        } catch {
            return [];
        }
        if (stat.isDirectory()) return scanFolder(p, 1);
        if (stat.isFile()) return [await describeFile(p, stat.size)];
        return [];
    }));
    return resolved.flat();
}

module.exports = {
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    AUDIO_EXTENSIONS,
    ALL_EXTENSIONS,
    getMediaType,
    getBinPath,
    buildOutputPath,
    releaseOutputPath,
    resolveMediaPaths
};
