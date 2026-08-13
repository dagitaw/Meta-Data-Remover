const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { app } = require('electron');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.avif', '.heic', '.heif']);
const VIDEO_AUDIO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.mpeg', '.mpg', '.3gp', '.mp3', '.wav', '.m4a', '.flac']);

function getBinPath(binaryName) {
    const isDev = !app.isPackaged;
    return isDev
        ? path.join(__dirname, '..', 'bin', binaryName)
        : path.join(process.resourcesPath, 'bin', binaryName);
}

function removeMetaData(filePath, outputFolder, outputFileName) {
    return new Promise((resolve, reject) => {
        const originalExt = path.extname(filePath).toLowerCase();
        const fileDirectory = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const baseNameWithoutExt = path.basename(fileName, originalExt);
        const targetDir = outputFolder || fileDirectory;

        console.log("start processing file:", filePath);

        if (IMAGE_EXTENSIONS.has(originalExt)) {
            const exiftoolPath = getBinPath('exiftool.exe');


            const detectArgs = [
                '-s3',
                '-FileType',
                filePath
            ];

            execFile(exiftoolPath, detectArgs, (detectError, stdout, stderr) => {
                if (detectError) {
                    console.error('ExifTool detection error:', detectError);
                    return reject(detectError);
                }

                const detectedType = stdout.trim().toLowerCase();

                console.log("Original extension:", originalExt);
                console.log("Detected file type:", detectedType);

                /*
                 * Map ExifTool's FileType values to normal extensions.
                 */
                const typeToExtension = {
                    jpeg: '.jpg',
                    jpg: '.jpg',
                    png: '.png',
                    webp: '.webp',
                    gif: '.gif',
                    bmp: '.bmp',
                    avif: '.avif',
                    heic: '.heic',
                    heif: '.heif'
                };

                const detectedExt = typeToExtension[detectedType];

                if (!detectedExt) {
                    return reject(
                        new Error(
                            `Unsupported or unknown image format: "${detectedType}" ` +
                            `for file "${filePath}"`
                        )
                    );
                }

                /*
                 * Let the user know if the extension doesn't match
                 * the actual file format.
                 */
                if (originalExt !== detectedExt) {
                    console.warn(
                        `Extension mismatch detected: ${originalExt} -> ${detectedExt}`
                    );
                }

                let outputPath;

                if (outputFileName && outputFileName.trim() !== '') {
                    let requestedName = outputFileName.trim();

                    /*
                     * Remove whatever extension the user supplied.
                     * We'll add the REAL extension.
                     */
                    const requestedExt = path.extname(requestedName);

                    if (requestedExt) {
                        requestedName = requestedName.slice(
                            0,
                            -requestedExt.length
                        );
                    }

                    outputPath = path.join(
                        targetDir,
                        `${requestedName}${detectedExt}`
                    );
                } else {
                    outputPath = path.join(
                        targetDir,
                        `${baseNameWithoutExt}_clean${detectedExt}`
                    );
                }

                console.log("Detected format:", detectedType);
                console.log("Saving to:", outputPath);

                try {
 
                    fs.copyFileSync(filePath, outputPath);
                } catch (copyError) {
                    console.error('Error copying image:', copyError);
                    return reject(copyError);
                }

                const removeMetadataArgs = [
                    '-all=',
                    '-overwrite_original',
                    '-m',
                    outputPath
                ];

                execFile(
                    exiftoolPath,
                    removeMetadataArgs,
                    (error, stdout, stderr) => {
                        if (error) {
                            console.error('ExifTool metadata error:', error);

                            try {
                                if (fs.existsSync(outputPath)) {
                                    fs.unlinkSync(outputPath);
                                }
                            } catch (cleanupError) {
                                console.error(
                                    'Error cleaning up failed output:',
                                    cleanupError
                                );
                            }

                            return reject(error);
                        }

                        console.log(
                            'Image metadata removed successfully'
                        );

                        resolve({
                            success: true,
                            inputPath: filePath,
                            outputPath,
                            originalExtension: originalExt,
                            detectedExtension: detectedExt,
                            detectedType
                        });
                    }
                );
            });


        } else if (VIDEO_AUDIO_EXTENSIONS.has(originalExt)) {
            const ffmpegPath = getBinPath('ffmpeg.exe');

            let outputPath;

            if (outputFileName && outputFileName.trim() !== '') {
                const requestedName = outputFileName.trim();
                const requestedExt = path.extname(requestedName);

                if (requestedExt) {
                    const nameWithoutExt = requestedName.slice(
                        0,
                        -requestedExt.length
                    );

                    outputPath = path.join(
                        targetDir,
                        `${nameWithoutExt}${originalExt}`
                    );
                } else {
                    outputPath = path.join(
                        targetDir,
                        `${requestedName}${originalExt}`
                    );
                }
            } else {
                outputPath = path.join(
                    targetDir,
                    `${baseNameWithoutExt}_clean${originalExt}`
                );
            }

            console.log("start processing file:", filePath);
            console.log("saving to:", outputPath);

            const args = [
                '-i', filePath,
                '-map', '0',
                '-map_metadata', '-1',
                '-map_chapters', '-1',
                '-c', 'copy',
                '-metadata', 'encoder=',
                outputPath
            ];

            execFile(ffmpegPath, args, (error, stdout, stderr) => {
                if (error) {
                    console.error('FFmpeg error:', error);
                    return reject(error);
                }

                console.log(
                    'Video/audio metadata removed successfully'
                );

                resolve({
                    success: true,
                    inputPath: filePath,
                    outputPath
                });
            });

        } else {
            reject(
                new Error(`Unsupported file type: ${originalExt}`)
            );
        }
    });
}

module.exports = removeMetaData;