const { contextBridge, ipcRenderer } = require('electron');

console.log('PRELOAD.JS LOADED');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFile: () => ipcRenderer.invoke('select-file'),

    removeMetaData: (filePath, outputFolder, outputFileName) =>
        ipcRenderer.invoke('remove-meta-data', filePath, outputFolder, outputFileName),

    SelectOutputFolder: () => ipcRenderer.invoke('select-output-folder')

});