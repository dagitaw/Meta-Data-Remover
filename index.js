const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const removeMetaData = require('./services/removeMetaData');
const { convertMedia } = require('./services/convertMedia');
const { getAvailableEncoders } = require('./services/ffmpeg');
const { getCatalog } = require('./services/formats');
const updater = require('./services/updater');
const bgModels = require('./services/bgModels');
const { removeBackground } = require('./services/removeBackground');
const {
    ALL_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS,
    resolveMediaPaths, getMediaType, getBinPath
} = require('./services/fileUtils');

const runningJobs = new Map(); // jobId -> cancel()

const createWindow = () => {
    const win = new BrowserWindow({
        width: 1100,
        height: 740,
        minWidth: 780,
        minHeight: 560,
        backgroundColor: '#0f0f0f',
        icon: path.join(__dirname, 'assets/icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile(path.join(__dirname, 'index.html'));
    win.setMenuBarVisibility(false);

    // A file dropped outside the drop handlers must never navigate the app away.
    win.webContents.on('will-navigate', (event) => event.preventDefault());
};

app.whenReady().then(() => {
    try {
        console.log('Using ffmpeg:', getBinPath('ffmpeg'));
    } catch (error) {
        console.error(error.message);
    }
    getAvailableEncoders(); // warm the cache so the settings panel loads instantly
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    for (const cancel of runningJobs.values()) cancel();
    if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

const strip = (set) => [...set].map((e) => e.slice(1));

ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'All media', extensions: ALL_EXTENSIONS },
            { name: 'Videos', extensions: strip(VIDEO_EXTENSIONS) },
            { name: 'Images', extensions: strip(IMAGE_EXTENSIONS) },
            { name: 'Audio', extensions: strip(AUDIO_EXTENSIONS) }
        ]
    });

    if (result.canceled) return [];
    return resolveMediaPaths(result.filePaths);
});

ipcMain.handle('resolve-paths', async (_event, paths) => {
    if (!Array.isArray(paths)) return [];
    return resolveMediaPaths(paths.filter((p) => typeof p === 'string' && p));
});

ipcMain.handle('select-output-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    return result.filePaths[0];
});

ipcMain.handle('show-in-folder', (_event, filePath) => {
    if (typeof filePath === 'string') shell.showItemInFolder(filePath);
});

ipcMain.handle('open-folder', (_event, folderPath) => {
    if (typeof folderPath === 'string') shell.openPath(folderPath);
});

/* ------------------------------------------------------------------ */
/* Processing                                                          */
/* ------------------------------------------------------------------ */

ipcMain.handle('get-catalog', async () => {
    const catalog = getCatalog(await getAvailableEncoders());
    try {
        catalog.ffmpegPath = getBinPath('ffmpeg');
    } catch (error) {
        catalog.ffmpegError = error.message;
    }
    return catalog;
});

// One handler per mode.
const PROCESSORS = {
    clean: (job, hooks) => removeMetaData(job.inputPath, job.outputFolder, job.outputFileName, hooks),
    convert: (job, hooks) => convertMedia(job, hooks),
    background: (job, hooks) => {
        if (job.mediaType !== 'image') throw new Error('Background removal works on images only.');
        return removeBackground(job, hooks);
    }
};

/**
 * job = { mode: 'clean' | 'convert' | 'background', inputPath, settings, outputFolder, outputFileName }
 */
ipcMain.handle('process-file', async (event, jobId, job) => {
    const sender = event.sender;
    const hooks = {
        onProgress: (progress) => {
            if (!sender.isDestroyed()) sender.send('job-progress', { jobId, progress });
        },
        registerCancel: (cancel) => runningJobs.set(jobId, cancel)
    };

    try {
        const mediaType = getMediaType(job.inputPath);
        if (!mediaType) throw new Error('Unsupported file type.');

        const processor = PROCESSORS[job.mode];
        if (!processor) throw new Error('Unknown mode.');
        const { outputPath, width, height, model, ms } = await processor({ ...job, mediaType }, hooks);

        return { success: true, outputPath, width, height, model, ms };
    } catch (error) {
        if (error.cancelled) return { success: false, cancelled: true, error: 'Cancelled' };
        console.error('Processing failed:', error);
        return { success: false, error: error.message || String(error) };
    } finally {
        runningJobs.delete(jobId);
    }
});

ipcMain.handle('cancel-job', (_event, jobId) => {
    const cancel = runningJobs.get(jobId);
    if (cancel) cancel();
    return Boolean(cancel);
});

/* ------------------------------------------------------------------ */
/* Updates                                                             */
/* ------------------------------------------------------------------ */

// The renderer never passes URLs or paths: main remembers what it found/downloaded.
let latestUpdate = null;
let downloadedInstaller = null;

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('update-check', async () => {
    try {
        latestUpdate = await updater.checkForUpdates();
        return { ok: true, ...latestUpdate };
    } catch (error) {
        return { ok: false, error: error.message, currentVersion: app.getVersion(), releaseUrl: updater.RELEASES_PAGE };
    }
});

ipcMain.handle('update-download', async (event) => {
    const sender = event.sender;
    try {
        if (!latestUpdate?.installer) throw new Error('No update to download.');
        downloadedInstaller = await updater.downloadUpdate(latestUpdate.installer, (progress) => {
            if (!sender.isDestroyed()) sender.send('update-progress', progress);
        });
        return { ok: true };
    } catch (error) {
        return { ok: false, cancelled: Boolean(error.cancelled), error: error.message };
    }
});

ipcMain.handle('update-cancel', () => updater.cancelDownload());

ipcMain.handle('update-install', () => {
    try {
        for (const cancel of runningJobs.values()) cancel();
        updater.installUpdate(downloadedInstaller);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

ipcMain.handle('open-release-page', () => {
    const url = latestUpdate?.releaseUrl || updater.RELEASES_PAGE;
    if (url.startsWith('https://github.com/')) shell.openExternal(url);
});

/* ------------------------------------------------------------------ */
/* Background-removal models                                           */
/* ------------------------------------------------------------------ */

bgModels.onModelsChanged((list) => {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.webContents.isDestroyed()) win.webContents.send('bg-models-changed', list);
    }
});

const validModelIds = (ids) => (Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string' && bgModels.getModel(id));

ipcMain.handle('bg-models', () => bgModels.listModels());
ipcMain.handle('bg-download', (_event, ids) => bgModels.downloadModels(validModelIds(ids)));
ipcMain.handle('bg-cancel-downloads', () => bgModels.cancelDownloads());
ipcMain.handle('bg-delete-model', (_event, id) => {
    const [valid] = validModelIds(id);
    return valid ? bgModels.deleteModel(valid) : undefined;
});
