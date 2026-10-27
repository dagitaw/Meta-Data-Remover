/*
 * File list. Each row is built once and then patched in place, so progress
 * ticks and settings changes never rebuild the list or reload thumbnails.
 */
import { state, removeItem, requeue } from './state.js';
import { $, el, icon, iconButton, formatBytes, formatDuration, plural, fileNameOf, toFileUrl } from './utils.js';

const api = window.electronAPI;
const list = $('queueList');
const summary = $('queueSummary');

/** id -> { li, target, bar, progress, status, actions, renderedStatus } */
const rows = new Map();

let onChange = () => {};

/** Called whenever the user edits the list from a row (remove / retry). */
export function onQueueChanged(callback) {
    onChange = callback;
}

/* ---------------- Thumbnails (lazy) ---------------- */

const THUMB_W = 192;
const THUMB_H = 108;

// Only load thumbnails for rows that scroll into view.
const thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbObserver.unobserve(entry.target);
        loadThumbnail(entry.target);
    }
}, { root: list, rootMargin: '200px' });

function loadThumbnail(thumb) {
    const item = state.items.find((i) => i.id === Number(thumb.dataset.id));
    if (!item) return;
    const url = toFileUrl(item.path);

    if (item.type === 'image') {
        const img = new Image();
        img.decoding = 'async';
        img.alt = '';
        img.onload = () => thumb.appendChild(img);
        img.src = url; // HEIC etc. just fail to load and keep the icon
    } else if (item.type === 'video') {
        captureVideoFrame(thumb, url);
    }
}

/**
 * Grab one frame into a small JPEG and free the video decoder straight away,
 * instead of keeping a live <video> element per row.
 */
function captureVideoFrame(thumb, url) {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';

    const release = () => {
        video.removeAttribute('src');
        video.load();
    };

    video.onloadedmetadata = () => {
        thumb.appendChild(el('span', 'duration', formatDuration(video.duration)));
        video.currentTime = Math.min(1, (video.duration || 0) / 3);
    };

    video.onseeked = () => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = THUMB_W;
            canvas.height = THUMB_H;
            const ctx = canvas.getContext('2d');
            // "cover" crop, like object-fit: cover
            const scale = Math.max(THUMB_W / video.videoWidth, THUMB_H / video.videoHeight);
            const w = video.videoWidth * scale;
            const h = video.videoHeight * scale;
            ctx.drawImage(video, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h);

            const img = new Image();
            img.alt = '';
            img.src = canvas.toDataURL('image/jpeg', 0.75);
            thumb.insertBefore(img, thumb.querySelector('.duration'));
            release();
        } catch {
            // Canvas blocked for this file — fall back to showing the paused video.
            thumb.insertBefore(video, thumb.querySelector('.duration'));
        }
    };

    video.onerror = release; // codec Chromium can't play (e.g. some MKV/AVI) — keep the icon
    video.src = url;
}

/* ---------------- Row text ---------------- */

function describeTarget(item) {
    const { settings, catalog } = state;
    if (settings.mode === 'clean') return 'Remove metadata';
    if (!catalog) return '';

    const shortLabel = (label) => label.split(/[ (]/)[0];

    if (item.type === 'image') {
        const f = catalog.imageFormats.find((x) => x.id === settings.image.format);
        return f ? `→ ${shortLabel(f.label)}` : '';
    }
    if (item.type === 'audio') {
        const f = catalog.audioFormats.find((x) => x.id === settings.audio.format);
        return f ? `→ ${f.label}` : '';
    }

    const f = catalog.videoFormats.find((x) => x.id === settings.video.format);
    if (!f) return '';
    if (f.kind !== 'video') return `→ ${f.label}`;
    const codec = catalog.videoCodecs[settings.video.codec];
    return `→ ${shortLabel(f.label)} · ${codec ? codec.label : ''}`;
}

function statusText(item) {
    switch (item.status) {
        case 'processing': return item.progress > 0 ? `Processing… ${Math.round(item.progress * 100)}%` : 'Processing…';
        case 'done': return `Saved as ${item.outputPath ? fileNameOf(item.outputPath) : ''}`;
        case 'error': return item.error || 'Failed';
        case 'cancelled': return 'Cancelled';
        default: return 'Waiting';
    }
}

/* ---------------- Rows ---------------- */

function createRow(item) {
    const li = el('li', 'item');
    li.dataset.id = item.id;

    const thumb = el('div', 'thumb');
    thumb.dataset.id = item.id;
    thumb.appendChild(icon(item.type, 22));
    thumbObserver.observe(thumb);

    const main = el('div', 'item-main');
    const name = el('div', 'item-name', item.name);
    name.title = item.path;

    const meta = el('div', 'item-meta');
    const target = el('span', 'target');
    meta.append(el('span', `badge badge-${item.type}`, item.type), el('span', null, formatBytes(item.size)), target);

    const progress = el('div', 'progress');
    const bar = el('div', 'bar');
    progress.appendChild(bar);

    const status = el('div', 'item-status');
    main.append(name, meta, progress, status);

    const actions = el('div', 'item-actions');
    li.append(thumb, main, actions);

    const row = { li, target, bar, progress, status, actions, renderedStatus: null };
    rows.set(item.id, row);
    return row;
}

function renderActions(row, item) {
    const buttons = [];

    if (item.status === 'done' && item.outputPath) {
        buttons.push(iconButton('folder', 'Show in folder', () => api.showInFolder(item.outputPath)));
    }
    if ((item.status === 'error' || item.status === 'cancelled') && !state.processing) {
        buttons.push(iconButton('retry', 'Try again', () => { requeue(item); onChange(); }));
    }
    if (item.status !== 'processing') {
        buttons.push(iconButton('close', 'Remove from list', () => { removeItem(item.id); onChange(); }));
    }
    row.actions.replaceChildren(...buttons);
}

/** Patch one row in place — cheap enough to call on every progress tick. */
export function updateRow(item) {
    const row = rows.get(item.id);
    if (!row) return;

    const percent = item.status === 'done' ? 100 : Math.round(item.progress * 100);
    row.bar.style.width = `${percent}%`;
    row.progress.classList.toggle('indeterminate', item.status === 'processing' && item.progress === 0);
    row.status.textContent = statusText(item);

    // Status changes are rare; only then touch the class and buttons.
    const statusKey = `${item.status}|${state.processing}`;
    if (row.renderedStatus !== statusKey) {
        row.li.className = `item is-${item.status}`;
        renderActions(row, item);
        row.renderedStatus = statusKey;
    }
}

/** Update every row's "→ MP4 · H.264" label after a settings change. */
export function refreshTargets() {
    for (const item of state.items) {
        const row = rows.get(item.id);
        if (row) row.target.textContent = describeTarget(item);
    }
}

/** Reconcile the DOM with state.items: add new rows, drop removed ones, keep order. */
export function syncQueue() {
    const liveIds = new Set(state.items.map((i) => i.id));
    for (const [id, row] of rows) {
        if (!liveIds.has(id)) {
            thumbObserver.unobserve(row.li.querySelector('.thumb'));
            row.li.remove();
            rows.delete(id);
        }
    }

    let previous = null;
    for (const item of state.items) {
        const row = rows.get(item.id) || createRow(item);
        const expectedPosition = previous ? previous.nextSibling : list.firstChild;
        if (row.li !== expectedPosition) list.insertBefore(row.li, expectedPosition);
        previous = row.li;

        row.target.textContent = describeTarget(item);
        updateRow(item);
    }

    const total = state.items.reduce((sum, i) => sum + (i.size || 0), 0);
    summary.textContent = `${plural(state.items.length, 'file')} · ${formatBytes(total)}`;
}

/** Re-render buttons on every row (e.g. Retry is hidden while processing). */
export function refreshAllRows() {
    for (const item of state.items) updateRow(item);
}
