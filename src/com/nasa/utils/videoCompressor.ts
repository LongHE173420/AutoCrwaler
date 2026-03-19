import ffmpeg from 'fluent-ffmpeg';
import { ENV } from '../config/env';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

ffmpeg.setFfmpegPath(ENV.FFMPEG_PATH || 'ffmpeg');
if (ENV.FFPROBE_PATH) {
    ffmpeg.setFfprobePath(ENV.FFPROBE_PATH);
}

const TARGET_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

function getFileSizeBytes(filePath: string): number {
    try {
        return fs.statSync(filePath).size;
    } catch {
        return 0;
    }
}

function ensureDir(dir: string) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (e: any) {
        console.error(`[COMPRESS] ensureDir failed: ${dir}`, e.message);
    }
}


export async function compressVideoTo5MB(inputPath: string, outputDir: string): Promise<string> {
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
            if (inputPath !== outputPath) fs.copyFileSync(inputPath, outputPath);
            return outputPath;
        }

        // 2. Nếu đã có bản nén nhỏ hơn 5MB, trả về luôn
        outputPath = path.join(outputDir, `${baseName}_compressed${ext}`);
        if (fs.existsSync(outputPath) && getFileSizeBytes(outputPath) <= TARGET_SIZE_BYTES) {
            return outputPath;
        }

        // 3. Nén video với chất lượng cố định (CRF 26, Slow) để có độ nét tốt nhất
        console.log(`[COMPRESS] ${(currentSize / 1024 / 1024).toFixed(2)}MB → Target standard (CRF 26, Slow)`);

        return new Promise((resolve, reject) => {
            const command = ffmpeg(inputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .audioBitrate('96k')
                .outputOptions([
                    '-preset slow',
                    '-crf 26',
                    '-movflags +faststart',
                    '-vf scale=-2:720',
                    '-profile:v main',
                    '-level 3.1'
                ])
                .output(outputPath);

            const timeout = setTimeout(() => {
                const proc = (command as any).ffmpegProc;
                const pid = proc?.pid;
                console.error(`[COMPRESS] TIMEOUT reached (${ENV.COMPRESS_TIMEOUT_MS}ms). Killing process ${pid}...`);

                if (process.platform === 'win32' && pid) {
                    exec(`taskkill /F /T /PID ${pid}`, (err: any) => {
                        if (err) console.error(`[COMPRESS] Taskkill error: ${err.message}`);
                    });
                } else {
                    command.kill('SIGKILL');
                }
                setTimeout(() => { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); }, 1000);
                reject(new Error(`Compression timeout: Process exceeded ${ENV.COMPRESS_TIMEOUT_MS}ms.`));
            }, ENV.COMPRESS_TIMEOUT_MS);

            command
                .on('progress', (progress: any) => {
                    if (progress.percent) {
                        process.stdout.write(`\r  [COMPRESS] Processing: ${progress.percent.toFixed(2)}%   `);
                    }
                })
                .on('end', () => {
                    clearTimeout(timeout);
                    const newSize = getFileSizeBytes(outputPath);
                    if (newSize > TARGET_SIZE_BYTES) {
                        console.log(`\n[COMPRESS] FAILED: Size still > 5MB (${(newSize / 1024 / 1024).toFixed(2)}MB). Discarding.`);
                        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                        reject(new Error(`Compression failed: Size still too large (${(newSize / 1024 / 1024).toFixed(2)}MB)`));
                    } else {
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
    } catch (e: any) {
        console.error('[COMPRESS] Critical Error:', e.message);
        throw e;
    }
}
