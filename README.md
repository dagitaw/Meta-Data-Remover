# Meta-Data-Remover

Meta-Data-Remover is a desktop application for removing metadata from — and converting — images, videos and audio.

Everything is processed locally on your computer using the bundled ExifTool and FFmpeg. Nothing is uploaded anywhere.

## Features

### Two modes

Switch between them at any time from the top bar.

* **Remove metadata** — strips GPS location, camera details, dates, author tags and other embedded information without re-encoding, so quality stays exactly the same.
* **Convert files** — change format, codec, resolution, frame rate or quality. Metadata is removed during conversion by default (can be turned off).

### Adding files

* YouTube-style upload screen
* Drag and drop files **anywhere** on the window
* Select multiple files at once, or drop whole folders (sub-folders are scanned too)
* Unsupported files and duplicates are skipped automatically

### Working with files

* File list with thumbnails, video length, file size and the target format
* Live progress bar for every file
* Cancel a running batch, retry failed files, or remove files from the list
* "Show in folder" button for every finished file
* Several images are processed at the same time; video encodes run one at a time so each gets the full CPU/GPU
* Choose a custom output folder and (for a single file) a custom output name
* Output never overwrites an existing file — a numbered copy such as `name (1).mp4` is created instead
* The original file is never modified
* Settings are remembered between sessions
* Clear, plain-language error messages (for example "This file has no audio track")

## Conversion Options

### Video

| Output format | Available codecs |
| --- | --- |
| MP4 | H.264, H.265 (HEVC), AV1, GPU encoders, keep original |
| MOV | H.264, H.265 (HEVC), Apple ProRes, GPU encoders, keep original |
| MKV | H.264, H.265 (HEVC), AV1, VP9, GPU encoders, keep original |
| WebM | VP9, AV1 |
| AVI | MPEG-4 (Xvid), H.264, keep original |
| GIF | Animated GIF with an optimised colour palette |
| MP3 / M4A / WAV | Extract the audio track only |

* **GPU encoders:** NVIDIA (NVENC), Intel (Quick Sync) and AMD (AMF) for H.264 and H.265 — much faster on supported graphics cards.
* **Keep original:** changes the container without re-encoding (instant and lossless).
* **Quality:** High, Balanced or Smaller file.
* **Resolution:** Original, 4K, 1440p, 1080p, 720p, 480p or 360p. Measured on the short side, so vertical videos such as YouTube Shorts keep their shape. Videos are never upscaled.
* **Frame rate:** Original, 60, 30, 24 or 15 fps.
* **Audio:** keep or remove.

Codecs that your copy of FFmpeg does not include are shown greyed out.

### Images

* Output formats: JPG, PNG, WebP, AVIF, BMP, TIFF, GIF and ICO
* Quality slider (1–100) for JPG, WebP and AVIF — WebP at 100 is lossless
* Maximum size: Original, or limit the longest side (3840 px down to 512 px)

### Audio

* Output formats: MP3, M4A (AAC), Opus, WAV and FLAC
* Quality: High, Balanced or Smaller file

## Supported Input Formats

### Images

JPG, JPEG, PNG, GIF, BMP, WebP, AVIF, HEIC, HEIF, TIFF, ICO

### Video

MP4, MOV, AVI, MKV, WebM, WMV, FLV, MPEG, MPG, 3GP, M4V, TS, MTS, M2TS

### Audio

MP3, WAV, M4A, FLAC, AAC, OGG, Opus, WMA

## How It Works

### Images

The real image format is detected from the file's contents, not its extension. If a file is mislabelled (for example a WebP saved as `.jpg`), the cleaned copy is saved with the correct extension.

ExifTool then removes all embedded metadata.

### Video and Audio

FFmpeg copies the original streams without the metadata. Nothing is re-encoded just to remove metadata, so the original quality is kept.

### Conversion

FFmpeg converts the file using the selected format, codec and settings. Progress is read from FFmpeg while it runs.

The application always uses the `ffmpeg.exe` and `exiftool.exe` in the project's `bin` folder — never another copy installed on the computer.

## Technologies Used

### Electron

Electron is used to build the desktop application using HTML, CSS and JavaScript.

### HTML and CSS

HTML builds the structure of the interface; CSS handles the layout, dark theme, colours and animations.

### JavaScript

JavaScript handles the interface (as ES modules) and the background processing.

### Node.js

Node.js is used by Electron for file handling, process management and running ExifTool and FFmpeg.

### ExifTool

ExifTool removes metadata from image files.

### FFmpeg

FFmpeg removes metadata from video and audio files and performs all conversions.

### Electron Builder

Electron Builder packages the application into a Windows installer.

## Project Structure

```
index.js                    main process and IPC handlers
preload.js                  secure bridge between the interface and the main process
index.html, styles/         interface markup and styles

scripts/                    interface (ES modules)
  main.js                   entry point, connects the modules
  state.js                  settings and the file list
  dropzone.js               drag and drop, file picker
  queue-view.js             file list, thumbnails and progress bars
  settings-view.js          mode switch, settings panel and buttons
  processor.js              runs the jobs (in parallel where it helps)
  dialog.js                 result dialog
  utils.js                  small shared helpers

services/                   background processing
  formats.js                every format and codec with its FFmpeg settings
  convertMedia.js           builds and runs conversions
  removeMetaData.js         metadata removal (ExifTool / FFmpeg)
  ffmpeg.js                 runs FFmpeg with progress and cancel support
  fileUtils.js              file types, safe output names, folder scanning

bin/                        ffmpeg.exe, exiftool.exe
```

## Running From Source

### Requirements

* Node.js
* npm

The required Windows binaries (ExifTool and FFmpeg) are included in the `bin` folder.

### Install Dependencies

```bash
npm install
```

### Start the Application

```bash
npm start
```

Or double-click `start-app.bat`, which installs the dependencies if needed and starts the app.

## Building the Application

The application uses Electron Builder to create the Windows installer.

```bash
npm run build
```

The installer will be placed inside the `dist` directory. FFmpeg and ExifTool are bundled with it.

## Privacy

Meta-Data-Remover processes files locally on your computer.

Files are never uploaded to a remote server.

## Disclaimer

Metadata removal can permanently remove information from a file. The original file is never changed — a cleaned or converted copy is created — but keep backups of important files anyway.

Metadata removal does not guarantee that every possible form of identifying information has been removed from every file format.

## License

This project is licensed under the ISC License.
