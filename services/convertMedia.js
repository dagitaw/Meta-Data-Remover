const fs = require('fs');
const { runFfmpeg, getAvailableEncoders } = require('./ffmpeg');
const { buildOutputPath, releaseOutputPath } = require('./fileUtils');
const {
    VIDEO_CODECS, AUDIO_CODECS, VIDEO_FORMATS, AUDIO_FORMATS, IMAGE_FORMATS
} = require('./formats');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function metadataArgs(strip, { audio = true } = {}) {
    if (!strip) return ['-map_metadata', '0'];
    return [
        '-map_metadata', '-1',
        '-map_chapters', '-1',
        '-fflags', '+bitexact',
        '-flags:v', '+bitexact',
        ...(audio ? ['-flags:a', '+bitexact'] : [])
    ];
}

/** Scale so the SHORT side equals `target` (never upscales, keeps even sizes). */
function shortSideScale(target) {
    const t = Number(target);
    return `scale='if(gt(iw,ih),-2,trunc(min(${t},iw)/2)*2)':'if(gt(iw,ih),trunc(min(${t},ih)/2)*2,-2)'`;
}

/** Scale so the LONG side is at most `target` (images). */
function longSideScale(target) {
    const t = Number(target);
    return `scale='if(gte(iw,ih),min(${t},iw),-1)':'if(gte(iw,ih),-1,min(${t},ih))'`;
}

async function pickEncoder(candidates, label) {
    if (!candidates || candidates.length === 0) return null;
    const available = await getAvailableEncoders();
    // If detection failed, just try the first candidate and let ffmpeg report.
    if (available.length === 0) return candidates[0];
    const found = candidates.find((e) => available.includes(e));
    if (!found) {
        throw new Error(`Your ffmpeg build does not include an encoder for ${label} (${candidates.join(' / ')}).`);
    }
    return found;
}

function friendlyError(error) {
    const msg = error.message || String(error);
    const full = `${msg}\n${error.stderr || ''}`;
    if (/'0:a[^']*' matches no streams/i.test(full)) return 'This file has no audio track.';
    if (/'0:v[^']*' matches no streams/i.test(full)) return 'This file has no video or image track.';
    if (/Cannot load (nvcuda|libcuda)|No NVENC capable devices|OpenEncodeSessionEx failed/i.test(full)) {
        return 'No NVIDIA GPU encoder available on this computer. Pick a software codec instead.';
    }
    if (/MFX|qsv/i.test(msg) && /error|fail/i.test(msg)) {
        return 'Intel Quick Sync is not available on this computer. Pick a software codec instead.';
    }
    if (/amf/i.test(msg) && /fail|error/i.test(msg)) {
        return 'AMD AMF encoder is not available on this computer. Pick a software codec instead.';
    }
    if (/Could not find tag for codec|codec not currently supported in container/i.test(full)) {
        return 'That codec cannot go into this format. Choose a different codec, or re-encode instead of "Keep original".';
    }
    return msg;
}

/* ------------------------------------------------------------------ */
/* Command builders                                                    */
/* ------------------------------------------------------------------ */

async function buildVideoCommand(input, output, video, strip) {
    const format = VIDEO_FORMATS.find((f) => f.id === video.format) || VIDEO_FORMATS[0];
    const quality = video.quality || 'balanced';

    // Audio-only extraction (mp3/m4a/wav from a video)
    if (format.kind === 'audio') {
        return [
            '-i', input, '-map', '0:a:0', '-vn',
            ...AUDIO_CODECS[format.audio](quality),
            ...metadataArgs(strip, { audio: true }),
            output
        ];
    }

    // Animated GIF with a generated palette (much better colours)
    if (format.kind === 'gif') {
        const fps = video.fps && video.fps !== 'original' ? video.fps : '15';
        const pre = [`fps=${fps}`];
        if (video.resolution && video.resolution !== 'original') pre.push(shortSideScale(video.resolution));
        const colors = quality === 'small' ? 128 : 256;
        const graph = `[0:v]${pre.join(',')},split[a][b];` +
            `[a]palettegen=stats_mode=diff:max_colors=${colors}[p];` +
            `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
        return [
            '-i', input, '-filter_complex', graph, '-loop', '0', '-an',
            ...metadataArgs(strip, { audio: false }),
            output
        ];
    }

    const codecId = format.codecs.includes(video.codec) ? video.codec : format.codecs[0];
    const codec = VIDEO_CODECS[codecId];
    const encoder = await pickEncoder(codec.encoders, codec.label);
    const keepAudio = video.audio !== 'remove';
    const isCopy = codecId === 'copy';

    const filters = [];
    if (!isCopy) {
        if (video.resolution && video.resolution !== 'original') {
            filters.push(shortSideScale(video.resolution));
        } else {
            filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2'); // most encoders need even sizes
        }
        if (video.fps && video.fps !== 'original') filters.push(`fps=${video.fps}`);
    }

    const audioArgs = !keepAudio
        ? ['-an']
        : isCopy ? ['-c:a', 'copy'] : AUDIO_CODECS[format.audio](quality);

    return [
        '-i', input,
        '-map', '0:v:0',
        ...(keepAudio ? ['-map', '0:a?'] : []),
        ...(filters.length ? ['-vf', filters.join(',')] : []),
        ...codec.args(encoder, quality, { appleTag: Boolean(format.appleTag) }),
        ...audioArgs,
        '-sn', '-dn',
        ...metadataArgs(strip, { audio: keepAudio }),
        ...(format.extra || []),
        output
    ];
}

function buildAudioCommand(input, output, audio, strip) {
    const format = AUDIO_FORMATS.find((f) => f.id === audio.format) || AUDIO_FORMATS[0];
    return [
        '-i', input, '-map', '0:a:0', '-vn',
        ...AUDIO_CODECS[format.audio](audio.quality || 'balanced'),
        ...metadataArgs(strip, { audio: true }),
        output
    ];
}

async function buildImageCommand(input, output, image, strip) {
    const format = IMAGE_FORMATS.find((f) => f.id === image.format) || IMAGE_FORMATS[0];
    const quality = Math.max(1, Math.min(100, Number(image.quality) || 85));
    const encoder = await pickEncoder(format.encoders, format.label);

    const filters = [];
    if (image.size && image.size !== 'original') filters.push(longSideScale(image.size));
    if (format.filters) filters.push(...format.filters(encoder));

    const filterArgs = format.palette
        ? ['-filter_complex',
            `[0:v]${filters.length ? filters.join(',') + ',' : ''}split[a][b];[a]palettegen[p];[b][p]paletteuse`]
        : filters.length ? ['-vf', filters.join(',')] : [];

    return [
        '-i', input,
        // filter_complex outputs are mapped automatically; adding -map too would create a 2nd stream
        ...(format.palette ? [] : ['-map', '0:v:0']),
        '-frames:v', '1',
        ...filterArgs,
        ...format.args(quality, encoder),
        ...metadataArgs(strip, { audio: false }),
        '-f', format.muxer,
        ...(format.muxer === 'image2' ? ['-update', '1'] : []),
        output
    ];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

function getTargetExtension(mediaType, settings) {
    if (mediaType === 'image') {
        return (IMAGE_FORMATS.find((f) => f.id === settings.image?.format) || IMAGE_FORMATS[0]).ext;
    }
    if (mediaType === 'audio') {
        return (AUDIO_FORMATS.find((f) => f.id === settings.audio?.format) || AUDIO_FORMATS[0]).ext;
    }
    return (VIDEO_FORMATS.find((f) => f.id === settings.video?.format) || VIDEO_FORMATS[0]).ext;
}

/** Turn a failed ffmpeg run into a message a person can act on. */
function conversionError(error, mediaType, settings) {
    const codec = mediaType === 'video' ? VIDEO_CODECS[settings.video?.codec] : null;
    const details = `${error.message}\n${error.stderr || ''}`;

    if (codec?.group === 'hardware' && /encoder|device|cuda|nvenc|qsv|mfx|amf|driver/i.test(details)) {
        return new Error(`The ${codec.label} encoder could not start — this computer may not have that GPU, ` +
            'or its driver is out of date. Pick a software codec (H.264 / H.265) instead.');
    }
    return new Error(friendlyError(error));
}

const COMMAND_BUILDERS = {
    image: (input, output, settings, strip) => buildImageCommand(input, output, settings.image || {}, strip),
    audio: (input, output, settings, strip) => buildAudioCommand(input, output, settings.audio || {}, strip),
    video: (input, output, settings, strip) => buildVideoCommand(input, output, settings.video || {}, strip)
};

/**
 * Convert one file.
 * @param {object} job { inputPath, mediaType, settings, outputFolder, outputFileName }
 * @param {object} hooks { onProgress(0..1), registerCancel(fn) }
 */
async function convertMedia(job, hooks = {}) {
    const { inputPath, mediaType, settings = {}, outputFolder, outputFileName } = job;
    const buildCommand = COMMAND_BUILDERS[mediaType];
    if (!buildCommand) throw new Error('Unsupported file type.');

    const outputPath = buildOutputPath({
        inputPath,
        outputFolder,
        outputFileName,
        suffix: '_converted',
        extension: getTargetExtension(mediaType, settings)
    });

    try {
        const args = await buildCommand(inputPath, outputPath, settings, settings.stripMetadata !== false);
        console.log('ffmpeg', args.join(' '));

        const run = runFfmpeg(args, { onProgress: hooks.onProgress });
        hooks.registerCancel?.(run.cancel);
        await run.promise;
    } catch (error) {
        fs.promises.unlink(outputPath).catch(() => {}); // don't leave half-written files behind
        throw error.cancelled ? error : conversionError(error, mediaType, settings);
    } finally {
        releaseOutputPath(outputPath);
    }

    hooks.onProgress?.(1);
    return { success: true, inputPath, outputPath };
}

module.exports = { convertMedia, buildVideoCommand, buildImageCommand, buildAudioCommand };
