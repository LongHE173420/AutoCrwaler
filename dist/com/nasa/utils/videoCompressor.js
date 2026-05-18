"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressVideoTo5MB = compressVideoTo5MB;
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const env_1 = require("../config/env");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
fluent_ffmpeg_1.default.setFfmpegPath(env_1.ENV.FFMPEG_PATH || 'ffmpeg');
if (env_1.ENV.FFPROBE_PATH) {
    fluent_ffmpeg_1.default.setFfprobePath(env_1.ENV.FFPROBE_PATH);
}
const TARGET_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
function getFileSizeBytes(filePath) {
    try {
        return fs.statSync(filePath).size;
    }
    catch {
        return 0;
    }
}
function ensureDir(dir) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    catch (e) {
        console.error(`[COMPRESS] ensureDir failed: ${dir}`, e.message);
    }
}
async function compressVideoTo5MB(inputPath, outputDir) {
    try {
        ensureDir(outputDir);
        const currentSize = getFileSizeBytes(inputPath);
        const ext = path.extname(inputPath) || '.mp4';
        const baseName = path.basename(inputPath, ext);
        let outputPath = path.join(outputDir, `${baseName}${ext}`);
        const MAX_RAW_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
        if (currentSize > MAX_RAW_SIZE_BYTES) {
            console.log(`[COMPRESS] SKIPPED: Raw file too large (${(currentSize / 1024 / 1024).toFixed(2)}MB > 10MB).`);
            throw new Error(`Video too large to compress: ${(currentSize / 1024 / 1024).toFixed(2)}MB > 10MB`);
        }
        // 1. Nếu file đã nhỏ hơn 5MB, giữ nguyên chất lượng
        if (currentSize <= TARGET_SIZE_BYTES) {
            console.log(`[COMPRESS] Already ≤5MB (${(currentSize / 1024 / 1024).toFixed(2)}MB), copying to: ${outputPath}`);
            if (inputPath !== outputPath)
                fs.copyFileSync(inputPath, outputPath);
            return outputPath;
        }
        // 2. Nếu đã có bản nén nhỏ hơn 5MB, trả về luôn
        outputPath = path.join(outputDir, `${baseName}_compressed${ext}`);
        if (fs.existsSync(outputPath) && getFileSizeBytes(outputPath) <= TARGET_SIZE_BYTES) {
            return outputPath;
        }
        // 3. Nén video với chất lượng cố định (CRF 26, Slow) để có độ nét tốt nhất
        console.log(`[COMPRESS] ${(currentSize / 1024 / 1024).toFixed(2)}MB → Target standard (CRF 26, fast)`);
        return new Promise((resolve, reject) => {
            const command = (0, fluent_ffmpeg_1.default)(inputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .audioBitrate('96k')
                .outputOptions([
                '-preset fast',
                '-crf 26',
                '-movflags +faststart',
                '-vf scale=-2:720',
                '-profile:v main',
                '-level 3.1'
            ])
                .output(outputPath);
            const timeout = setTimeout(() => {
                const proc = command.ffmpegProc;
                const pid = proc?.pid;
                console.error(`[COMPRESS] TIMEOUT reached (${env_1.ENV.COMPRESS_TIMEOUT_MS}ms). Killing process ${pid}...`);
                if (process.platform === 'win32' && pid) {
                    (0, child_process_1.exec)(`taskkill /F /T /PID ${pid}`, (err) => {
                        if (err)
                            console.error(`[COMPRESS] Taskkill error: ${err.message}`);
                    });
                }
                else {
                    command.kill('SIGKILL');
                }
                setTimeout(() => { if (fs.existsSync(outputPath))
                    fs.unlinkSync(outputPath); }, 1000);
                reject(new Error(`Compression timeout: Process exceeded ${env_1.ENV.COMPRESS_TIMEOUT_MS}ms.`));
            }, env_1.ENV.COMPRESS_TIMEOUT_MS);
            command
                .on('progress', (progress) => {
                if (progress.percent) {
                    process.stdout.write(`\r  [COMPRESS] Processing: ${progress.percent.toFixed(2)}%   `);
                }
            })
                .on('end', () => {
                clearTimeout(timeout);
                const newSize = getFileSizeBytes(outputPath);
                if (newSize > TARGET_SIZE_BYTES) {
                    console.log(`\n[COMPRESS] FAILED: Size still > 5MB (${(newSize / 1024 / 1024).toFixed(2)}MB). Discarding.`);
                    if (fs.existsSync(outputPath))
                        fs.unlinkSync(outputPath);
                    reject(new Error(`Compression failed: Size still too large (${(newSize / 1024 / 1024).toFixed(2)}MB)`));
                }
                else {
                    console.log(`\n[COMPRESS] DONE: ${(newSize / 1024 / 1024).toFixed(2)}MB → ${outputPath}`);
                    resolve(outputPath);
                }
            })
                .on('error', (err) => {
                clearTimeout(timeout);
                console.error("FFmpeg error:", err);
                reject(err);
            })
                .run();
        });
    }
    catch (e) {
        console.error('[COMPRESS] Critical Error:', e.message);
        throw e;
    }
}
