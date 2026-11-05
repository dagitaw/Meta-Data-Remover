/* Before / after preview for background-removal results. */
import { $, fileNameOf, toFileUrl } from './utils.js';

const api = window.electronAPI;

const ui = {
    overlay: $('previewOverlay'),
    title: $('previewTitle'),
    info: $('previewInfo'),
    before: $('previewBefore'),
    afterLayer: $('previewAfterLayer'),
    after: $('previewAfter'),
    divider: $('previewDivider'),
    slider: $('previewSlider'),
    swatches: $('previewSwatches'),
    retry: $('previewRetry'),
    show: $('previewShow'),
    done: $('previewDone'),
    close: $('previewClose')
};

let current = null;
let onRetry = () => {};

function setSplit(value) {
    ui.afterLayer.style.clipPath = `inset(0 0 0 ${value}%)`;
    ui.divider.style.left = `${value}%`;
}

function setBackground(bg) {
    for (const s of ui.swatches.querySelectorAll('.swatch')) s.classList.toggle('active', s.dataset.bg === bg);
    ui.afterLayer.classList.toggle('checker', bg === 'checker');
    ui.afterLayer.style.background = bg === 'checker' ? '' : bg;
}

function close() {
    ui.overlay.classList.remove('show');
    current = null;
}

/** @param {object} item a finished queue item with outputPath (+ width/height/model/ms) */
export function openPreview(item) {
    if (!item?.outputPath) return;
    current = item;

    const stamp = Date.now(); // the same output name can be rewritten after "Try another model"
    ui.before.src = toFileUrl(item.path);
    ui.after.src = `${toFileUrl(item.outputPath)}?v=${stamp}`;
    ui.title.textContent = fileNameOf(item.outputPath);

    const details = [item.outputPath.toLowerCase().endsWith('.webp') ? 'WebP' : 'PNG'];
    if (item.width && item.height) details.push(`${item.width} × ${item.height}`);
    if (item.model) details.push(item.model);
    if (item.ms) details.push(`${(item.ms / 1000).toFixed(1)} s`);
    ui.info.textContent = details.join(' · ');

    ui.slider.value = 50;
    setSplit(50);
    ui.overlay.classList.add('show');
    ui.done.focus();
}

/** @param {(item: object) => void} retry called by "Try another model" */
export function initPreview(retry) {
    onRetry = retry;

    ui.slider.addEventListener('input', () => setSplit(Number(ui.slider.value)));
    ui.swatches.addEventListener('click', (e) => {
        const swatch = e.target.closest('.swatch');
        if (swatch) setBackground(swatch.dataset.bg);
    });

    ui.show.addEventListener('click', () => current && api.showInFolder(current.outputPath));
    ui.retry.addEventListener('click', () => {
        const item = current;
        close();
        if (item) onRetry(item);
    });
    ui.done.addEventListener('click', close);
    ui.close.addEventListener('click', close);
    ui.overlay.addEventListener('click', (e) => { if (e.target === ui.overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) close(); });
}
