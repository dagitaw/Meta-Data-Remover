# Meta-Data-Remover

Meta-Data-Remover is a simple desktop application for removing metadata from images and videos.

The application processes files locally on your computer using ExifTool and FFmpeg.

## Features

* Remove metadata from images
* Remove metadata from videos
* Choose a custom output folder
* Choose a custom output file name
* Preserve the original file by creating a cleaned copy
* Automatically detect mismatched image file extensions
* Simple desktop interface
* Local file processing

## Supported Formats

### Images

* JPG
* JPEG
* PNG
* GIF
* BMP
* WebP
* AVIF
* HEIC
* HEIF

Image metadata removal is handled by ExifTool.

### Video

* MP4
* MOV
* AVI
* MKV
* WebM
* WMV
* FLV
* MPEG
* MPG
* 3GP

Video metadata removal is handled by FFmpeg.

### Audio

Audio metadata removal is currently **work in progress** and is not fully supported yet.

## How It Works

### Images

ExifTool is used to detect the actual image format and remove embedded metadata.

The application also checks whether the file extension matches the actual file format. If the extension does not match the detected format, the application can handle the file based on its actual format.

### Videos

FFmpeg is used to process video files and remove metadata while copying the original media streams.

The video does not need to be re-encoded just to remove metadata, which helps keep the original quality intact.

### Audio

Audio metadata removal is currently under development and may not work correctly yet.

## Technologies Used

### Electron

Electron is used to build the desktop application using HTML, CSS, and JavaScript.

### HTML

HTML is used to create the structure of the application's user interface.

### CSS

CSS is used for the application's layout, styling, colors, buttons, and overall appearance.

### JavaScript

JavaScript handles the application's frontend functionality and backend logic.

### Node.js

Node.js is used by Electron for file handling, process management, and running external programs.

### ExifTool

ExifTool is used for detecting and removing metadata from image files.

### FFmpeg

FFmpeg is used to process video files and remove their embedded metadata.

### Electron Builder

Electron Builder is used to package the Electron application into a Windows installer.

## Running From Source

### Requirements

* Node.js
* npm
* ExifTool
* FFmpeg

The required Windows binaries are included with the project.

### Install Dependencies

```bash
npm install
```

### Start the Application

```bash
npm start
```

## Building the Application

The application uses Electron Builder to create the Windows installer.

```bash
npm run build
```

The generated files will be placed inside the `dist` directory.

## Privacy

Meta-Data-Remover processes files locally on your computer.

Files are not uploaded to a remote server for metadata removal.

## Disclaimer

Metadata removal can permanently remove information from a file.

Always keep a backup of your original files before processing them.

Metadata removal does not guarantee that every possible form of identifying information has been removed from every file format.

## License

This project is licensed under the ISC License.
