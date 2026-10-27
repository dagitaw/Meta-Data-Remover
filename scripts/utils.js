/* Small, dependency-free helpers shared by the renderer modules. */

export const $ = (id) => document.getElementById(id);

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '';
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const fileNameOf = (filePath) => filePath.split(/[\\/]/).pop();

/** Windows/POSIX/UNC path -> file:// URL (encodes spaces, #, % etc.). */
export function toFileUrl(filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    let url = parts
        .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
        .join('/');
    if (url.startsWith('//')) return `file:${url}`; // UNC share
    if (!url.startsWith('/')) url = `/${url}`;
    return `file://${url}`;
}

/** createElement shorthand. */
export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const ICON_PATHS = {
    video: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4Z',
    image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5Z',
    audio: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z',
    close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
    folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z',
    retry: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z'
};

export function icon(name, size = 18) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.video);
    svg.appendChild(path);
    return svg;
}

export function iconButton(name, title, onClick) {
    const button = el('button', 'icon-btn');
    button.type = 'button';
    button.title = title;
    button.appendChild(icon(name));
    button.addEventListener('click', onClick);
    return button;
}

let toastTimer = null;
export function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 3200);
}
