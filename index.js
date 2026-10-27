const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const removeMetaData = require('./services/removeMetaData');
const { convertMedia } = require('./services/convertMedia');
const { getAvailableEncoders } = require('./services/ffmpeg');
const { getCatalog } = require('./services/formats');
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

/**
 * job = { mode: 'clean' | 'convert', inputPath, settings, outputFolder, outputFileName }
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

        const result = job.mode === 'convert'
            ? await convertMedia({ ...job, mediaType }, hooks)
            : await removeMetaData(job.inputPath, job.outputFolder, job.outputFileName, hooks);

        return { success: true, outputPath: result.outputPath };
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
