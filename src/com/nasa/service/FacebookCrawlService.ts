import { execFile, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MysqlStore } from '../data/MysqlStore';
import { ENV } from '../config/env';
import { Log } from '../utils/log';
import { compressVideoTo5MB } from '../utils/videoCompressor';

const YTDLP_CMD = 'yt-dlp';

interface FBMetadata {
    id: string;
    title: string;
    uploader: string;
    tags: string[];
    url: string;
}

type AppLogger = ReturnType<typeof Log.getLogger>;

export class FacebookCrawlService {
    constructor(private logger: AppLogger) { }

    private ytdlp(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const child = execFile(YTDLP_CMD, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
                    clearTimeout(timeout);
                    if (err) return reject(new Error(stderr || err.message));
                    resolve(stdout);
                });

                const timeout = setTimeout(() => {
                    const pid = child.pid;
                    this.logger.error("FB_YTDLP_TIMEOUT", { pid, timeout: ENV.DOWNLOAD_TIMEOUT_MS });
                    if (process.platform === 'win32' && pid) {
                        exec(`taskkill /F /T /PID ${pid}`, (err: any) => {
                            if (err) this.logger.error("TASKKILL_ERROR", { pid, err: err.message });
                        });
                    } else {
                        child.kill('SIGKILL');
                    }
                    reject(new Error(`yt-dlp FB timeout: Process exceeded ${ENV.DOWNLOAD_TIMEOUT_MS}ms.`));
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

    private getCommonArgs(): string[] {
        try {
            const args: string[] = [
                '--no-warnings',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ];
            if (ENV.TIKTOK_BROWSER) {
                args.push('--cookies-from-browser', ENV.TIKTOK_BROWSER);
            }
            return args;
        } catch (e: any) {
            this.logger.error("GET_FB_COMMON_ARGS_FAIL", { err: e.message });
            return ['--no-warnings'];
        }
    }

    private async smartYtdlp(args: string[]): Promise<string> {
        try {
            const fullArgs = [...args, ...this.getCommonArgs()];
            return await this.ytdlp(fullArgs);
        } catch (e: any) {
            if (e.message.includes("Could not copy Chrome cookie database")) {
                this.logger.warn("FB_YTDLP_COOKIE_LOCKED", { msg: "Retrying without cookies..." });
                const noCookieArgs = [...args, '--no-warnings'];
                return await this.ytdlp(noCookieArgs);
            }
            throw e;
        }
    }

    private async getVideoInfo(url: string): Promise<FBMetadata | null> {
        try {
            const output = await this.smartYtdlp(['--dump-json', '--no-download', url]);
            const meta = JSON.parse(output.trim().split('\n')[0]);
            return {
                id: meta.id || meta.display_id || Date.now().toString(),
                title: meta.title || meta.description || '',
                uploader: meta.uploader || meta.webpage_url_domain || 'Facebook',
                tags: meta.tags || [],
                url: meta.url || meta.webpage_url || url
            };
        } catch (e: any) {
            this.logger.warn("FB_META_FETCH_FAIL", { url, err: e.message.split('\n')[0] });
            return null;
        }
    }

    private async downloadRawVideo(url: string, videoId: string, tmpDir: string): Promise<string | null> {
        try {
            const outputPath = path.join(tmpDir, `fb_raw_${videoId}.mp4`);
            if (fs.existsSync(outputPath)) return outputPath;

            await this.smartYtdlp([
                url,
                '-o', outputPath,
                '--format', 'mp4/best[ext=mp4]/best',
                '--merge-output-format', 'mp4',
            ]);
            return outputPath;
        } catch (e: any) {
            this.logger.error("FB_DOWNLOAD_RAW_FAIL", { videoId, err: e.message.split('\n')[0] });
            return null;
        }
    }

    private async processSingleVideo(url: string, finalDir: string, tmpDir: string): Promise<{ success: boolean, stopSeed: boolean }> {
        let rawPath: string | null = null;
        let dbId: number | null = null;
        let meta: FBMetadata | null = null;

        try {
            meta = await this.getVideoInfo(url);
            if (!meta) return { success: false, stopSeed: false };

            const hashtags = meta.tags.map(t => `#${t}`).join(' ');
            dbId = await MysqlStore.saveCrawledVideo('FACEBOOK', url, meta.url, meta.title, hashtags, meta.uploader);

            if (!dbId) {
                console.log(`  - FB: Đã có trong DB: ${meta.title.substring(0, 30)}...`);
                return { success: false, stopSeed: true };
            }

            const possibleFile = path.join(finalDir, `fb_raw_${meta.id}_compressed.mp4`);
            if (fs.existsSync(possibleFile)) {
                console.log(`  - FB: File đã có sẵn: ${meta.id}`);
                await MysqlStore.saveLocalPath(dbId, possibleFile);
                return { success: false, stopSeed: true };
            }

            rawPath = path.join(tmpDir, `fb_raw_${meta.id}.mp4`);
            console.log(`  >>> FB Đang tải: ${meta.title.substring(0, 40)}...`);

            const downloadedPath = await this.downloadRawVideo(url, meta.id, tmpDir);
            if (downloadedPath && dbId) {
                console.log(`  >>> FB Đang nén...`);
                const compressedPath = await compressVideoTo5MB(downloadedPath, finalDir);

                if (compressedPath && fs.existsSync(compressedPath)) {
                    await MysqlStore.saveLocalPath(dbId, compressedPath);
                    console.log(`  ✅ FB Thành công: ${(fs.statSync(compressedPath).size / 1024 / 1024).toFixed(2)}MB`);
                    return { success: true, stopSeed: false };
                }
            }
            return { success: false, stopSeed: false };
        } catch (err: any) {
            this.logger.error("FB_VIDEO_PROCESS_ERROR", { url, err: err.message });
            if (dbId && (err.message.includes('exceeds 5MB limit') || err.message.includes('timeout'))) {
                await MysqlStore.markVideoFailed(dbId!).catch(() => { });
            }
            return { success: false, stopSeed: false };
        } finally {
            if (rawPath && fs.existsSync(rawPath)) {
                try { fs.unlinkSync(rawPath); } catch { }
            }
        }
    }

    private async scanSeed(seed: string, finalDir: string, tmpDir: string, perSeedLimit: number, currentTotal: number, globalLimit: number): Promise<number> {
        try {
            let savedInSeed = 0;
            let checkedCount = 0;

            let cleanSeed = seed.trim();
            if (cleanSeed.endsWith('/')) cleanSeed = cleanSeed.slice(0, -1);

            console.log(`\n--- Quét nguồn FB: ${cleanSeed} ---`);

            const isDirectVideo = (cleanSeed.includes('watch') && cleanSeed.includes('v=')) ||
                cleanSeed.includes('fb.watch') ||
                (cleanSeed.includes('/videos/') && cleanSeed.split('/videos/')[1].match(/^\d+/)) ||
                (cleanSeed.includes('/reels/') && cleanSeed.split('/reels/')[1].match(/^\d+/));

            if (isDirectVideo) {
                console.log(`  [FB] Nhận diện link video trực tiếp. Đang xử lý...`);
                const result = await this.processSingleVideo(cleanSeed, finalDir, tmpDir);
                return result.success ? 1 : 0;
            }

            const tryUrls = [
                cleanSeed,
                cleanSeed.replace('www.facebook.com', 'mbasic.facebook.com'),
                cleanSeed.replace('www.facebook.com', 'facebook.com')
            ];

            let output = '';
            for (const tryUrl of tryUrls) {
                try {
                    output = await this.smartYtdlp([tryUrl, '--flat-playlist', '--print', 'webpage_url', '--playlist-end', '10']);
                    if (output && output.trim().length > 0) break;
                } catch (e) {

                }
            }
            if (!output || output.trim().length === 0) {
                console.error(`  [FB LỖI] Không lấy được danh sách video từ: ${seed}`);
                return 0;
            }

            const videoUrls = output.trim().split('\n').filter(u => u.includes('facebook.com') || u.includes('fb.watch'));
            for (const url of videoUrls) {
                checkedCount++;
                console.log(`  [FB Lượt ${checkedCount}/${perSeedLimit}] Kiểm tra: ${url.substring(0, 50)}...`);

                const result = await this.processSingleVideo(url, finalDir, tmpDir);
                if (result.success) {
                    savedInSeed++;
                    if (currentTotal + savedInSeed >= globalLimit) break;
                }
                if (result.stopSeed || checkedCount >= perSeedLimit) break;
            }
            return savedInSeed;
        } catch (e: any) {
            console.error(`  [FB LỖI NGUỒN] ${seed}: ${e.message.split('\n')[0]}`);
            return 0;
        }
    }

    public async crawlFacebookVideos(limit = 20, testUrl?: string): Promise<number> {
        try {
            const finalDir = path.resolve(ENV.VIDEO_DOWNLOAD_DIR || 'data/videos/raw');
            const tmpDir = path.resolve('data/videos/tmp');
            this.ensureDir(finalDir);
            this.ensureDir(tmpDir);

            const seedUrls = testUrl ? [testUrl] : (ENV.FB_SEED_URLS || []);
            if (seedUrls.length === 0) return 0;

            const perSeedLimit = Math.max(1, Math.floor(limit / seedUrls.length));
            let totalSaved = 0;

            console.log(`\n=== START CRAWL FACEBOOK (Tổng: ${limit}) ===`);

            for (const seed of seedUrls) {
                const saved = await this.scanSeed(seed, finalDir, tmpDir, perSeedLimit, totalSaved, limit);
                totalSaved += saved;
                if (totalSaved >= limit) break;
            }

            console.log(`\n=== FB HOÀN TẤT: +${totalSaved} video ===`);
            return totalSaved;
        } catch (e: any) {
            this.logger.error("FB_CRAWL_CRITICAL_ERROR", { err: e.message });
            return 0;
        }
    }
}
