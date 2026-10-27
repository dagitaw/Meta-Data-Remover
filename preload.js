const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Files
    selectFiles: () => ipcRenderer.invoke('select-files'),
    resolvePaths: (paths) => ipcRenderer.invoke('resolve-paths', paths),
    selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
    openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),

    // Processing
    getCatalog: () => ipcRenderer.invoke('get-catalog'),
    processFile: (jobId, job) => ipcRenderer.invoke('process-file', jobId, job),
    cancelJob: (jobId) => ipcRenderer.invoke('cancel-job', jobId),
    onProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('job-progress', listener);
        return () => ipcRenderer.removeListener('job-progress', listener);
    }
});
