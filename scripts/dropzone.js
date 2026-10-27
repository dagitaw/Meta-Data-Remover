/* Getting files in: the full-window drag & drop overlay and the file picker. */
import { $ } from './utils.js';

const api = window.electronAPI;
const overlay = $('dropOverlay');

let dragDepth = 0; // dragenter/dragleave fire for every child element
const carriesFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

/** Turn dropped File objects into absolute paths and let the main process expand folders. */
async function pathsFromDrop(fileList) {
    const paths = [];
    for (const file of fileList) {
        try {
            const p = api.getPathForFile(file);
            if (p) paths.push(p);
        } catch { /* dragged text/links, not files */ }
    }
    return paths.length ? api.resolvePaths(paths) : [];
}

/**
 * @param {(files: object[], source: 'drop' | 'browse') => void} onFiles
 */
export function initDropzone(onFiles) {
    window.addEventListener('dragenter', (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        dragDepth += 1;
        overlay.classList.add('show');
    });

    window.addEventListener('dragover', (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('dragleave', (event) => {
        if (!carriesFiles(event)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) overlay.classList.remove('show');
    });

    window.addEventListener('drop', async (event) => {
        event.preventDefault(); // never let Electron navigate to the dropped file
        dragDepth = 0;
        overlay.classList.remove('show');
        if (event.dataTransfer?.files?.length) onFiles(await pathsFromDrop(event.dataTransfer.files), 'drop');
    });
}

export async function browseForFiles(onFiles) {
    const files = await api.selectFiles();
    if (files?.length) onFiles(files, 'browse');
}
