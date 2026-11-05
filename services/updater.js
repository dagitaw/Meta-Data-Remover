/*
 * Update checker: looks at the latest GitHub release, and if it is newer than
 * this app, downloads its "Setup x.y.z.exe" and runs it.
 *
 * Publishing an update = create a GitHub release with a tag like "v2.1.0"
 * and attach "Metadata Remover Setup 2.1.0.exe". Nothing else is needed.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { downloadFile, httpFetch } = require('./download');

let electron = {};
try {
    electron = require('electron');
} catch {
    // Running outside Electron (tests) — fall back to Node's fetch below.
}

const REPO = 'dagitaw/Meta-Data-Remover';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const CHECK_TIMEOUT_MS = 15000;

const UPDATE_DIR = path.join(os.tmpdir(), 'meta-data-remover-update');

const currentVersion = () => (electron.app?.getVersion ? electron.app.getVersion() : require('../package.json').version);

/* ------------------------------------------------------------------ */
/* Version helpers                                                     */
/* ------------------------------------------------------------------ */

/** "v2.10.1" -> [2, 10, 1]; returns null for anything that isn't x.y.z */
function parseVersion(text) {
    const match = String(text || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
    return match ? match.slice(1).map(Number) : null;
}

/** > 0 if a is newer than b, < 0 if older, 0 if equal. */
function compareVersions(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return 0;
    for (let i = 0; i < 3; i += 1) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
}

/** Pick the Windows installer from a release's assets. */
function pickInstaller(assets = []) {
    const exes = assets.filter((a) => /\.exe$/i.test(a.name) && !/uninstall/i.test(a.name));
    return exes.find((a) => /setup/i.test(a.name)) || exes[0] || null;
}

function isTrustedDownloadUrl(url) {
    try {
        const { protocol, hostname } = new URL(url);
        return protocol === 'https:' && hostname === 'github.com';
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------ */
/* Check                                                               */
/* ------------------------------------------------------------------ */

/**
 * @returns {Promise<{
 *   updateAvailable: boolean, currentVersion: string, latestVersion?: string,
 *   notes?: string, releaseUrl: string, publishedAt?: string,
 *   installer?: { name: string, size: number, url: string } | null,
 *   canInstall: boolean
 * }>}
 */
async function checkForUpdates() {
    const current = currentVersion();
    const base = {
        updateAvailable: false,
        currentVersion: current,
        releaseUrl: RELEASES_PAGE,
        // Installing only makes sense for the installed Windows app, not `npm start`.
        canInstall: Boolean(electron.app?.isPackaged) && process.platform === 'win32'
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    let response;
    try {
        response = await httpFetch(LATEST_RELEASE_API, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': `Meta-Data-Remover/${current}`
            },
            signal: controller.signal
        });
    } catch (error) {
        throw new Error(controller.signal.aborted
            ? 'GitHub did not respond. Check your internet connection.'
            : `Could not reach GitHub: ${error.message}`);
    } finally {
        clearTimeout(timer);
    }

    if (response.status === 404) return base; // no releases published yet
    if (response.status === 403 || response.status === 429) {
        throw new Error('GitHub is limiting update checks right now. Try again in a while.');
    }
    if (!response.ok) throw new Error(`GitHub returned an error (${response.status}).`);

    const release = await response.json();
    const latest = release.tag_name || release.name || '';
    const installer = pickInstaller(release.assets);

    return {
        ...base,
        updateAvailable: compareVersions(latest, current) > 0,
        latestVersion: (parseVersion(latest) || []).join('.') || latest,
        notes: release.body || '',
        releaseUrl: release.html_url || RELEASES_PAGE,
        publishedAt: release.published_at,
        installer: installer && isTrustedDownloadUrl(installer.browser_download_url)
            ? { name: installer.name, size: installer.size, url: installer.browser_download_url }
            : null
    };
}

/* ------------------------------------------------------------------ */
/* Download + install                                                  */
/* ------------------------------------------------------------------ */

let activeDownload = null;

/**
 * Download the installer to the temp folder.
 * @param {{name: string, size: number, url: string}} installer
 * @param {(progress: number) => void} onProgress 0..1
 * @returns {Promise<string>} path of the downloaded file
 */
async function downloadUpdate(installer, onProgress = () => {}) {
    if (!installer || !isTrustedDownloadUrl(installer.url)) {
        throw new Error('This release has no installer to download.');
    }

    const safeName = path.basename(installer.name).replace(/[<>:"/\\|?*]/g, '_');
    const target = path.join(UPDATE_DIR, safeName);

    activeDownload = new AbortController();
    try {
        return await downloadFile(installer.url, target, {
            expectedSize: installer.size,
            signal: activeDownload.signal,
            onProgress
        });
    } finally {
        activeDownload = null;
    }
}

function cancelDownload() {
    activeDownload?.abort();
}

/** Start the downloaded installer and close the app so it can replace the files. */
function installUpdate(installerPath) {
    const resolved = path.resolve(installerPath || '');
    if (!resolved.startsWith(UPDATE_DIR + path.sep) || !fs.existsSync(resolved)) {
        throw new Error('Installer not found. Please download the update again.');
    }

    spawn(resolved, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    setTimeout(() => electron.app?.quit(), 300);
}

module.exports = {
    RELEASES_PAGE,
    checkForUpdates,
    downloadUpdate,
    cancelDownload,
    installUpdate,
    // exported for tests
    compareVersions,
    pickInstaller,
    isTrustedDownloadUrl
};
