const { spawn, execFile } = require('child_process');
const { getBinPath } = require('./fileUtils');

let encoderCache = null;

/** Ask the bundled ffmpeg which encoders it was built with (cached). */
function getAvailableEncoders() {
    if (encoderCache) return encoderCache;

    encoderCache = new Promise((resolve) => {
        let ffmpegPath;
        try {
            ffmpegPath = getBinPath('ffmpeg');
        } catch (error) {
            console.error(error.message);
            encoderCache = null;
            return resolve([]);
        }
        execFile(
            ffmpegPath,
            ['-hide_banner', '-encoders'],
            { maxBuffer: 10 * 1024 * 1024, windowsHide: true },
            (error, stdout) => {
                if (error) {
                    console.error('Could not list ffmpeg encoders:', error.message);
                    encoderCache = null;
                    return resolve([]);
                }

                const names = [];
                for (const line of stdout.split(/\r?\n/)) {
                    // Lines look like: " V....D libx264    libx264 H.264 / AVC ..."
                    const match = line.match(/^\s[VAS][A-Z.]{5}\s+(\S+)/);
                    if (match) names.push(match[1]);
                }
                resolve(names);
            }
        );
    });

    return encoderCache;
}

function parseTimestamp(text) {
    const match = text.match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Pull the most useful line out of ffmpeg's stderr. */
function summariseFfmpegError(stderr) {
    const lines = stderr
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !/^(frame=|size=|Press \[q\]|\[out#|Conversion failed!|\[Parsed_showinfo)/.test(l));

    const important = lines.filter((l) =>
        /error|invalid|not supported|unsupported|could not|unknown|no such|incompatible|cannot|failed|matches no streams|requires/i.test(l)
    );

    return (important.slice(-2).join(' — ') || lines.slice(-1)[0] || '').slice(0, 400);
}

/**
 * Shared process runner. Returns { promise, cancel }.
 * The promise resolves with the stderr text (capped at `stderrLimit`).
 */
function spawnFfmpeg(args, { onStdout, onStderr, stdin, stderrLimit = 4000 } = {}) {
    let child;
    let cancelled = false;

    const promise = new Promise((resolve, reject) => {
        try {
            child = spawn(getBinPath('ffmpeg'), ['-hide_banner', '-y', ...args], { windowsHide: true });
        } catch (error) {
            return reject(error);
        }

        let stderr = '';
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr = (stderr + text).slice(-stderrLimit);
            onStderr?.(text, stderr);
        });
        if (onStdout) child.stdout.on('data', onStdout);
        else child.stdout.resume();

        if (stdin) {
            child.stdin.on('error', () => { /* ffmpeg may exit before reading everything */ });
            child.stdin.end(stdin);
        }

        child.on('error', (error) => reject(new Error(`Could not start ffmpeg: ${error.message}`)));
        child.on('close', (code) => {
            if (cancelled) {
                const err = new Error('Cancelled');
                err.cancelled = true;
                return reject(err);
            }
            if (code === 0) return resolve(stderr);

            const err = new Error(summariseFfmpegError(stderr) || `ffmpeg exited with code ${code}`);
            err.stderr = stderr;
            reject(err);
        });
    });

    return {
        promise,
        cancel: () => {
            cancelled = true;
            if (child && !child.killed) child.kill();
        }
    };
}

/**
 * Run ffmpeg that writes a file, reporting progress (0..1) from `-progress`.
 * Returns { promise, cancel }.
 */
function runFfmpeg(args, { onProgress } = {}) {
    let duration = null;
    let lineBuffer = '';

    return spawnFfmpeg(['-nostdin', '-progress', 'pipe:1', '-nostats', ...args], {
        onStderr: (_text, stderr) => {
            if (duration !== null) return;
            const match = stderr.match(/Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/);
            if (match) duration = parseTimestamp(match[1]);
        },
        onStdout: (chunk) => {
            lineBuffer += chunk.toString();
            const lines = lineBuffer.split(/\r?\n/);
            lineBuffer = lines.pop();

            for (const line of lines) {
                const [key, value] = line.split('=');
                if ((key === 'out_time_us' || key === 'out_time_ms') && duration) {
                    const seconds = Number(value) / 1e6;
                    if (Number.isFinite(seconds) && seconds >= 0) onProgress?.(Math.min(seconds / duration, 0.999));
                } else if (key === 'progress' && value === 'end') {
                    onProgress?.(1);
                }
            }
        }
    });
}

/**
 * Run ffmpeg that writes raw data to stdout (`pipe:1`) and collect it.
 * `stdin` (Buffer) is fed to `pipe:0`. Returns { promise -> {stdout, stderr}, cancel }.
 */
function captureFfmpeg(args, { stdin } = {}) {
    const chunks = [];
    const run = spawnFfmpeg(args, {
        stdin,
        stderrLimit: 64 * 1024,
        onStdout: (chunk) => chunks.push(chunk)
    });
    return {
        cancel: run.cancel,
        promise: run.promise.then((stderr) => ({ stdout: Buffer.concat(chunks), stderr }))
    };
}

module.exports = { getAvailableEncoders, runFfmpeg, captureFfmpeg };
