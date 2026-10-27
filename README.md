# Metadata Remover

Desktop app (Electron) for stripping metadata from — and converting — videos, images and audio. Everything runs locally with the bundled `bin/ffmpeg.exe` and `bin/exiftool.exe`.

## Features

- **Drag & drop anywhere** in the window (YouTube-style upload screen), or browse. Multiple files and whole folders are supported.
- **Remove metadata** (lossless): ExifTool for images, ffmpeg stream-copy for video/audio.
- **Convert**
  - Video → MP4, MOV, MKV, WebM, AVI, animated GIF, or extract audio (MP3 / M4A / WAV)
  - Video codecs: H.264, H.265/HEVC, AV1, VP9, ProRes, MPEG-4, GPU encoders (NVIDIA NVENC, Intel QSV, AMD AMF), or keep original (no re-encode)
  - Quality presets, resolution (4K → 360p, by short side so vertical Shorts work), frame rate, keep/remove audio
  - Image → JPG, PNG, WebP, AVIF, BMP, TIFF, GIF, ICO with quality slider and max size
  - Audio → MP3, M4A, Opus, WAV, FLAC
  - Optional metadata stripping while converting (on by default)
- Live progress per file, cancel, retry, "Show in folder". Output never overwrites an existing file.

## Project layout

```
index.js                    main process + IPC
preload.js                  safe bridge (window.electronAPI)
index.html, styles/         UI markup and styles

scripts/                    renderer (ES modules)
  main.js                   entry point, wires the modules together
  state.js                  settings (saved between sessions) + file queue
  dropzone.js               drag & drop and file picker
  queue-view.js             file list rows, lazy thumbnails, progress
  settings-view.js          mode switch, settings panel, footer buttons
  processor.js              runs jobs: light ones in parallel, one video encode at a time
  dialog.js                 result dialog
  utils.js                  small helpers

services/                   main-process work
  formats.js                every format/codec and its ffmpeg arguments
  convertMedia.js           builds and runs conversion commands
  removeMetaData.js         lossless metadata removal (ExifTool / ffmpeg)
  ffmpeg.js                 ffmpeg runner (progress, cancel, encoder detection)
  fileUtils.js              file types, safe output names, folder scanning
```

Only `bin/ffmpeg.exe` and `bin/exiftool.exe` are used — never a system-wide copy. Codecs your ffmpeg build doesn't include are greyed out automatically.

Double-click `start-app.bat` to run in development.

## Run

```
npm install
npm start
npm run build   # Windows installer in dist/
```
