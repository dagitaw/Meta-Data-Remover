/*
 * Runs the queue. Light jobs (images, audio, lossless metadata removal) run in
 * parallel; video re-encodes and background removal run one at a time because
 * each one already uses every CPU core (or the GPU) by itself.
 */
import { state, requeue, isEligible } from './state.js';

const api = window.electronAPI;

const MAX_PARALLEL = Math.max(2, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

const running = new Map(); // jobId -> item
let cancelRequested = false;

const jobIdOf = (item) => `job-${item.id}`;
const isHeavy = (item, mode) => mode === 'background' || (mode === 'convert' && item.type === 'video');

/**
 * @param {object} hooks
 *   onItemUpdate(item)  — a row's status/progress changed
 *   onStateChange()     — processing started/finished
 *   getOutputFileName() — custom name (single-file runs only)
 * @returns {{done: object[], failed: object[], cancelled: boolean} | null}
 */
export async function processQueue(hooks) {
    if (state.processing || state.items.length === 0) return null;

    // Freeze settings for this run so edits mid-run don't mix outputs.
    const snapshot = structuredClone(state.settings);
    const eligible = state.items.filter((i) => isEligible(i, snapshot.mode));
    if (eligible.length === 0) return null;

    // Everything already done -> run the whole list again; otherwise retry failures.
    const allDone = eligible.every((i) => i.status === 'done');
    for (const item of eligible) {
        if (allDone || item.status === 'error' || item.status === 'cancelled') requeue(item);
    }
    const outputFileName = hooks.getOutputFileName();

    state.processing = true;
    cancelRequested = false;
    hooks.onStateChange();

    const runJob = async (item) => {
        item.status = 'processing';
        item.progress = 0;
        hooks.onItemUpdate(item);

        const result = await api.processFile(jobIdOf(item), {
            mode: snapshot.mode,
            inputPath: item.path,
            settings: {
                stripMetadata: snapshot.stripMetadata,
                video: snapshot.video,
                image: snapshot.image,
                audio: snapshot.audio,
                bg: snapshot.bg
            },
            outputFolder: snapshot.outputFolder,
            outputFileName
        });

        if (result.success) {
            const { outputPath, width, height, model, ms } = result;
            Object.assign(item, { status: 'done', progress: 1, outputPath, width, height, model, ms, resultMode: snapshot.mode });
        } else if (result.cancelled) {
            Object.assign(item, { status: 'cancelled', progress: 0 });
        } else {
            Object.assign(item, { status: 'error', error: result.error });
        }
        hooks.onItemUpdate(item);
    };

    await new Promise((resolve) => {
        const pump = () => {
            if (!cancelRequested) {
                let heavyBusy = [...running.values()].some((i) => isHeavy(i, snapshot.mode));

                while (running.size < MAX_PARALLEL) {
                    // Files added mid-run are picked up here too.
                    const next = state.items.find((i) =>
                        i.status === 'queued' && isEligible(i, snapshot.mode) && !running.has(jobIdOf(i))
                        && !(heavyBusy && isHeavy(i, snapshot.mode)));
                    if (!next) break;

                    heavyBusy ||= isHeavy(next, snapshot.mode);
                    running.set(jobIdOf(next), next);
                    runJob(next).finally(() => {
                        running.delete(jobIdOf(next));
                        pump();
                    });
                }
            }
            if (running.size === 0) resolve();
        };
        pump();
    });

    state.processing = false;
    hooks.onStateChange();

    return {
        done: state.items.filter((i) => i.status === 'done'),
        failed: state.items.filter((i) => i.status === 'error'),
        cancelled: cancelRequested
    };
}

export async function cancelQueue() {
    cancelRequested = true;
    await Promise.all([...running.keys()].map((jobId) => api.cancelJob(jobId)));
}

/** Route progress events from the main process to the matching item. */
export function listenForProgress(onItemUpdate) {
    api.onProgress(({ jobId, progress }) => {
        const item = running.get(jobId);
        if (!item || item.status !== 'processing') return;
        item.progress = progress;
        onItemUpdate(item);
    });
}
