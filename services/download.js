/*
 * Streaming file download shared by the app updater and the model manager:
 * progress, cancel, size + SHA-256 checks, and no half-written files left behind.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let net = null;
try {
    ({ net } = require('electron'));
} catch {
    // Outside Electron (tests) — Node's fetch is used.
}

/** Electron's net.fetch uses the system proxy and certificates. */
const httpFetch = (url, options) => (net?.fetch ? net.fetch(url, options) : fetch(url, options));

function cancelledError() {
    const error = new Error('Download cancelled');
    error.cancelled = true;
    return error;
}

/**
 * @param {string} url
 * @param {string} target final file path
 * @param {object} [options]
 * @param {number} [options.expectedSize] bytes; checked when given
 * @param {string} [options.sha256] hex digest; checked when given
 * @param {(fraction: number, received: number, total: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @param {Record<string,string>} [options.headers]
 * @returns {Promise<string>} target
 */
async function downloadFile(url, target, { expectedSize, sha256, onProgress = () => {}, signal, headers } = {}) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const partial = `${target}.download`;

    try {
        const response = await httpFetch(url, { signal, headers });
        if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);

        const total = expectedSize || Number(response.headers.get('content-length')) || 0;
        const hash = crypto.createHash('sha256');
        const file = fs.createWriteStream(partial);
        let received = 0;
        let lastReport = 0;

        try {
            for await (const chunk of response.body) {
                received += chunk.length;
                hash.update(chunk);
                if (!file.write(chunk)) await new Promise((resolve) => file.once('drain', resolve));

                const now = Date.now();
                if (total && now - lastReport > 150) {
                    lastReport = now;
                    onProgress(Math.min(received / total, 0.999), received, total);
                }
            }
        } finally {
            await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())));
        }

        if (total && received !== total) throw new Error('The download was incomplete. Please try again.');
        if (sha256 && hash.digest('hex') !== sha256.toLowerCase()) {
            throw new Error('The downloaded file is damaged (checksum mismatch). Please try again.');
        }

        await fs.promises.rm(target, { force: true });
        await fs.promises.rename(partial, target);
        onProgress(1, received, total || received);
        return target;
    } catch (error) {
        await fs.promises.rm(partial, { force: true }).catch(() => {});
        if (signal?.aborted) throw cancelledError();
        throw error;
    }
}

module.exports = { downloadFile, httpFetch };
