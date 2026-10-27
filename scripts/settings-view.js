/* Right-hand settings panel, the top-bar mode switch and the footer buttons. */
import { state, saveSettings, requeue, queuedTypes } from './state.js';
import { $, plural } from './utils.js';

const api = window.electronAPI;

const ui = {
    modeSwitch: $('modeSwitch'),
    heroTitle: $('heroTitle'),
    heroSubtitle: $('heroSubtitle'),
    modeDescription: $('modeDescription'),
    settingsFieldset: $('settingsFieldset'),
    convertSettings: $('convertSettings'),

    videoGroup: $('videoGroup'),
    videoFormat: $('videoFormat'),
    videoCodec: $('videoCodec'),
    videoCodecField: $('videoCodecField'),
    videoCodecHint: $('videoCodecHint'),
    videoQuality: $('videoQuality'),
    videoPictureRow: $('videoPictureRow'),
    videoResolution: $('videoResolution'),
    videoFps: $('videoFps'),
    videoAudio: $('videoAudio'),
    videoAudioField: $('videoAudioField'),

    imageGroup: $('imageGroup'),
    imageFormat: $('imageFormat'),
    imageQuality: $('imageQuality'),
    imageQualityValue: $('imageQualityValue'),
    imageQualityField: $('imageQualityField'),
    imageQualityNote: $('imageQualityNote'),
    imageSize: $('imageSize'),

    audioGroup: $('audioGroup'),
    audioFormat: $('audioFormat'),
    audioQuality: $('audioQuality'),

    stripMetadata: $('stripMetadata'),

    outputFolderLabel: $('outputFolderLabel'),
    chooseOutputButton: $('chooseOutputButton'),
    resetOutputButton: $('resetOutputButton'),
    outputFileName: $('outputFileName'),
    fileNameHint: $('fileNameHint'),

    startButton: $('startButton'),
    cancelButton: $('cancelButton'),
    clearButton: $('clearButton'),
    engineInfo: $('engineInfo')
};

const MODE_TEXT = {
    clean: {
        heroTitle: 'Drag and drop files to remove metadata',
        heroSubtitle: 'Strips GPS, camera and date info from videos, images and audio. Nothing leaves this computer.',
        description: 'Strips EXIF, GPS location, camera info, dates and other tags. Quality and format stay exactly the same.',
        verb: 'Remove metadata',
        suffix: '_clean'
    },
    convert: {
        heroTitle: 'Drag and drop files to convert',
        heroSubtitle: 'Change format, codec, resolution or quality of videos, images and audio. Nothing leaves this computer.',
        description: 'Change format, codec, resolution or quality. Videos, images and audio each use their own settings below.',
        verb: 'Convert',
        suffix: '_converted'
    }
};

const CODEC_GROUPS = { software: 'Software', hardware: 'Graphics card (faster)', other: 'Other' };

let notifyChange = () => {};

/* ---------------- Helpers ---------------- */

function fillSelect(select, options) {
    select.replaceChildren(...options.map((o) => {
        const opt = new Option(o.label, o.id);
        opt.disabled = Boolean(o.disabled);
        return opt;
    }));
}

function setSegmented(container, value) {
    for (const b of container.querySelectorAll('button')) {
        b.classList.toggle('active', (b.dataset.value ?? b.dataset.mode) === value);
    }
}

const findFormat = (list, id) => list.find((f) => f.id === id) || list[0];

let codecListFormat = null; // format the codec <select> was last built for

/** Rebuild the codec list only when the container format changed. */
function fillVideoCodecs(format) {
    const { catalog, settings } = state;

    if (codecListFormat !== format.id) {
        const groups = Object.entries(CODEC_GROUPS).map(([groupId, label]) => {
            const codecs = format.codecs.map((id) => catalog.videoCodecs[id]).filter((c) => c?.group === groupId);
            if (!codecs.length) return null;
            const optgroup = document.createElement('optgroup');
            optgroup.label = label;
            for (const c of codecs) {
                const opt = new Option(c.available ? c.label : `${c.label} (not in your ffmpeg)`, c.id);
                opt.disabled = !c.available;
                optgroup.appendChild(opt);
            }
            return optgroup;
        }).filter(Boolean);

        ui.videoCodec.replaceChildren(...groups);
        codecListFormat = format.id;
    }

    // Keep the chosen codec valid for this format.
    const usable = format.codecs.filter((id) => catalog.videoCodecs[id]?.available);
    if (!usable.includes(settings.video.codec)) settings.video.codec = usable[0] || format.codecs[0];
    ui.videoCodec.value = settings.video.codec;
}

function imageQualityLabel() {
    const { format, quality } = state.settings.image;
    return format === 'webp' && Number(quality) >= 100 ? '100 · lossless' : String(quality);
}

function renderImageQuality() {
    ui.imageQualityValue.textContent = imageQualityLabel();
    ui.imageQuality.style.setProperty('--fill', `${state.settings.image.quality}%`);
}

/* ---------------- Render ---------------- */

function renderConvertSettings() {
    const { catalog, settings } = state;
    const types = queuedTypes();
    const visible = types.size ? types : new Set(['video', 'image']);

    ui.videoGroup.classList.toggle('hidden', !visible.has('video'));
    ui.imageGroup.classList.toggle('hidden', !visible.has('image'));
    ui.audioGroup.classList.toggle('hidden', !visible.has('audio'));

    // Video
    const vf = findFormat(catalog.videoFormats, settings.video.format);
    ui.videoFormat.value = vf.id;
    fillVideoCodecs(vf);
    ui.videoCodecHint.textContent = catalog.videoCodecs[settings.video.codec]?.hint || '';
    ui.videoCodecField.classList.toggle('hidden', vf.kind !== 'video');
    ui.videoPictureRow.classList.toggle('hidden', vf.kind === 'audio');
    ui.videoAudioField.classList.toggle('hidden', vf.kind !== 'video');

    const isCopy = vf.kind === 'video' && settings.video.codec === 'copy';
    ui.videoResolution.disabled = isCopy;
    ui.videoFps.disabled = isCopy;
    ui.videoQuality.classList.toggle('is-disabled', isCopy);
    setSegmented(ui.videoQuality, settings.video.quality);
    ui.videoResolution.value = settings.video.resolution;
    ui.videoFps.value = settings.video.fps;
    ui.videoAudio.value = settings.video.audio;

    // Image
    const imf = findFormat(catalog.imageFormats, settings.image.format);
    ui.imageFormat.value = imf.id;
    ui.imageQualityField.classList.toggle('hidden', !imf.lossy);
    ui.imageQualityNote.classList.toggle('hidden', imf.lossy);
    ui.imageQuality.value = settings.image.quality;
    renderImageQuality();
    ui.imageSize.value = settings.image.size;

    // Audio
    ui.audioFormat.value = settings.audio.format;
    setSegmented(ui.audioQuality, settings.audio.quality);

    ui.stripMetadata.checked = settings.stripMetadata;
}

export function renderSettings() {
    const { settings, items, processing, catalog } = state;
    const text = MODE_TEXT[settings.mode];

    // Mode
    setSegmented(ui.modeSwitch, settings.mode);
    for (const b of ui.modeSwitch.querySelectorAll('button')) b.disabled = processing;
    ui.heroTitle.textContent = text.heroTitle;
    ui.heroSubtitle.textContent = text.heroSubtitle;
    ui.modeDescription.textContent = text.description;
    ui.convertSettings.classList.toggle('hidden', settings.mode !== 'convert');
    if (catalog && settings.mode === 'convert') renderConvertSettings();

    // Output
    ui.outputFolderLabel.textContent = settings.outputFolder || 'Same folder as original';
    ui.outputFolderLabel.title = settings.outputFolder || '';
    ui.resetOutputButton.classList.toggle('hidden', !settings.outputFolder);

    const single = items.length <= 1;
    ui.outputFileName.disabled = !single;
    if (!single) ui.outputFileName.value = '';
    const baseName = items[0] ? items[0].name.replace(/\.[^.]+$/, '') : 'name';
    ui.fileNameHint.textContent = single
        ? `Leave empty to use "${baseName}${text.suffix}".`
        : `Multiple files: each keeps its name + "${text.suffix}".`;

    // Footer
    const count = items.filter((i) => i.status !== 'done').length || items.length;
    ui.startButton.textContent = count > 1 ? `${text.verb} · ${plural(count, 'file')}` : text.verb;
    ui.startButton.disabled = processing || items.length === 0;
    ui.startButton.classList.toggle('hidden', processing);
    ui.cancelButton.classList.toggle('hidden', !processing);
    ui.settingsFieldset.disabled = processing;
    ui.clearButton.disabled = processing;
}

export function getOutputFileName() {
    return state.items.length === 1 ? ui.outputFileName.value.trim() : '';
}

/* ---------------- Events ---------------- */

function changed({ affectsQueue = true } = {}) {
    saveSettings();
    notifyChange({ affectsQueue });
}

// <select> -> settings[group][key]
const SELECT_BINDINGS = [
    ['videoFormat', 'video', 'format'],
    ['videoCodec', 'video', 'codec'],
    ['videoResolution', 'video', 'resolution'],
    ['videoFps', 'video', 'fps'],
    ['videoAudio', 'video', 'audio'],
    ['imageFormat', 'image', 'format'],
    ['imageSize', 'image', 'size'],
    ['audioFormat', 'audio', 'format']
];

// segmented control -> settings[group][key]
const SEGMENTED_BINDINGS = [
    ['videoQuality', 'video', 'quality'],
    ['audioQuality', 'audio', 'quality']
];

function bindEvents() {
    ui.modeSwitch.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-mode]');
        if (!button || state.processing || button.dataset.mode === state.settings.mode) return;
        state.settings.mode = button.dataset.mode;
        // Errors from the other mode no longer apply.
        for (const item of state.items) if (item.status !== 'done') requeue(item);
        changed();
    });

    for (const [id, group, key] of SELECT_BINDINGS) {
        ui[id].addEventListener('change', () => {
            state.settings[group][key] = ui[id].value;
            changed();
        });
    }

    for (const [id, group, key] of SEGMENTED_BINDINGS) {
        ui[id].addEventListener('click', (e) => {
            const button = e.target.closest('button[data-value]');
            if (!button) return;
            state.settings[group][key] = button.dataset.value;
            changed();
        });
    }

    ui.imageQuality.addEventListener('input', () => {
        state.settings.image.quality = Number(ui.imageQuality.value);
        renderImageQuality(); // live label only; full save happens on "change"
    });
    ui.imageQuality.addEventListener('change', () => changed({ affectsQueue: false }));

    ui.stripMetadata.addEventListener('change', () => {
        state.settings.stripMetadata = ui.stripMetadata.checked;
        saveSettings();
    });

    ui.chooseOutputButton.addEventListener('click', async () => {
        const folder = await api.selectOutputFolder();
        if (!folder) return;
        state.settings.outputFolder = folder;
        changed({ affectsQueue: false });
    });

    ui.resetOutputButton.addEventListener('click', () => {
        state.settings.outputFolder = null;
        changed({ affectsQueue: false });
    });
}

/* ---------------- Init ---------------- */

/** @param {(opts: {affectsQueue: boolean}) => void} onChange */
export function initSettingsView(onChange) {
    notifyChange = onChange;
    bindEvents();
}

/** Fill the dropdowns once the catalog has arrived from the main process. */
export function applyCatalog(catalog) {
    fillSelect(ui.videoFormat, catalog.videoFormats);
    fillSelect(ui.videoResolution, catalog.videoResolutions);
    fillSelect(ui.videoFps, catalog.videoFps);
    fillSelect(ui.imageFormat, catalog.imageFormats.map((f) => ({
        ...f,
        label: f.available ? f.label : `${f.label} (not in your ffmpeg)`,
        disabled: !f.available
    })));
    fillSelect(ui.imageSize, catalog.imageSizes);
    fillSelect(ui.audioFormat, catalog.audioFormats);

    if (catalog.ffmpegPath) {
        ui.engineInfo.textContent = `ffmpeg: ${catalog.ffmpegPath}`;
        ui.engineInfo.title = catalog.ffmpegPath;
    } else {
        ui.engineInfo.textContent = catalog.ffmpegError || 'ffmpeg not found in the bin folder';
        ui.engineInfo.classList.add('engine-error');
    }
}
