const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const removeMetaData = require('./services/removeMetaData');

const createWindow = () => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'assets/icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile(path.join(__dirname, 'index.html'));
    win.setMenuBarVisibility(false);
};

app.whenReady().then(() => {
    createWindow();
});

ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            {
                name: 'Media Files',
                extensions: [
                    'jpg', 'jpeg', 'png', 'gif', 'bmp',
                    'webp', 'avif', 'heic', 'heif',
                    'mp4', 'mov', 'avi', 'mkv', 'webm',
                    'wmv', 'flv', 'mpeg', 'mpg', '3gp'
                ]
            }
        ]
    });

    if (result.canceled) {
        return null;
    }

    return result.filePaths[0];
});

ipcMain.handle('remove-meta-data', async (event, filePath, outputFolder, outputFileName) => {
    try {
        const result = await removeMetaData(filePath, outputFolder, outputFileName);
        return result;

    } catch (error) {
        console.error('Error removing metadata:', error);
        throw error;
    }
});



ipcMain.handle('select-output-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (result.canceled) {
        return null;
    }
    return result.filePaths[0];
});