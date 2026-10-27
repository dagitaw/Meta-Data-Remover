/**
 * Every output format/codec the converter supports, plus the ffmpeg
 * arguments for each. This file is the single source of truth: the
 * renderer receives the catalog (labels, which codecs fit which
 * container) over IPC, and convertMedia.js builds commands from it.
 */

const QUALITY_LEVELS = ['high', 'balanced', 'small'];

const pick = (quality, table) => table[QUALITY_LEVELS.includes(quality) ? quality : 'balanced'];

/* ------------------------------------------------------------------ */
/* Video codecs                                                        */
/* ------------------------------------------------------------------ */

const VIDEO_CODECS = {
    h264: {
        label: 'H.264 (AVC)',
        hint: 'Plays everywhere. Best for YouTube, phones, editors.',
        group: 'software',
        encoders: ['libx264'],
        args: (_enc, q) => [
            '-c:v', 'libx264', '-preset', 'medium',
            '-crf', pick(q, { high: '18', balanced: '23', small: '28' }),
            '-pix_fmt', 'yuv420p'
        ]
    },
    hevc: {
        label: 'H.265 (HEVC)',
        hint: 'About half the size of H.264 at the same quality. Slower.',
        group: 'software',
        encoders: ['libx265'],
        args: (_enc, q, ctx) => [
            '-c:v', 'libx265', '-preset', 'medium',
            '-crf', pick(q, { high: '20', balanced: '26', small: '30' }),
            '-pix_fmt', 'yuv420p',
            '-x265-params', 'log-level=error',
            ...(ctx.appleTag ? ['-tag:v', 'hvc1'] : [])
        ]
    },
    av1: {
        label: 'AV1',
        hint: 'Smallest files, newest codec. Slowest to encode.',
        group: 'software',
        encoders: ['libsvtav1', 'libaom-av1'],
        args: (enc, q) => enc === 'libsvtav1'
            ? ['-c:v', 'libsvtav1', '-preset', '8',
                '-crf', pick(q, { high: '24', balanced: '32', small: '40' }),
                '-pix_fmt', 'yuv420p']
            : ['-c:v', 'libaom-av1', '-cpu-used', '6', '-row-mt', '1', '-b:v', '0',
                '-crf', pick(q, { high: '24', balanced: '32', small: '40' }),
                '-pix_fmt', 'yuv420p']
    },
    vp9: {
        label: 'VP9',
        hint: 'Open codec used by WebM and YouTube.',
        group: 'software',
        encoders: ['libvpx-vp9'],
        args: (_enc, q) => [
            '-c:v', 'libvpx-vp9', '-b:v', '0', '-row-mt', '1',
            '-deadline', 'good', '-cpu-used', '4',
            '-crf', pick(q, { high: '24', balanced: '32', small: '38' }),
            '-pix_fmt', 'yuv420p'
        ]
    },
    prores: {
        label: 'Apple ProRes',
        hint: 'Editing codec. Huge files, very fast to scrub. Quality picks HQ / Standard / LT.',
        group: 'software',
        encoders: ['prores_ks'],
        args: (_enc, q) => [
            '-c:v', 'prores_ks',
            '-profile:v', pick(q, { high: '3', balanced: '2', small: '1' }),
            '-pix_fmt', 'yuv422p10le'
        ]
    },
    mpeg4: {
        label: 'MPEG-4 Part 2 (Xvid)',
        hint: 'Legacy codec for old players.',
        group: 'software',
        encoders: ['mpeg4'],
        args: (_enc, q) => [
            '-c:v', 'mpeg4', '-q:v', pick(q, { high: '2', balanced: '4', small: '8' })
        ]
    },
    h264_nvenc: {
        label: 'H.264 — NVIDIA GPU',
        hint: 'Much faster on NVIDIA graphics cards.',
        group: 'hardware',
        encoders: ['h264_nvenc'],
        args: (_enc, q) => [
            '-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-b:v', '0',
            '-cq', pick(q, { high: '19', balanced: '24', small: '30' }),
            '-pix_fmt', 'yuv420p'
        ]
    },
    hevc_nvenc: {
        label: 'H.265 — NVIDIA GPU',
        hint: 'Much faster on NVIDIA graphics cards.',
        group: 'hardware',
        encoders: ['hevc_nvenc'],
        args: (_enc, q, ctx) => [
            '-c:v', 'hevc_nvenc', '-preset', 'p5', '-rc', 'vbr', '-b:v', '0',
            '-cq', pick(q, { high: '21', balanced: '26', small: '31' }),
            '-pix_fmt', 'yuv420p',
            ...(ctx.appleTag ? ['-tag:v', 'hvc1'] : [])
        ]
    },
    h264_qsv: {
        label: 'H.264 — Intel GPU',
        hint: 'Intel Quick Sync.',
        group: 'hardware',
        encoders: ['h264_qsv'],
        args: (_enc, q) => [
            '-c:v', 'h264_qsv', '-pix_fmt', 'nv12',
            '-global_quality', pick(q, { high: '20', balanced: '25', small: '30' })
        ]
    },
    hevc_qsv: {
        label: 'H.265 — Intel GPU',
        hint: 'Intel Quick Sync.',
        group: 'hardware',
        encoders: ['hevc_qsv'],
        args: (_enc, q, ctx) => [
            '-c:v', 'hevc_qsv', '-pix_fmt', 'nv12',
            '-global_quality', pick(q, { high: '22', balanced: '27', small: '32' }),
            ...(ctx.appleTag ? ['-tag:v', 'hvc1'] : [])
        ]
    },
    h264_amf: {
        label: 'H.264 — AMD GPU',
        hint: 'AMD AMF.',
        group: 'hardware',
        encoders: ['h264_amf'],
        args: (_enc, q) => {
            const qp = pick(q, { high: '18', balanced: '23', small: '28' });
            return ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', qp, '-qp_p', qp, '-pix_fmt', 'yuv420p'];
        }
    },
    hevc_amf: {
        label: 'H.265 — AMD GPU',
        hint: 'AMD AMF.',
        group: 'hardware',
        encoders: ['hevc_amf'],
        args: (_enc, q, ctx) => {
            const qp = pick(q, { high: '20', balanced: '25', small: '30' });
            return ['-c:v', 'hevc_amf', '-rc', 'cqp', '-qp_i', qp, '-qp_p', qp, '-pix_fmt', 'yuv420p',
                ...(ctx.appleTag ? ['-tag:v', 'hvc1'] : [])];
        }
    },
    copy: {
        label: 'Keep original (no re-encode)',
        hint: 'Instant and lossless. Only changes the container — may fail if the codec does not fit.',
        group: 'other',
        encoders: [],
        args: () => ['-c:v', 'copy']
    }
};

const HW_H264_H265 = ['h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_amf', 'hevc_amf'];

/* ------------------------------------------------------------------ */
/* Audio codecs                                                        */
/* ------------------------------------------------------------------ */

const AUDIO_CODECS = {
    aac: (q) => ['-c:a', 'aac', '-b:a', pick(q, { high: '256k', balanced: '192k', small: '128k' })],
    opus: (q) => ['-c:a', 'libopus', '-b:a', pick(q, { high: '192k', balanced: '128k', small: '96k' })],
    mp3: (q) => ['-c:a', 'libmp3lame', '-q:a', pick(q, { high: '0', balanced: '2', small: '5' })],
    pcm: () => ['-c:a', 'pcm_s16le'],
    flac: () => ['-c:a', 'flac']
};

/* ------------------------------------------------------------------ */
/* Video containers (+ audio-only extraction)                          */
/* ------------------------------------------------------------------ */

const VIDEO_FORMATS = [
    {
        id: 'mp4', label: 'MP4', ext: '.mp4', kind: 'video', audio: 'aac', appleTag: true,
        codecs: ['h264', 'hevc', 'av1', ...HW_H264_H265, 'copy'],
        extra: ['-movflags', '+faststart']
    },
    {
        id: 'mov', label: 'MOV (QuickTime)', ext: '.mov', kind: 'video', audio: 'aac', appleTag: true,
        codecs: ['h264', 'hevc', 'prores', ...HW_H264_H265, 'copy'],
        extra: ['-movflags', '+faststart']
    },
    {
        id: 'mkv', label: 'MKV (Matroska)', ext: '.mkv', kind: 'video', audio: 'aac',
        codecs: ['h264', 'hevc', 'av1', 'vp9', ...HW_H264_H265, 'copy']
    },
    {
        id: 'webm', label: 'WebM', ext: '.webm', kind: 'video', audio: 'opus',
        codecs: ['vp9', 'av1']
    },
    {
        id: 'avi', label: 'AVI', ext: '.avi', kind: 'video', audio: 'mp3',
        codecs: ['mpeg4', 'h264', 'copy']
    },
    { id: 'gif', label: 'GIF (animated)', ext: '.gif', kind: 'gif', codecs: [] },
    { id: 'mp3', label: 'MP3 — audio only', ext: '.mp3', kind: 'audio', audio: 'mp3', codecs: [] },
    { id: 'm4a', label: 'M4A (AAC) — audio only', ext: '.m4a', kind: 'audio', audio: 'aac', codecs: [] },
    { id: 'wav', label: 'WAV — audio only', ext: '.wav', kind: 'audio', audio: 'pcm', codecs: [] }
];

const AUDIO_FORMATS = [
    { id: 'mp3', label: 'MP3', ext: '.mp3', audio: 'mp3' },
    { id: 'm4a', label: 'M4A (AAC)', ext: '.m4a', audio: 'aac' },
    { id: 'opus', label: 'Opus', ext: '.opus', audio: 'opus' },
    { id: 'wav', label: 'WAV (lossless)', ext: '.wav', audio: 'pcm' },
    { id: 'flac', label: 'FLAC (lossless)', ext: '.flac', audio: 'flac' }
];

/* ------------------------------------------------------------------ */
/* Image formats                                                       */
/* ------------------------------------------------------------------ */

// Quality is 1..100 (like most image editors).
const jpegQ = (q) => String(Math.round(31 - (q / 100) * 29)); // 100 -> 2, 1 -> ~31
const avifCrf = (q) => String(Math.max(0, Math.min(63, Math.round(63 - q * 0.5))));

const IMAGE_FORMATS = [
    {
        id: 'jpg', label: 'JPG', ext: '.jpg', lossy: true, muxer: 'image2',
        args: (q) => ['-c:v', 'mjpeg', '-q:v', jpegQ(q)]
    },
    {
        id: 'png', label: 'PNG', ext: '.png', lossy: false, muxer: 'image2',
        args: () => ['-c:v', 'png', '-pred', 'mixed']
    },
    {
        id: 'webp', label: 'WebP', ext: '.webp', lossy: true, muxer: 'webp',
        encoders: ['libwebp'],
        args: (q) => q >= 100
            ? ['-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6']
            : ['-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6']
    },
    {
        id: 'avif', label: 'AVIF', ext: '.avif', lossy: true, muxer: 'avif',
        encoders: ['libaom-av1', 'libsvtav1'],
        args: (q, enc) => enc === 'libsvtav1'
            ? ['-c:v', 'libsvtav1', '-preset', '8', '-crf', avifCrf(q), '-pix_fmt', 'yuv420p']
            : ['-c:v', 'libaom-av1', '-still-picture', '1', '-cpu-used', '6', '-b:v', '0',
                '-crf', avifCrf(q), '-pix_fmt', 'yuv420p'],
        // SVT-AV1 refuses odd dimensions
        filters: (enc) => enc === 'libsvtav1' ? ['pad=ceil(iw/2)*2:ceil(ih/2)*2'] : []
    },
    {
        id: 'bmp', label: 'BMP', ext: '.bmp', lossy: false, muxer: 'image2',
        args: () => ['-c:v', 'bmp']
    },
    {
        id: 'tiff', label: 'TIFF', ext: '.tiff', lossy: false, muxer: 'image2',
        args: () => ['-c:v', 'tiff', '-compression_algo', 'lzw']
    },
    {
        id: 'gif', label: 'GIF', ext: '.gif', lossy: false, muxer: 'gif', palette: true,
        args: () => ['-c:v', 'gif']
    },
    {
        id: 'ico', label: 'ICO (icon, max 256px)', ext: '.ico', lossy: false, muxer: 'ico',
        args: () => ['-c:v', 'png', '-pix_fmt', 'rgba'],
        filters: () => ["scale='min(256,iw)':'min(256,ih)':force_original_aspect_ratio=decrease"]
    }
];

/* ------------------------------------------------------------------ */
/* Option lists shown in the UI                                        */
/* ------------------------------------------------------------------ */

const VIDEO_RESOLUTIONS = [
    { id: 'original', label: 'Original' },
    { id: '2160', label: '4K (2160p)' },
    { id: '1440', label: '1440p' },
    { id: '1080', label: '1080p' },
    { id: '720', label: '720p' },
    { id: '480', label: '480p' },
    { id: '360', label: '360p' }
];

const VIDEO_FPS = [
    { id: 'original', label: 'Original' },
    { id: '60', label: '60 fps' },
    { id: '30', label: '30 fps' },
    { id: '24', label: '24 fps' },
    { id: '15', label: '15 fps' }
];

const IMAGE_SIZES = [
    { id: 'original', label: 'Original' },
    { id: '3840', label: '3840 px' },
    { id: '2560', label: '2560 px' },
    { id: '1920', label: '1920 px' },
    { id: '1280', label: '1280 px' },
    { id: '1080', label: '1080 px' },
    { id: '720', label: '720 px' },
    { id: '512', label: '512 px' }
];

/** Plain-data catalog sent to the renderer. */
function getCatalog(availableEncoders) {
    const has = (encoders) => !encoders || encoders.length === 0 ||
        encoders.some((e) => availableEncoders.includes(e));

    return {
        qualityLevels: QUALITY_LEVELS,
        videoCodecs: Object.fromEntries(
            Object.entries(VIDEO_CODECS).map(([id, c]) => [id, {
                id, label: c.label, hint: c.hint, group: c.group, available: has(c.encoders)
            }])
        ),
        videoFormats: VIDEO_FORMATS.map(({ id, label, ext, kind, codecs }) => ({ id, label, ext, kind, codecs })),
        audioFormats: AUDIO_FORMATS.map(({ id, label, ext }) => ({ id, label, ext })),
        imageFormats: IMAGE_FORMATS.map(({ id, label, ext, lossy, encoders }) => ({
            id, label, ext, lossy, available: has(encoders)
        })),
        videoResolutions: VIDEO_RESOLUTIONS,
        videoFps: VIDEO_FPS,
        imageSizes: IMAGE_SIZES
    };
}

module.exports = {
    VIDEO_CODECS,
    AUDIO_CODECS,
    VIDEO_FORMATS,
    AUDIO_FORMATS,
    IMAGE_FORMATS,
    getCatalog
};
