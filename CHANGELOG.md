# Changelog

All notable changes to Meta-Data-Remover. Versions follow [semantic versioning](https://semver.org/).

## [2.1.0] — 2026-11-05

### Added
- **Remove background** — a third mode that cuts out the subject of an image and saves it with a transparent background, using AI models that run on your computer.
  - Five models to choose from: U²-Net-p (4.6 MB, fastest), MODNet (26 MB, people only), ISNet (179 MB, recommended), U²-Net (176 MB) and BRIA RMBG-1.4 (44 MB, non-commercial use only).
  - Models are downloaded on demand from the **Model** menu, one at a time or **Download all**. They aren't part of the installer.
  - Downloads run in the background with progress, can be cancelled, and are verified by size and SHA-256 checksum. Models can be deleted again from the same menu.
  - Output as transparent **PNG** or **WebP**, or on **white** or any **colour** background. Optional **Trim empty space** crops to the subject.
  - **Before / after preview** with a comparison slider and checkerboard / white / black / green backgrounds for checking edges, plus **Try another model**.
  - GPU acceleration through DirectML on Windows, with automatic fall-back to the CPU.
  - Phone photos are rotated correctly, and results contain no metadata.
- `npm run selftest` checks that background removal works on the current computer and reports whether GPU acceleration is available.

### Changed
- The mode switch in the top bar now has three tabs: Remove metadata, Convert files, Remove background.
- Background-removal jobs run one at a time (like video encodes), since each one already uses the whole CPU or GPU.

### Improved
- One shared download helper (progress, cancel, size and checksum checks, no half-written files) for both app updates and model downloads.
- The FFmpeg runner is restructured around a single process runner, and can now stream raw image data in and out without temporary files.
- A loaded model is freed from memory after 5 minutes of not being used.
- The installer only includes the Windows x64 build of ONNX Runtime.

## [2.0.0] — 2026-10-28

### Added
- **Convert files** mode: video (MP4, MOV, MKV, WebM, AVI, animated GIF, audio extraction) with H.264, H.265, AV1, VP9, ProRes, MPEG-4 and NVIDIA / Intel / AMD GPU encoders. Also image (JPG, PNG, WebP, AVIF, BMP, TIFF, GIF, ICO) and audio (MP3, M4A, Opus, WAV, FLAC) conversion with quality, resolution and frame-rate options.
- YouTube-style upload screen with drag and drop anywhere on the window, multiple files and whole folders.
- File list with thumbnails, per-file progress, cancel, retry and "Show in folder".
- Automatic update check against GitHub releases, with in-app download and install.
- Audio files supported for metadata removal; more input formats (TIFF, ICO, M4V, TS, MTS, M2TS).

### Changed
- Redesigned dark interface with a two-column layout.
- The app always uses the `ffmpeg.exe` and `exiftool.exe` in its `bin` folder.

### Improved
- Images and lossless jobs run in parallel; faster image cleaning (format detected from the file header, one ExifTool run per image).
- Interface split into ES modules; smaller installer (FFmpeg no longer packed twice).

### Fixed
- Mislabelled images are saved with the correct extension; BMP images no longer fail; parallel jobs can't pick the same output name; half-written files are removed on failure.

## [1.0.0] — 2026-08-13

- First release: remove metadata from images (ExifTool) and videos (FFmpeg).
