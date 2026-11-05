# Meta-Data-Remover

Meta-Data-Remover is a desktop application for removing metadata from — and converting — images, videos and audio, and for removing the background from images.

Everything is processed locally on your computer using the bundled ExifTool and FFmpeg, and on-device AI models for background removal. Nothing is uploaded anywhere.

## Features

### Three modes

Switch between them at any time from the top bar.

* **Remove metadata** — strips GPS location, camera details, dates, author tags and other embedded information without re-encoding, so quality stays exactly the same.
* **Convert files** — change format, codec, resolution, frame rate or quality. Metadata is removed during conversion by default (can be turned off).
* **Remove background** — cuts out the subject of an image and saves it with a transparent background, using an AI model that runs on your computer.

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

### Automatic update check

* On start-up the app checks the latest GitHub release in the background.
* If a newer version is out, it shows what's new (the release notes) and offers **Update now**, **Later** or **Skip this version**.
* **Update now** downloads the installer with a progress bar, closes the app and runs the installer.
* You can also check any time with the version button in the top-right corner. A blue dot means an update is waiting.

## Background Removal

Pick a model from the **Model** menu. Each one is downloaded once, only when you choose it, and then works offline. They are not included in the installer, so the app stays small.

| Model | Download | Best for | License |
| --- | --- | --- | --- |
| U²-Net-p | 4.6 MB | Fastest; simple images (rougher edges) | Apache-2.0 |
| MODNet | 26 MB | People and portraits only — very good on hair | Apache-2.0 |
| **ISNet** (recommended) | 179 MB | Most images — people, products, animals | Apache-2.0 |
| U²-Net | 176 MB | Good all-round, older | Apache-2.0 |
| BRIA RMBG-1.4 | 44 MB | Best quality on most photos | **Non-commercial use only** |

* Download a single model, or **Download all** (about 430 MB). Downloads continue in the background, and you can start with any model that has finished.
* Delete a model from the same menu to free the space.
* **Result:** transparent **PNG** or **WebP** (smaller), or put the cut-out on **white** or any **colour**.
* **Trim empty space** crops the image to the subject.
* **Before / after preview:** click a finished image to compare with a slider, and check the edges on a checkerboard, white, black or green background. **Try another model** re-runs the image.
* Uses the graphics card through DirectML on Windows when available, and falls back to the CPU automatically.
* Phone photos are rotated correctly (EXIF orientation), and the output contains no metadata.
* Works on images only — videos and audio in the list are skipped in this mode.

Models are stored in `%APPDATA%\Metadata Remover\models`, so they survive app updates. Each download is checked against its expected size, and against a SHA-256 checksum where one is published.

> **License note:** BRIA RMBG-1.4 is free for personal, non-commercial use only. Use one of the Apache-2.0 models for commercial work.

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

### Background Removal

1. FFmpeg decodes the image (applying its rotation) and resizes it to the size the model expects.
2. ONNX Runtime runs the model and predicts a mask: how much of each pixel belongs to the subject.
3. FFmpeg scales the mask back to the full image size and uses it as the transparency channel. Trimming, solid backgrounds and the PNG/WebP output happen in the same step.

The loaded model is kept in memory between images, and freed after 5 minutes of not being used.

The application always uses the `ffmpeg.exe` and `exiftool.exe` in the project's `bin` folder — never another copy installed on the computer.

## Technologies Used

### Electron

Electron is used to build the desktop application using HTML, CSS and JavaScript.

### HTML and CSS

HTML builds the structure of the interface; CSS handles the layout, dark theme, colours and animations.

### JavaScript

JavaScript handles the interface (as ES modules), the background processing and the update checker.

### Node.js

Node.js is used by Electron for file handling, process management and running ExifTool and FFmpeg.

### ExifTool

ExifTool removes metadata from image files.

### FFmpeg

FFmpeg removes metadata from video and audio files, performs all conversions, and handles image decoding and output for background removal.

### ONNX Runtime

ONNX Runtime (`onnxruntime-node`) runs the background-removal models, on the GPU through DirectML when available.

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
  bg-models.js              background-removal model menu and downloads
  preview.js                before / after preview
  dialog.js                 result dialog
  updates.js                update dialog and "check for updates" button
  utils.js                  small shared helpers

services/                   background processing
  formats.js                every format and codec with its FFmpeg settings
  convertMedia.js           builds and runs conversions
  removeMetaData.js         metadata removal (ExifTool / FFmpeg)
  removeBackground.js       background removal (FFmpeg + ONNX Runtime)
  bgModels.js               model list, downloads and storage
  download.js               shared download helper (progress, cancel, checksums)
  ffmpeg.js                 runs FFmpeg with progress, cancel and raw-data support
  fileUtils.js              file types, safe output names, folder scanning
  updater.js                checks GitHub releases, downloads and runs the installer

tools/selftest.js           checks background removal works on this computer

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

### Check Background Removal

```bash
npm run selftest
```

Loads ONNX Runtime, reports whether GPU acceleration is available, downloads the small U²-Net-p model and runs a real cut-out.

## Building the Application

The application uses Electron Builder to create the Windows installer.

```bash
npm run build
```

The installer will be placed inside the `dist` directory. FFmpeg and ExifTool are bundled with it.

## Publishing an Update

The app checks `https://github.com/dagitaw/Meta-Data-Remover/releases/latest`.

1. Bump `"version"` in `package.json` (for example `2.2.0`) and add the changes to `CHANGELOG.md`.
2. Run `npm run build`.
3. Create a GitHub release with the tag `v2.2.0`, and attach `dist/Metadata Remover Setup 2.2.0.exe`.

Installed copies will offer the update the next time they start. Draft and pre-release releases are ignored.

## Privacy

Meta-Data-Remover processes files locally on your computer.

Files are never uploaded to a remote server. The app only connects to the internet to:

* check GitHub for updates (and download one if you choose to install it), and
* download a background-removal model when you ask for one (from GitHub or Hugging Face).

Background removal runs entirely on your computer.

## Disclaimer

Metadata removal can permanently remove information from a file. The original file is never changed — a cleaned or converted copy is created — but keep backups of important files anyway.

Metadata removal does not guarantee that every possible form of identifying information has been removed from every file format.

## License

This project is licensed under the ISC License.

The background-removal models are downloaded from their original publishers and keep their own licenses: U²-Net, U²-Net-p and ISNet (via [rembg](https://github.com/danielgatis/rembg)) and MODNet are Apache-2.0; BRIA RMBG-1.4 is for non-commercial use only.

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.
