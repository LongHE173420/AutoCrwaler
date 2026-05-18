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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookCrawlService = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MysqlStore_1 = require("../data/MysqlStore");
const env_1 = require("../config/env");
const videoCompressor_1 = require("../utils/videoCompressor");
const YTDLP_CMD = 'yt-dlp';
class FacebookCrawlService {
    constructor(logger) {
        this.logger = logger;
    }
    ytdlp(args) {
        return new Promise((resolve, reject) => {
            try {
                const child = (0, child_process_1.execFile)(YTDLP_CMD, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
                    clearTimeout(timeout);
                    if (err)
                        return reject(new Error(stderr || err.message));
                    resolve(stdout);
                });
                const timeout = setTimeout(() => {
                    const pid = child.pid;
                    this.logger.error("FB_YTDLP_TIMEOUT", { pid, timeout: env_1.ENV.DOWNLOAD_TIMEOUT_MS });
                    if (process.platform === 'win32' && pid) {
                        (0, child_process_1.exec)(`taskkill /F /T /PID ${pid}`, (err) => {
                            if (err)
                                this.logger.error("TASKKILL_ERROR", { pid, err: err.message });
                        });
                    }
                    else {
                        child.kill('SIGKILL');
                    }
                    reject(new Error(`yt-dlp FB timeout: Process exceeded ${env_1.ENV.DOWNLOAD_TIMEOUT_MS}ms.`));
                }, env_1.ENV.DOWNLOAD_TIMEOUT_MS);
            }
            catch (e) {
                reject(e);
            }
        });
    }
    ensureDir(dir) {
        try {
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
        }
        catch (e) {
            this.logger.error("ENSURE_DIR_FAIL", { dir, err: e.message });
        }
    }
    getCommonArgs() {
        try {
            const args = [
                '--no-warnings',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ];
            if (env_1.ENV.TIKTOK_BROWSER) {
                args.push('--cookies-from-browser', env_1.ENV.TIKTOK_BROWSER);
            }
            return args;
        }
        catch (e) {
            this.logger.error("GET_FB_COMMON_ARGS_FAIL", { err: e.message });
            return ['--no-warnings'];
        }
    }
    async smartYtdlp(args) {
        try {
            const fullArgs = [...args, ...this.getCommonArgs()];
            return await this.ytdlp(fullArgs);
        }
        catch (e) {
            if (e.message.includes("Could not copy Chrome cookie database")) {
                this.logger.warn("FB_YTDLP_COOKIE_LOCKED", { msg: "Retrying without cookies..." });
                const noCookieArgs = [...args, '--no-warnings'];
                return await this.ytdlp(noCookieArgs);
            }
            throw e;
        }
    }
    async getVideoInfo(url) {
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
        }
        catch (e) {
            this.logger.warn("FB_META_FETCH_FAIL", { url, err: e.message.split('\n')[0] });
            return null;
        }
    }
    async downloadRawVideo(url, videoId, tmpDir) {
        try {
            const outputPath = path.join(tmpDir, `fb_raw_${videoId}.mp4`);
            if (fs.existsSync(outputPath))
                return outputPath;
            await this.smartYtdlp([
                url,
                '-o', outputPath,
                '--format', 'mp4/best[ext=mp4]/best',
                '--merge-output-format', 'mp4',
            ]);
            return outputPath;
        }
        catch (e) {
            this.logger.error("FB_DOWNLOAD_RAW_FAIL", { videoId, err: e.message.split('\n')[0] });
            return null;
        }
    }
    async processSingleVideo(url, finalDir, tmpDir) {
        let rawPath = null;
        let dbId = null;
        let meta = null;
        try {
            meta = await this.getVideoInfo(url);
            if (!meta)
                return { success: false, stopSeed: false };
            const hashtags = meta.tags.map(t => `#${t}`).join(' ');
            dbId = await MysqlStore_1.MysqlStore.saveCrawledVideo('FACEBOOK', url, meta.url, meta.title, hashtags, meta.uploader);
            if (!dbId) {
                console.log(`  - FB: Đã có trong DB: ${meta.title.substring(0, 30)}...`);
                return { success: false, stopSeed: true };
            }
            const possibleFile = path.join(finalDir, `fb_raw_${meta.id}_compressed.mp4`);
            if (fs.existsSync(possibleFile)) {
                console.log(`  - FB: File đã có sẵn: ${meta.id}`);
                await MysqlStore_1.MysqlStore.saveLocalPath(dbId, possibleFile);
                return { success: false, stopSeed: true };
            }
            rawPath = path.join(tmpDir, `fb_raw_${meta.id}.mp4`);
            console.log(`  >>> FB Đang tải: ${meta.title.substring(0, 40)}...`);
            const downloadedPath = await this.downloadRawVideo(url, meta.id, tmpDir);
            if (downloadedPath && dbId) {
                console.log(`  >>> FB Đang nén...`);
                const compressedPath = await (0, videoCompressor_1.compressVideoTo5MB)(downloadedPath, finalDir);
                if (compressedPath && fs.existsSync(compressedPath)) {
                    await MysqlStore_1.MysqlStore.saveLocalPath(dbId, compressedPath);
                    console.log(`  ✅ FB Thành công: ${(fs.statSync(compressedPath).size / 1024 / 1024).toFixed(2)}MB`);
                    return { success: true, stopSeed: false };
                }
            }
            return { success: false, stopSeed: false };
        }
        catch (err) {
            this.logger.error("FB_VIDEO_PROCESS_ERROR", { url, err: err.message });
            if (dbId && (err.message.includes('exceeds 5MB limit') || err.message.includes('timeout'))) {
                await MysqlStore_1.MysqlStore.markVideoFailed(dbId).catch(() => { });
            }
            return { success: false, stopSeed: false };
        }
        finally {
            if (rawPath && fs.existsSync(rawPath)) {
                try {
                    fs.unlinkSync(rawPath);
                }
                catch { }
            }
        }
    }
    async scanSeed(seed, finalDir, tmpDir, perSeedLimit, currentTotal, globalLimit) {
        try {
            let savedInSeed = 0;
            let checkedCount = 0;
            let cleanSeed = seed.trim();
            if (cleanSeed.endsWith('/'))
                cleanSeed = cleanSeed.slice(0, -1);
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
                    if (output && output.trim().length > 0)
                        break;
                }
                catch (e) {
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
                    if (currentTotal + savedInSeed >= globalLimit)
                        break;
                }
                if (result.stopSeed || checkedCount >= perSeedLimit)
                    break;
            }
            return savedInSeed;
        }
        catch (e) {
            console.error(`  [FB LỖI NGUỒN] ${seed}: ${e.message.split('\n')[0]}`);
            return 0;
        }
    }
    async crawlFacebookVideos(limit = 20, testUrl) {
        try {
            const finalDir = path.resolve(env_1.ENV.VIDEO_DOWNLOAD_DIR || 'data/videos/raw');
            const tmpDir = path.resolve('data/videos/tmp');
            this.ensureDir(finalDir);
            this.ensureDir(tmpDir);
            const seedUrls = testUrl ? [testUrl] : (env_1.ENV.FB_SEED_URLS || []);
            if (seedUrls.length === 0)
                return 0;
            const perSeedLimit = Math.max(1, Math.floor(limit / seedUrls.length));
            let totalSaved = 0;
            console.log(`\n=== START CRAWL FACEBOOK (Tổng: ${limit}) ===`);
            for (const seed of seedUrls) {
                const saved = await this.scanSeed(seed, finalDir, tmpDir, perSeedLimit, totalSaved, limit);
                totalSaved += saved;
                if (totalSaved >= limit)
                    break;
            }
            console.log(`\n=== FB HOÀN TẤT: +${totalSaved} video ===`);
            return totalSaved;
        }
        catch (e) {
            this.logger.error("FB_CRAWL_CRITICAL_ERROR", { err: e.message });
            return 0;
        }
    }
}
exports.FacebookCrawlService = FacebookCrawlService;
