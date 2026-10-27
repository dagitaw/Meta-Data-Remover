const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getBinPath, getMediaType, buildOutputPath, releaseOutputPath } = require('./fileUtils');
const { runFfmpeg } = require('./ffmpeg');

/* ------------------------------------------------------------------ */
/* Image format detection                                              */
/* ------------------------------------------------------------------ */

// ISO-BMFF brands (the "ftyp" box) used by HEIC/HEIF/AVIF files.
const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);

/**
 * Work out an image's real format from its first bytes (files are often
 * mis-labelled, e.g. a WebP saved as .jpg). Returns an extension or null.
 * Much faster than asking ExifTool, which means starting Perl.
 */
async function sniffImageExtension(filePath) {
    const handle = await fs.promises.open(filePath, 'r');
    let header;
    try {
        header = Buffer.alloc(64);
        const { bytesRead } = await handle.read(header, 0, 64, 0);
        header = header.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }

    const ascii = (start, end) => header.toString('latin1', start, end);

    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return '.jpg';
    if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
    if (ascii(0, 4) === 'GIF8') return '.gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return '.webp';
    if (ascii(0, 2) === 'BM') return '.bmp';
    if (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*') return '.tiff';

    if (ascii(4, 8) === 'ftyp') {
        const boxSize = Math.min(header.readUInt32BE(0), header.length);
        const brands = [ascii(8, 12)];
        for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(ascii(i, i + 4));

        if (brands.some((b) => AVIF_BRANDS.has(b))) return '.avif';
        if (brands.some((b) => HEIC_BRANDS.has(b))) return '.heic';
        if (brands.some((b) => HEIF_BRANDS.has(b))) return '.heif';
    }

    return null;
}

/* ------------------------------------------------------------------ */
/* ExifTool                                                            */
/* ------------------------------------------------------------------ */

// ExifTool's FileType -> extension (only used when sniffing fails).
const EXIFTOOL_TYPE_TO_EXTENSION = {
    jpeg: '.jpg', jpg: '.jpg', png: '.png', webp: '.webp', gif: '.gif', bmp: '.bmp',
    avif: '.avif', heic: '.heic', heif: '.heif', tiff: '.tiff'
};

function exiftool(args) {
    return new Promise((resolve, reject) => {
        let exiftoolPath;
        try {
            exiftoolPath = getBinPath('exiftool');
        } catch (error) {
            return reject(error);
        }
        execFile(exiftoolPath, args, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) return reject(new Error((stderr || error.message).toString().trim()));
            resolve(stdout.toString());
        });
    });
}

async function detectImageExtension(filePath) {
    const sniffed = await sniffImageExtension(filePath);
    if (sniffed) return sniffed;

    const type = (await exiftool(['-s3', '-FileType', filePath])).trim().toLowerCase();
    const ext = EXIFTOOL_TYPE_TO_EXTENSION[type];
    if (!ext) throw new Error(`Unsupported or unknown image format: "${type || path.extname(filePath)}".`);
    return ext;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

async function cleanImage(filePath, outputFolder, outputFileName) {
    const extension = await detectImageExtension(filePath);
    const outputPath = buildOutputPath({
        inputPath: filePath, outputFolder, outputFileName, suffix: '_clean', extension
    });

    const sameFamily = (a, b) => a === b || (/^\.jpe?g$/.test(a) && /^\.jpe?g$/.test(b)) ||
        (/^\.tiff?$/.test(a) && /^\.tiff?$/.test(b));

    try {
        if (extension === '.bmp') {
            // BMP has no metadata blocks (and ExifTool can't write it) — a copy is already clean.
            await fs.promises.copyFile(filePath, outputPath);
        } else if (sameFamily(path.extname(filePath).toLowerCase(), extension)) {
            // "-o" writes a new, stripped file in one pass (no copy-then-rewrite).
            await exiftool(['-all=', '-m', '-o', outputPath, filePath]);
        } else {
            // Mislabeled file (e.g. WebP named .jpg): ExifTool goes by the extension,
            // so give it a correctly named copy and clean that in place.
            await fs.promises.copyFile(filePath, outputPath);
            await exiftool(['-all=', '-m', '-overwrite_original', outputPath]);
        }
    } catch (error) {
        fs.promises.unlink(outputPath).catch(() => {});
        throw error;
    } finally {
        releaseOutputPath(outputPath);
    }
    return outputPath;
}

async function cleanVideoOrAudio(filePath, outputFolder, outputFileName, hooks) {
    const outputPath = buildOutputPath({
        inputPath: filePath,
        outputFolder,
        outputFileName,
        suffix: '_clean',
        extension: path.extname(filePath).toLowerCase()
    });

    const run = runFfmpeg([
        '-i', filePath,
        '-map', '0',
        '-map_metadata', '-1',
        '-map_chapters', '-1',
        '-c', 'copy',
        '-fflags', '+bitexact',
        '-metadata', 'encoder=',
        outputPath
    ], { onProgress: hooks.onProgress });

    hooks.registerCancel?.(run.cancel);

    try {
        await run.promise;
    } catch (error) {
        fs.promises.unlink(outputPath).catch(() => {});
        throw error;
    } finally {
        releaseOutputPath(outputPath);
    }
    return outputPath;
}

/**
 * Lossless metadata removal.
 * Images: ExifTool. Video/audio: ffmpeg stream copy without metadata.
 */
async function removeMetaData(filePath, outputFolder, outputFileName, hooks = {}) {
    const mediaType = getMediaType(filePath);
    let outputPath;

    if (mediaType === 'image') {
        outputPath = await cleanImage(filePath, outputFolder, outputFileName);
    } else if (mediaType === 'video' || mediaType === 'audio') {
        outputPath = await cleanVideoOrAudio(filePath, outputFolder, outputFileName, hooks);
    } else {
        throw new Error(`Unsupported file type: ${path.extname(filePath)}`);
    }

    hooks.onProgress?.(1);
    return { success: true, inputPath: filePath, outputPath };
}

module.exports = removeMetaData;
module.exports.sniffImageExtension = sniffImageExtension;
