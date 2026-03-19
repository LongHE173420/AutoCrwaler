import { execFile, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MysqlStore } from '../data/MysqlStore';
import { ENV } from '../config/env';
import { Log } from '../utils/log';
import { compressVideoTo5MB } from '../utils/videoCompressor';

const YTDLP_CMD = 'yt-dlp';

interface TikTokMetadata {
    id: string;
    title: string;
    uploader: string;
    tags: string[];
    url: string;
}

type AppLogger = ReturnType<typeof Log.getLogger>;

export class TikTokCrawlService {
    constructor(private logger: AppLogger) { }

    private ytdlp(args: string[], onLine?: (line: string) => void): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const child = execFile(YTDLP_CMD, args, { maxBuffer: 10 * 1024 * 1024 });
                let stdout = '';

                child.stdout?.on('data', (data) => {
                    const line = data.toString();
                    stdout += line;
                    if (onLine) onLine(line);
                });

                child.stderr?.on('data', (data) => {
                    console.error(`[YTDLP ERROR] ${data}`);
                });

                child.on('close', (code) => {
                    clearTimeout(timeout);
                    if (code === 0) resolve(stdout);
                    else reject(new Error(`yt-dlp exited with code ${code}`));
                });

                const timeout = setTimeout(() => {
                    const pid = child.pid;
                    this.logger.error("YTDLP_TIMEOUT", { pid, timeout: ENV.DOWNLOAD_TIMEOUT_MS });
                    if (process.platform === 'win32' && pid) {
                        exec(`taskkill /F /T /PID ${pid}`, (err: any) => {
                            if (err) this.logger.error("TASKKILL_ERROR", { pid, err: err.message });
                        });
                    } else {
                        child.kill('SIGKILL');
                    }
                    reject(new Error(`yt-dlp timeout: Process exceeded ${ENV.DOWNLOAD_TIMEOUT_MS}ms.`));
                }, ENV.DOWNLOAD_TIMEOUT_MS);
            } catch (e: any) {
                reject(e);
            }
        });
    }

    private ensureDir(dir: string) {
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        } catch (e: any) {
            this.logger.error("ENSURE_DIR_FAIL", { dir, err: e.message });
        }
    }

    private getCommonArgs(useBrowser = true): string[] {
        try {
            const args: string[] = [
                '--no-warnings',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ];

            const botCookieDir = path.resolve('data/cookies');
            this.ensureDir(botCookieDir);
            const botCookieFile = path.join(botCookieDir, 'bot_session.txt');

            args.push('--cookies', botCookieFile);

            if (useBrowser && !fs.existsSync(botCookieFile) && ENV.TIKTOK_BROWSER) {
                args.push('--cookies-from-browser', ENV.TIKTOK_BROWSER);
            }
            return args;
        } catch (e: any) {
            this.logger.error("GET_COMMON_ARGS_FAIL", { err: e.message });
            return ['--no-warnings'];
        }
    }

    private async smartYtdlp(args: string[], useBrowser = true, onLine?: (line: string) => void): Promise<string> {
        try {
            const fullArgs = [...args, ...this.getCommonArgs(useBrowser)];
            return await this.ytdlp(fullArgs, onLine);
        } catch (e: any) {
            // Chỉ thực hiện fallback nếu lỗi do khóa database Chrome
            const isDatabaseLocked = e.message.includes('Could not copy Chrome cookie database') || e.message.includes('database is locked');
            if (useBrowser && isDatabaseLocked) {
                this.logger.warn("CHROME_LOCK_DETECTED", { msg: "Retrying WITHOUT browser cookies..." });
                const fallbackArgs = [...args, ...this.getCommonArgs(false)];
                return await this.ytdlp(fallbackArgs, onLine);
            }
            throw e;
        }
    }


    private async getVideoInfo(url: string): Promise<TikTokMetadata | null> {
        try {
            const output = await this.smartYtdlp(['--dump-json', '--no-download', url]);
            const meta = JSON.parse(output.trim().split('\n')[0]);
            return {
                id: meta.id || meta.display_id || Date.now().toString(),
                title: meta.title || meta.description || '',
                uploader: meta.uploader || meta.creator || '',
                tags: meta.tags || [],
                url: meta.url || meta.webpage_url || url,
            };
        } catch (e: any) {
            this.logger.warn("META_FETCH_FAIL", { url, err: e.message.split('\n')[0] });
            return null;
        }
    }

    private async downloadRawVideo(url: string, videoId: string, tmpDir: string): Promise<string | null> {
        try {
            const outputPath = path.join(tmpDir, `tt_raw_${videoId}.mp4`);
            if (fs.existsSync(outputPath)) return outputPath;

            await this.smartYtdlp([
                url,
                '-o', outputPath,
                '--format', 'mp4/best[ext=mp4]/best',
                '--http-chunk-size', '1M',
                '-f', 'bestvideo[vcodec^=h264]+bestaudio/best',
                '--merge-output-format', 'mp4',
            ], true);
            return outputPath;
        } catch (e: any) {
            const errMsg = e.message.split('\n')[0];
            this.logger.error("DOWNLOAD_RAW_FAIL", { videoId, err: errMsg });
            console.error(`    ❌ Lỗi tải video: ${errMsg}`);
            return null;
        }
    }

    private async processSingleVideo(url: string, finalDir: string, tmpDir: string, testUrl?: string): Promise<{ success: boolean, stopSeed: boolean }> {
        let rawPath: string | null = null;
        let dbId: number | null = null;
        let meta: TikTokMetadata | null = null;

        try {
            // 1. Lấy thông tin & Lưu DB
            meta = await this.getVideoInfo(url);
            if (!meta) return { success: false, stopSeed: false };

            const hashtags = meta.tags.map(t => `#${t}`).join(' ');
            dbId = await MysqlStore.saveCrawledVideo('TIKTOK', url, meta.url, meta.title, hashtags, meta.uploader);

            if (!dbId && !testUrl) {
                console.log(`  - Đã có trong DB: ${meta.title}`);
                return { success: false, stopSeed: true };
            }

            // 2. Kiểm tra file sẵn có (Sử dụng tiền tố tt_raw_ mới)
            const possibleFile1 = path.join(finalDir, `tt_raw_${meta.id}.mp4`);
            const possibleFile2 = path.join(finalDir, `tt_raw_${meta.id}_compressed.mp4`);
            if (fs.existsSync(possibleFile1) || fs.existsSync(possibleFile2)) {
                console.log(`  - File đã có sẵn: ${meta.id}`);
                if (dbId) await MysqlStore.saveLocalPath(dbId, fs.existsSync(possibleFile1) ? possibleFile1 : possibleFile2);
                return { success: false, stopSeed: true };
            }

            // 3. Tải & Nén
            rawPath = path.join(tmpDir, `tt_raw_${meta.id}.mp4`);
            console.log(`  >>> Đang tải: ${meta.title}`);

            const downloadedPath = await this.downloadRawVideo(url, meta.id, tmpDir);
            if (downloadedPath && dbId) {
                console.log(`  >>> Đang nén...`);
                const compressedPath = await compressVideoTo5MB(rawPath, finalDir);

                if (compressedPath && fs.existsSync(compressedPath)) {
                    await MysqlStore.saveLocalPath(dbId, compressedPath);
                    console.log(`  ✅ Thành công: ${(fs.statSync(compressedPath).size / 1024 / 1024).toFixed(2)}MB`);
                    return { success: true, stopSeed: false };
                }
            } else {
                console.error(`    ❌ Không thể tiếp tục vì tải video thất bại.`);
            }
            return { success: false, stopSeed: false };
        } catch (err: any) {
            this.logger.error("VIDEO_PROCESS_ERROR", { url, err: err.message });
            console.error(`  ❌ Lỗi xử lý video: ${err.message}`);
            if (dbId && (err.message.includes('exceeds 5MB limit') || err.message.includes('timeout') || err.message.includes('too large'))) {
                await MysqlStore.markVideoFailed(dbId!).catch(() => { });
            }
            return { success: false, stopSeed: false };
        } finally {
            // Dọn dẹp file tạm
            await new Promise(r => setTimeout(r, 1000));
            const idToClean = meta?.id || (rawPath ? path.basename(rawPath, '.mp4').replace('raw_', '') : null);
            if (idToClean) {
                const files = fs.readdirSync(tmpDir);
                for (const file of files) {
                    if (file.includes(idToClean)) {
                        const fullPath = path.join(tmpDir, file);
                        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                    }
                }
            }
        }
    }

    private async scanSeed(seed: string, finalDir: string, tmpDir: string, perSeedLimit: number, currentTotal: number, limit: number, testUrl?: string): Promise<number> {
        try {
            console.log(`\n[NGUỒN] Đang quét: ${seed}`);
            let checkedCount = 0;
            let savedInSeed = 0;

            const output = await this.smartYtdlp([seed, '--flat-playlist', '--get-url', '--playlist-end', perSeedLimit.toString()]);
            if (!output || output.trim().length === 0) {
                console.error(`  [LỖI NGUỒN] Kênh không có video hoặc không tồn tại: ${seed}`);
                return 0;
            }

            const videoUrls = output.trim().split('\n').filter(u => u.startsWith('http'));
            for (const url of videoUrls) {
                checkedCount++;
                console.log(`  [Lượt ${checkedCount}/${perSeedLimit}] Kiểm tra: ${url}`);

                const result = await this.processSingleVideo(url, finalDir, tmpDir, testUrl);
                if (result.success) {
                    savedInSeed++;
                    if (currentTotal + savedInSeed >= limit) break;
                }

                if (checkedCount >= perSeedLimit) {
                    console.log(`  ! Đã đủ ${perSeedLimit} lượt quét cho kênh này.`);
                    break;
                }
            }
            return savedInSeed;
        } catch (e: any) {
            console.error(`  [LỖI NGUỒN] Có lỗi khi quét kênh ${seed}: ${e.message.split('\n')[0]}`);
            return 0;
        }
    }

    public async crawlTikTokVideos(limit = 20, testUrl?: string): Promise<number> {
        try {
            const finalDir = path.resolve(ENV.VIDEO_DOWNLOAD_DIR || 'data/videos/raw');
            const tmpDir = path.resolve('data/videos/tmp');
            this.ensureDir(finalDir);
            this.ensureDir(tmpDir);

            const seedUrls = testUrl ? [testUrl] : (ENV.TIKTOK_SEED_URLS || []);
            if (seedUrls.length === 0) return 0;

            const perSeedLimit = Math.max(10, Math.ceil(limit / seedUrls.length));
            let totalSaved = 0;

            console.log(`\n=== BẮT ĐẦU CÀO VIDEO (Tổng: ${limit} | Kênh: ~${perSeedLimit}) ===`);

            for (const seed of seedUrls) {
                const saved = await this.scanSeed(seed, finalDir, tmpDir, perSeedLimit, totalSaved, limit, testUrl);
                totalSaved += saved;
                if (totalSaved >= limit) break;
            }

            console.log(`\n=== HOÀN TẤT: +${totalSaved} video ===`);
            return totalSaved;
        } catch (e: any) {
            this.logger.error("CRAWL_CRITICAL_ERROR", { err: e.message });
            return 0;
        }
    }
}
