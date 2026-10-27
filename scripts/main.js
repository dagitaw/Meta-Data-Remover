/*
 * Renderer entry point — wires the modules together.
 *
 *   state.js         settings + file queue
 *   dropzone.js      drag & drop / file picker
 *   queue-view.js    file list rows, thumbnails, progress
 *   settings-view.js side panel, mode switch, footer buttons
 *   processor.js     runs jobs (parallel where it helps)
 *   dialog.js        result dialog
 */
import { state, addFiles, clearItems } from './state.js';
import { $, toast, plural } from './utils.js';
import { initDropzone, browseForFiles } from './dropzone.js';
import { syncQueue, updateRow, refreshTargets, refreshAllRows, onQueueChanged } from './queue-view.js';
import { initSettingsView, applyCatalog, renderSettings, getOutputFileName } from './settings-view.js';
import { processQueue, cancelQueue, listenForProgress } from './processor.js';
import { showAlert } from './dialog.js';

const api = window.electronAPI;

const ui = {
    emptyState: $('emptyState'),
    workspace: $('workspace'),
    addFilesButton: $('addFilesButton')
};

/* ---------------- Rendering ---------------- */

function renderLayout() {
    const hasItems = state.items.length > 0;
    ui.emptyState.classList.toggle('hidden', hasItems);
    ui.workspace.classList.toggle('hidden', !hasItems);
    ui.addFilesButton.classList.toggle('hidden', !hasItems);
}

/** The list itself changed (files added/removed/retried). */
function onQueueEdited() {
    renderLayout();
    syncQueue();
    renderSettings();
}

/* ---------------- Adding files ---------------- */

function handleNewFiles(files, source) {
    if (source === 'drop' && files.length === 0) {
        toast('No supported files found');
        return;
    }

    const { added, unsupported, duplicate } = addFiles(files);
    const notes = [];
    if (unsupported) notes.push(`${plural(unsupported, 'unsupported file')} skipped`);
    if (duplicate) notes.push(`${duplicate} already in the list`);

    if (notes.length) toast(notes.join(' · '));
    else if (added > 1) toast(`Added ${added} files`);

    if (added) onQueueEdited();
}

const browse = () => browseForFiles(handleNewFiles);

/* ---------------- Processing ---------------- */

function showSummary({ done, failed, cancelled }) {
    if (!done.length && !failed.length) return;

    const verb = state.settings.mode === 'clean' ? 'cleaned' : 'converted';
    let type = 'success';
    let title = `${plural(done.length, 'file')} ${verb}`;
    let message = state.settings.outputFolder
        ? `Saved to ${state.settings.outputFolder}`
        : 'Saved next to the original files.';

    if (failed.length) {
        type = done.length ? 'warning' : 'error';
        title = done.length ? `${done.length} done, ${failed.length} failed` : 'Something went wrong';
        message = failed.length === 1
            ? `${failed[0].name}: ${failed[0].error}`
            : `${failed.length} files failed. See the red rows for details.`;
    } else if (cancelled) {
        title = `Stopped — ${title}`;
    }

    showAlert(title, message, type, done[0]?.outputPath);
}

async function start() {
    const result = await processQueue({
        onItemUpdate: updateRow,
        onStateChange: () => {
            renderSettings();
            refreshAllRows(); // show/hide Retry buttons
        },
        getOutputFileName
    });
    if (result) showSummary(result);
}

/* ---------------- Wiring ---------------- */

initDropzone(handleNewFiles);
onQueueChanged(onQueueEdited);
listenForProgress(updateRow);

initSettingsView(({ affectsQueue }) => {
    renderSettings();
    if (affectsQueue) {
        refreshTargets();
        refreshAllRows(); // mode switch re-queues items
    }
});

$('selectFilesButton').addEventListener('click', browse);
$('heroDropTarget').addEventListener('click', browse);
$('heroDropTarget').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); }
});
ui.addFilesButton.addEventListener('click', browse);
$('dropMoreButton').addEventListener('click', browse);
$('clearButton').addEventListener('click', () => { clearItems(); onQueueEdited(); });
$('startButton').addEventListener('click', start);
$('cancelButton').addEventListener('click', cancelQueue);

/* ---------------- Init ---------------- */

renderLayout();
renderSettings();

try {
    state.catalog = await api.getCatalog();
    applyCatalog(state.catalog);
    if (!state.catalog.ffmpegPath) toast(state.catalog.ffmpegError || 'ffmpeg not found in the bin folder');
    renderSettings();
    refreshTargets();
} catch (error) {
    console.error(error);
    toast('Could not load conversion options — is ffmpeg in the bin folder?');
}
