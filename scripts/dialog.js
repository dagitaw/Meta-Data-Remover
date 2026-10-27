/* Result dialog shown after a run. */
import { $ } from './utils.js';

const api = window.electronAPI;

const ui = {
    overlay: $('alertOverlay'),
    icon: $('alertIcon'),
    title: $('alertTitle'),
    message: $('alertMessage'),
    openButton: $('alertOpenButton'),
    closeButton: $('alertCloseButton')
};

const ICON_TEXT = { success: '✓', warning: '!', error: '×' };

let revealPath = null;

export function showAlert(title, message, type = 'success', pathToReveal = null) {
    ui.title.textContent = title;
    ui.message.textContent = message;
    ui.icon.className = `alert-icon ${type === 'success' ? '' : type}`;
    ui.icon.textContent = ICON_TEXT[type] || ICON_TEXT.success;
    revealPath = pathToReveal;
    ui.openButton.classList.toggle('hidden', !pathToReveal);
    ui.overlay.classList.add('show');
    ui.closeButton.focus();
}

export function closeAlert() {
    ui.overlay.classList.remove('show');
}

ui.closeButton.addEventListener('click', closeAlert);
ui.openButton.addEventListener('click', () => {
    if (revealPath) api.showInFolder(revealPath);
    closeAlert();
});
ui.overlay.addEventListener('click', (e) => { if (e.target === ui.overlay) closeAlert(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAlert(); });
