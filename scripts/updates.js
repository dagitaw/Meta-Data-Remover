/*
 * "Check for updates": silent check on startup (asks only if there is a new
 * version the user hasn't skipped), plus a manual check from the top bar.
 */
import { state } from './state.js';
import { $, el, formatBytes } from './utils.js';

const api = window.electronAPI;

const STARTUP_DELAY_MS = 4000;
const SKIP_KEY = 'mdr-skipped-version';

const ui = {
    button: $('checkUpdatesButton'),
    version: $('appVersion'),
    overlay: $('updateOverlay'),
    icon: $('updateIcon'),
    title: $('updateTitle'),
    subtitle: $('updateSubtitle'),
    notes: $('updateNotes'),
    progress: $('updateProgress'),
    progressBar: $('updateProgressBar'),
    progressText: $('updateProgressText'),
    skip: $('updateSkipButton'),
    secondary: $('updateSecondaryButton'),
    primary: $('updatePrimaryButton')
};

let update = null;    // last successful check result
let busy = false;     // a check or download is running

/* ---------------- Small helpers ---------------- */

function getSkippedVersion() {
    try { return localStorage.getItem(SKIP_KEY); } catch { return null; }
}

function setSkippedVersion(version) {
    try { localStorage.setItem(SKIP_KEY, version); } catch { /* storage unavailable */ }
}

/**
 * Very small Markdown -> DOM for release notes (headings, bullets, paragraphs).
 * Built with textContent only, so nothing in the notes can run as HTML.
 */
function renderNotes(markdown) {
    const clean = (text) => text.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    const nodes = [];
    let list = null;

    for (const raw of markdown.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || /^(-{3,}|\|?\s*:?-{3,})/.test(line)) { list = null; continue; }

        const heading = line.match(/^#{1,6}\s+(.*)/);
        const bullet = line.match(/^[-*+]\s+(.*)/);
        const tableRow = line.startsWith('|');

        if (heading) {
            list = null;
            nodes.push(el('h4', null, clean(heading[1])));
        } else if (bullet || tableRow) {
            const text = tableRow
                ? line.split('|').map((c) => clean(c)).filter(Boolean).join(' — ')
                : clean(bullet[1]);
            if (!list) { list = el('ul'); nodes.push(list); }
            list.appendChild(el('li', null, text));
        } else {
            list = null;
            nodes.push(el('p', null, clean(line)));
        }
    }
    ui.notes.replaceChildren(...nodes);
    ui.notes.classList.toggle('hidden', nodes.length === 0);
}

/**
 * Configure the dialog. Each button is { label, onClick } or null (hidden).
 */
function showDialog({ icon = '', title, subtitle = '', notes = null, progress = false, skip = null, secondary = null, primary = null }) {
    ui.icon.className = `alert-icon update-icon ${icon}`;
    ui.title.textContent = title;
    ui.subtitle.textContent = subtitle;

    if (notes) renderNotes(notes);
    else ui.notes.classList.add('hidden');

    ui.progress.classList.toggle('hidden', !progress);

    for (const [button, config] of [[ui.skip, skip], [ui.secondary, secondary], [ui.primary, primary]]) {
        button.classList.toggle('hidden', !config);
        if (config) {
            button.textContent = config.label;
            button.onclick = config.onClick;
            button.disabled = false;
        }
    }

    ui.overlay.classList.add('show');
    (primary ? ui.primary : secondary ? ui.secondary : ui.skip).focus();
}

function closeDialog() {
    if (busy) return; // keep it open while downloading
    ui.overlay.classList.remove('show');
}

function setProgress(fraction, text) {
    ui.progressBar.style.width = `${Math.round(fraction * 100)}%`;
    ui.progressText.textContent = text;
}

/* ---------------- States ---------------- */

function showAvailable() {
    const size = update.installer?.size ? ` · ${formatBytes(update.installer.size)}` : '';
    const later = { label: 'Later', onClick: closeDialog };
    const skip = {
        label: 'Skip this version',
        onClick: () => { setSkippedVersion(update.latestVersion); markButton(false); closeDialog(); }
    };

    // Running from source (npm start) or the release has no installer: send to GitHub instead.
    if (!update.canInstall || !update.installer) {
        showDialog({
            title: `Version ${update.latestVersion} is available`,
            subtitle: update.installer
                ? `You have ${update.currentVersion}. Updating is only automatic in the installed app.`
                : `You have ${update.currentVersion}. Download it from the release page.`,
            notes: update.notes,
            skip,
            secondary: later,
            primary: { label: 'Open release page', onClick: () => { api.openReleasePage(); closeDialog(); } }
        });
        return;
    }

    showDialog({
        title: `Version ${update.latestVersion} is available`,
        subtitle: `You have ${update.currentVersion}${size}` +
            (state.processing ? ' — files being processed now will be stopped.' : ''),
        notes: update.notes,
        skip,
        secondary: later,
        primary: { label: 'Update now', onClick: startDownload }
    });
}

async function startDownload() {
    busy = true;
    setProgress(0, 'Starting download…');
    showDialog({
        title: `Downloading ${update.latestVersion}`,
        subtitle: 'The app will close and the installer will start when the download finishes.',
        progress: true,
        secondary: { label: 'Cancel', onClick: () => api.cancelUpdateDownload() }
    });

    const total = update.installer.size;
    const stopListening = api.onUpdateProgress((p) => {
        setProgress(p, total
            ? `Downloading… ${Math.round(p * 100)}% of ${formatBytes(total)}`
            : `Downloading… ${Math.round(p * 100)}%`);
    });

    const result = await api.downloadUpdate();
    stopListening();
    busy = false;

    if (result.cancelled) {
        closeDialog();
        return;
    }
    if (!result.ok) {
        showError(result.error);
        return;
    }

    setProgress(1, 'Download complete');
    showDialog({
        icon: 'success',
        title: 'Installing update…',
        subtitle: 'The app will close now. It reopens automatically when the installer finishes.',
        progress: true
    });

    const install = await api.installUpdate();
    if (!install.ok) showError(install.error);
}

function showError(message) {
    showDialog({
        icon: 'error',
        title: 'Update failed',
        subtitle: message || 'Something went wrong.',
        secondary: { label: 'Close', onClick: closeDialog },
        primary: { label: 'Open release page', onClick: () => { api.openReleasePage(); closeDialog(); } }
    });
}

function markButton(hasUpdate) {
    ui.button.classList.toggle('has-update', hasUpdate);
    ui.button.title = hasUpdate ? `Version ${update.latestVersion} is available — click to update` : 'Check for updates';
}

/* ---------------- Checking ---------------- */

/**
 * @param {{silent: boolean}} options silent = startup check: only speak up
 *        when there is a new, non-skipped version.
 */
async function check({ silent }) {
    if (busy) return;
    busy = true;
    ui.button.classList.add('is-checking');
    ui.button.disabled = true;

    const result = await api.checkForUpdates();

    busy = false;
    ui.button.classList.remove('is-checking');
    ui.button.disabled = false;

    if (!result.ok) {
        if (!silent) showError(result.error);
        return;
    }

    update = result;

    if (!result.updateAvailable) {
        markButton(false);
        if (!silent) {
            showDialog({
                icon: 'success',
                title: "You're up to date",
                subtitle: `Metadata Remover ${result.currentVersion} is the latest version.`,
                primary: { label: 'OK', onClick: closeDialog }
            });
        }
        return;
    }

    markButton(true);
    const skipped = getSkippedVersion() === result.latestVersion;
    // On startup, don't interrupt a skipped version or a running batch — the dot on the button stays.
    if (!silent || (!skipped && !state.processing)) showAvailable();
}

/* ---------------- Init ---------------- */

export async function initUpdates() {
    ui.button.addEventListener('click', () => (update?.updateAvailable ? showAvailable() : check({ silent: false })));
    ui.overlay.addEventListener('click', (e) => { if (e.target === ui.overlay) closeDialog(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); });

    try {
        ui.version.textContent = `v${await api.getAppVersion()}`;
    } catch { /* keep default label */ }

    setTimeout(() => check({ silent: true }), STARTUP_DELAY_MS);
}
