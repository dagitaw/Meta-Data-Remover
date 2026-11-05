/*
 * Background-removal model picker: the Model button, its popover list, the
 * first-run "download a model" callout and the download progress card.
 * Download state lives in the main process and is pushed here on every change.
 */
import { state, saveSettings, selectedModel } from './state.js';
import { $, el, icon, toast } from './utils.js';

const api = window.electronAPI;

const ui = {
    button: $('modelButton'),
    buttonLabel: $('modelButtonLabel'),
    callout: $('modelCallout'),
    calloutDownload: $('modelCalloutDownload'),
    calloutMore: $('modelCalloutMore'),
    downloads: $('modelDownloads'),
    downloadsList: $('modelDownloadsList'),
    downloadsCount: $('modelDownloadsCount'),
    downloadsCancel: $('modelDownloadsCancel'),
    menu: $('modelMenu'),
    menuList: $('modelMenuList'),
    menuSummary: $('modelMenuSummary'),
    downloadAll: $('modelDownloadAll')
};

const TAGS = { recommended: 'Recommended', people: 'People only', 'non-commercial': 'Non-commercial' };
const RECOMMENDED = 'isnet';

let notifyChange = () => {};
let sessionIds = new Set(); // models in the current download batch (shown in the progress card)
const reportedErrors = new Set();

const percent = (m) => `${Math.round((m.progress || 0) * 100)}%`;
// Decimal MB, matching how model sizes are usually quoted (179 MB, not 170 MiB).
const mb = (bytes) => `${bytes > 0 && bytes < 10e6 ? (bytes / 1e6).toFixed(1) : Math.round(bytes / 1e6)} MB`;
const sizeLabel = (m) => mb(m.size);

/* ---------------- State from the main process ---------------- */

function applyModels(list) {
    state.models = list;

    // Keep a usable selection: fall back to a downloaded model when the chosen one isn't available.
    const chosen = selectedModel();
    if (!chosen?.downloaded && !chosen?.state) {
        const fallback = list.find((m) => m.downloaded && m.id === RECOMMENDED) || list.find((m) => m.downloaded);
        if (fallback && fallback.id !== state.settings.bg.model) {
            state.settings.bg.model = fallback.id;
            saveSettings();
        }
    }

    for (const m of list) {
        if (m.state) sessionIds.add(m.id);
        if (m.error && !reportedErrors.has(m.id)) {
            reportedErrors.add(m.id);
            toast(`${m.label}: ${m.error}`);
        } else if (!m.error) {
            reportedErrors.delete(m.id);
        }
    }
    if (!list.some((m) => m.state)) sessionIds = new Set();

    render();
    notifyChange({ affectsQueue: true }); // row labels show the model name
}

/* ---------------- Rendering ---------------- */

function renderButton() {
    const chosen = selectedModel();
    const anyDownloaded = state.models.some((m) => m.downloaded);

    ui.button.classList.toggle('is-empty', !chosen?.downloaded);
    if (chosen?.downloaded) {
        ui.buttonLabel.replaceChildren(chosen.label, ...(chosen.tag ? [el('span', 'muted', ` · ${TAGS[chosen.tag]}`)] : []));
    } else if (chosen?.state) {
        ui.buttonLabel.textContent = chosen.state === 'queued'
            ? `${chosen.label} · waiting to download`
            : `${chosen.label} · downloading ${percent(chosen)}`;
    } else {
        ui.buttonLabel.textContent = anyDownloaded ? 'Choose a model' : 'No model downloaded yet';
    }

    const busy = state.models.some((m) => m.state);
    ui.callout.classList.toggle('hidden', anyDownloaded || busy || state.models.length === 0);
    const recommended = state.models.find((m) => m.id === RECOMMENDED);
    if (recommended) ui.calloutDownload.textContent = `Download ${recommended.label} · ${sizeLabel(recommended)}`;
}

function renderDownloads() {
    const rows = state.models.filter((m) => sessionIds.has(m.id));
    ui.downloads.classList.toggle('hidden', rows.length === 0);
    if (!rows.length) return;

    const finished = rows.filter((m) => m.downloaded).length;
    ui.downloadsCount.textContent = `${finished} of ${rows.length} done`;

    ui.downloadsList.replaceChildren(...rows.map((m) => {
        const status = m.downloaded ? 'Ready'
            : m.state === 'downloading' ? `${percent(m)} · ${mb(m.size * m.progress)} of ${sizeLabel(m)}`
            : m.state === 'queued' ? `Queued · ${sizeLabel(m)}`
            : m.error ? 'Failed' : 'Cancelled';

        const row = el('div', `dl-row${m.downloaded ? ' is-done' : ''}${m.error ? ' is-error' : ''}`);
        const top = el('div', 'dl-row-top');
        top.append(el('span', null, m.label), el('span', null, status));
        const progress = el('div', 'progress');
        const bar = el('div', 'bar');
        bar.style.width = m.downloaded ? '100%' : percent(m);
        progress.appendChild(bar);
        row.append(top, progress);
        return row;
    }));
}

function modelRow(m) {
    const selected = m.id === state.settings.bg.model && m.downloaded;
    const row = el('div', `model-row${m.downloaded ? ' is-downloaded is-selectable' : ''}${selected ? ' is-selected' : ''}`);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));
    row.setAttribute('aria-disabled', String(!m.downloaded));
    if (m.downloaded) {
        row.tabIndex = 0;
        const choose = () => selectModel(m.id);
        row.addEventListener('click', (e) => { if (!e.target.closest('button')) choose(); });
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
        });
    }

    const info = el('div', 'model-info');
    const title = el('div', 'model-title');
    title.append(el('strong', null, m.label), el('span', 'size', sizeLabel(m)));
    if (m.tag) title.appendChild(el('span', `tag tag-${m.tag}`, TAGS[m.tag]));
    info.append(title, el('span', 'model-desc', m.description));
    if (m.error) info.appendChild(el('span', 'model-error', m.error));

    const actions = el('div', 'model-actions');
    if (m.downloaded) {
        const stateLabel = el('span', 'model-state');
        stateLabel.append(icon('check', 14), selected ? 'In use' : 'Downloaded');
        const remove = el('button', 'icon-btn');
        remove.type = 'button';
        remove.title = `Delete ${m.label}`;
        remove.setAttribute('aria-label', `Delete ${m.label}`);
        remove.appendChild(icon('trash', 16));
        remove.addEventListener('click', () => api.deleteModel(m.id));
        actions.append(stateLabel, remove);
    } else if (m.state) {
        actions.appendChild(el('span', 'model-state is-progress', m.state === 'queued' ? 'Queued' : percent(m)));
    } else {
        const download = el('button', 'btn btn-secondary btn-xs', m.error ? 'Retry' : 'Download');
        download.type = 'button';
        download.addEventListener('click', () => api.downloadModels([m.id]));
        actions.appendChild(download);
    }

    row.append(el('span', 'model-radio'), info, actions);
    return row;
}

function renderMenu() {
    if (ui.menu.classList.contains('hidden')) return;

    const downloaded = state.models.filter((m) => m.downloaded);
    const usedBytes = downloaded.reduce((sum, m) => sum + m.size, 0);
    ui.menuSummary.textContent = downloaded.length
        ? `${downloaded.length} of ${state.models.length} downloaded · ${mb(usedBytes)}`
        : 'None downloaded yet';
    ui.menuList.replaceChildren(...state.models.map(modelRow));

    const remaining = state.models.filter((m) => !m.downloaded && !m.state);
    const remainingBytes = remaining.reduce((sum, m) => sum + m.size, 0);
    ui.downloadAll.disabled = remaining.length === 0;
    ui.downloadAll.textContent = remaining.length === 0
        ? (state.models.some((m) => m.state) ? 'Downloading…' : 'All models downloaded')
        : remaining.length === state.models.length
            ? `Download all · ${mb(remainingBytes)}`
            : `Download the other ${remaining.length} · ${mb(remainingBytes)}`;
}

function render() {
    renderButton();
    renderDownloads();
    renderMenu();
}

/* ---------------- Menu open / close ---------------- */

function positionMenu() {
    const rect = ui.button.getBoundingClientRect();
    const width = Math.min(500, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    const spaceBelow = window.innerHeight - rect.bottom - 18;
    ui.menu.style.left = `${left}px`;
    ui.menu.style.top = `${rect.bottom + 6}px`;
    ui.menuList.style.maxHeight = `${Math.max(160, spaceBelow - 120)}px`;
}

export function openModelMenu() {
    if (state.processing) return;
    ui.menu.classList.remove('hidden');
    ui.button.setAttribute('aria-expanded', 'true');
    positionMenu();
    renderMenu();
    (ui.menuList.querySelector('.is-selected') || ui.menuList.querySelector('[tabindex="0"]') || ui.downloadAll).focus();
}

export function closeModelMenu() {
    if (ui.menu.classList.contains('hidden')) return;
    ui.menu.classList.add('hidden');
    ui.button.setAttribute('aria-expanded', 'false');
}

function selectModel(id) {
    state.settings.bg.model = id;
    saveSettings();
    closeModelMenu();
    render();
    notifyChange({ affectsQueue: true });
    ui.button.focus();
}

/* ---------------- Init ---------------- */

/** @param {(opts?: {affectsQueue: boolean}) => void} onChange */
export async function initBgModels(onChange) {
    notifyChange = onChange;

    ui.button.addEventListener('click', () => (ui.menu.classList.contains('hidden') ? openModelMenu() : closeModelMenu()));
    ui.calloutMore.addEventListener('click', openModelMenu);
    ui.calloutDownload.addEventListener('click', () => api.downloadModels([RECOMMENDED]));
    ui.downloadsCancel.addEventListener('click', () => api.cancelModelDownloads());
    ui.downloadAll.addEventListener('click', () => {
        api.downloadModels(state.models.filter((m) => !m.downloaded && !m.state).map((m) => m.id));
    });

    document.addEventListener('mousedown', (e) => {
        if (!ui.menu.contains(e.target) && !ui.button.contains(e.target)) closeModelMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !ui.menu.classList.contains('hidden')) {
            closeModelMenu();
            ui.button.focus();
        }
    });
    window.addEventListener('resize', () => { if (!ui.menu.classList.contains('hidden')) positionMenu(); });

    api.onModelsChanged(applyModels);
    applyModels(await api.listModels());
}

export function describeSelectedModel() {
    return selectedModel()?.label || '';
}
