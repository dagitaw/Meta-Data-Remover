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
    },

    // Background-removal models
    listModels: () => ipcRenderer.invoke('bg-models'),
    downloadModels: (ids) => ipcRenderer.invoke('bg-download', ids),
    cancelModelDownloads: () => ipcRenderer.invoke('bg-cancel-downloads'),
    deleteModel: (id) => ipcRenderer.invoke('bg-delete-model', id),
    onModelsChanged: (callback) => {
        const listener = (_event, list) => callback(list);
        ipcRenderer.on('bg-models-changed', listener);
        return () => ipcRenderer.removeListener('bg-models-changed', listener);
    },

    // Updates
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => ipcRenderer.invoke('update-check'),
    downloadUpdate: () => ipcRenderer.invoke('update-download'),
    cancelUpdateDownload: () => ipcRenderer.invoke('update-cancel'),
    installUpdate: () => ipcRenderer.invoke('update-install'),
    openReleasePage: () => ipcRenderer.invoke('open-release-page'),
    onUpdateProgress: (callback) => {
        const listener = (_event, progress) => callback(progress);
        ipcRenderer.on('update-progress', listener);
        return () => ipcRenderer.removeListener('update-progress', listener);
    }
});
