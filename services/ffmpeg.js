const { spawn, execFile } = require('child_process');
const { getBinPath } = require('./fileUtils');

let encoderCache = null;

/** Ask the bundled ffmpeg which encoders it was built with. */
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

/**
 * Run ffmpeg and report progress (0..1).
 * Returns { promise, cancel }.
 */
function runFfmpeg(args, { onProgress } = {}) {
    let child;
    let cancelled = false;

    const promise = new Promise((resolve, reject) => {
        const fullArgs = ['-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats', ...args];

        child = spawn(getBinPath('ffmpeg'), fullArgs, { windowsHide: true });

        let duration = null;
        let stderrTail = '';
        let stdoutBuffer = '';

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderrTail = (stderrTail + text).slice(-4000);

            if (duration === null) {
                const durMatch = stderrTail.match(/Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/);
                if (durMatch) duration = parseTimestamp(durMatch[1]);
            }
        });

        child.stdout.on('data', (chunk) => {
            stdoutBuffer += chunk.toString();
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop();

            for (const line of lines) {
                const [key, value] = line.split('=');
                if ((key === 'out_time_us' || key === 'out_time_ms') && duration) {
                    const seconds = Number(value) / 1e6;
                    if (Number.isFinite(seconds) && seconds >= 0) {
                        onProgress?.(Math.min(seconds / duration, 0.999));
                    }
                } else if (key === 'progress' && value === 'end') {
                    onProgress?.(1);
                }
            }
        });

        child.on('error', (error) => {
            reject(new Error(`Could not start ffmpeg: ${error.message}`));
        });

        child.on('close', (code) => {
            if (cancelled) {
                const err = new Error('Cancelled');
                err.cancelled = true;
                return reject(err);
            }
            if (code === 0) return resolve();

            const err = new Error(summariseFfmpegError(stderrTail) || `ffmpeg exited with code ${code}`);
            err.stderr = stderrTail;
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

/** Pull the most useful line out of ffmpeg's stderr. */
function summariseFfmpegError(stderr) {
    const lines = stderr
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !/^(frame=|size=|Press \[q\]|\[out#|Conversion failed!)/.test(l));

    const important = lines.filter((l) =>
        /error|invalid|not supported|unsupported|could not|unknown|no such|incompatible|cannot|failed|matches no streams|requires/i.test(l)
    );

    return (important.slice(-2).join(' — ') || lines.slice(-1)[0] || '').slice(0, 400);
}

module.exports = { getAvailableEncoders, runFfmpeg };
