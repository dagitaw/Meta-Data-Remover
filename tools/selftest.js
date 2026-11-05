/*
 * Background-removal self-test: `npm run selftest`
 *
 * Checks, on this computer, that ONNX Runtime loads, whether the GPU
 * (DirectML) is usable, and runs a real cut-out with the small U²-Net-p model
 * through the bundled ffmpeg. Nothing here is part of the app itself.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { getBinPath } = require('../services/fileUtils');
const models = require('../services/bgModels');
const { downloadFile } = require('../services/download');
const { removeBackground } = require('../services/removeBackground');

const work = path.join(os.tmpdir(), 'metadata-remover-selftest');
const results = [];
const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
    fs.mkdirSync(work, { recursive: true });
    const ffmpeg = getBinPath('ffmpeg');

    // 1. ONNX Runtime
    let ort;
    try {
        ort = require('onnxruntime-node');
        check('ONNX Runtime loads', true, require('onnxruntime-node/package.json').version);
    } catch (error) {
        check('ONNX Runtime loads', false, error.message);
        return finish();
    }

    // 2. Small model (4.6 MB)
    const model = models.getModel('u2netp');
    const target = models.modelPath(model);
    try {
        if (!fs.existsSync(target)) await downloadFile(model.url, target, { expectedSize: model.size, sha256: model.sha256 });
        check('Model download + checksum', true, target);
    } catch (error) {
        check('Model download + checksum', false, error.message);
        return finish();
    }

    // 3. GPU?
    if (process.platform === 'win32') {
        try {
            const session = await ort.InferenceSession.create(target, { executionProviders: ['dml'] });
            await session.release?.();
            check('GPU acceleration (DirectML)', true, 'available');
        } catch (error) {
            console.log(`INFO  GPU acceleration (DirectML) not available — CPU will be used (${error.message.split('\n')[0]})`);
        }
    }

    // 4. Real cut-out: a skin-coloured block on a blue background
    const input = path.join(work, 'selftest-input.png');
    execFileSync(ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi',
        '-i', 'color=c=0x3a6ea5:s=640x480,drawbox=x=220:y=110:w=200:h=280:color=0xf2c9a0:t=fill',
        '-frames:v', '1', input]);

    try {
        const started = Date.now();
        const result = await removeBackground({ inputPath: input, outputFolder: work, settings: { bg: { model: 'u2netp' } } });
        const info = (() => {
            try { execFileSync(ffmpeg, ['-hide_banner', '-i', result.outputPath], { stdio: 'pipe' }); return ''; }
            catch (error) { return error.stderr.toString(); } // ffmpeg -i with no output exits 1 but prints stream info
        })();
        const hasAlpha = /rgba|ya8|pal8/.test(info);
        check('Background removed', hasAlpha, `${path.basename(result.outputPath)} · ${result.width}×${result.height} · ${Date.now() - started} ms`);
        fs.rmSync(result.outputPath, { force: true });
    } catch (error) {
        check('Background removed', false, error.message);
    }

    finish();
})();

function finish() {
    const ok = results.length > 0 && results.every(Boolean);
    console.log(ok ? '\nAll checks passed.' : '\nSome checks failed.');
    process.exitCode = ok ? 0 : 1;
}
