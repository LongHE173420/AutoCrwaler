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
exports.TikTokCrawlService = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MysqlStore_1 = require("../data/MysqlStore");
const env_1 = require("../config/env");
const videoCompressor_1 = require("../utils/videoCompressor");
const YTDLP_CMD = 'yt-dlp';
class TikTokCrawlService {
    constructor(logger) {
        this.logger = logger;
    }
    getBrowserCookieSource() {
        const source = String(env_1.ENV.TIKTOK_BROWSER || "").trim();
        if (!source)
            return null;
        const disabledValues = new Set(["0", "false", "none", "off", "disabled", "no"]);
        return disabledValues.has(source.toLowerCase()) ? null : source;
    }
    ytdlp(args, onLine) {
        return new Promise((resolve, reject) => {
            try {
                const child = (0, child_process_1.execFile)(YTDLP_CMD, args, { maxBuffer: 10 * 1024 * 1024 });
                let stdout = '';
                child.stdout?.on('data', (data) => {
                    const line = data.toString();
                    stdout += line;
                    if (onLine)
                        onLine(line);
                });
                child.stderr?.on('data', (data) => {
                    console.error(`[YTDLP ERROR] ${data}`);
                });
                child.on('close', (code) => {
                    clearTimeout(timeout);
                    if (code === 0)
                        resolve(stdout);
                    else
                        reject(new Error(`yt-dlp exited with code ${code}`));
                });
                const timeout = setTimeout(() => {
                    const pid = child.pid;
                    this.logger.error("YTDLP_TIMEOUT", { pid, timeout: env_1.ENV.DOWNLOAD_TIMEOUT_MS });
                    if (process.platform === 'win32' && pid) {
                        (0, child_process_1.exec)(`taskkill /F /T /PID ${pid}`, (err) => {
                            if (err)
                                this.logger.error("TASKKILL_ERROR", { pid, err: err.message });
                        });
                    }
                    else {
                        child.kill('SIGKILL');
                    }
                    reject(new Error(`yt-dlp timeout: Process exceeded ${env_1.ENV.DOWNLOAD_TIMEOUT_MS}ms.`));
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
    getCommonArgs(useBrowser = true) {
        try {
            const args = [
                '--no-warnings',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ];
            const botCookieDir = path.resolve('data/cookies');
            this.ensureDir(botCookieDir);
            const botCookieFile = path.join(botCookieDir, 'bot_session.txt');
            const browserCookieSource = this.getBrowserCookieSource();
            if (fs.existsSync(botCookieFile)) {
                args.push('--cookies', botCookieFile);
            }
            else if (useBrowser && browserCookieSource) {
                args.push('--cookies-from-browser', browserCookieSource);
            }
            return args;
        }
        catch (e) {
            this.logger.error("GET_COMMON_ARGS_FAIL", { err: e.message });
            return ['--no-warnings'];
        }
    }
    async smartYtdlp(args, useBrowser = true, onLine) {
        try {
            const fullArgs = [...args, ...this.getCommonArgs(useBrowser)];
            return await this.ytdlp(fullArgs, onLine);
        }
        catch (e) {
            // Chỉ thực hiện fallback nếu lỗi do khóa database Chrome
            const isDatabaseLocked = e.message.includes('Could not copy Chrome cookie database') || e.message.includes('database is locked');
            if (useBrowser && isDatabaseLocked && this.getBrowserCookieSource()) {
                this.logger.warn("CHROME_LOCK_DETECTED", { msg: "Retrying WITHOUT browser cookies..." });
                const fallbackArgs = [...args, ...this.getCommonArgs(false)];
                return await this.ytdlp(fallbackArgs, onLine);
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
                uploader: meta.uploader || meta.creator || '',
                tags: meta.tags || [],
                url: meta.url || meta.webpage_url || url,
            };
        }
        catch (e) {
            this.logger.warn("META_FETCH_FAIL", { url, err: e.message.split('\n')[0] });
            return null;
        }
    }
    async downloadRawVideo(url, videoId, tmpDir) {
        try {
            const outputPath = path.join(tmpDir, `tt_raw_${videoId}.mp4`);
            if (fs.existsSync(outputPath))
                return outputPath;
            await this.smartYtdlp([
                url,
                '-o', outputPath,
                '--format', 'mp4/best[ext=mp4]/best',
                '--http-chunk-size', '1M',
                '-f', 'bestvideo[vcodec^=h264]+bestaudio/best',
                '--merge-output-format', 'mp4',
            ], true);
            return outputPath;
        }
        catch (e) {
            const errMsg = e.message.split('\n')[0];
            this.logger.error("DOWNLOAD_RAW_FAIL", { videoId, err: errMsg });
            console.error(`    ❌ Lỗi tải video: ${errMsg}`);
            return null;
        }
    }
    async processSingleVideo(url, finalDir, tmpDir, testUrl) {
        let rawPath = null;
        let dbId = null;
        let meta = null;
        try {
            // 1. Lấy thông tin & Lưu DB
            meta = await this.getVideoInfo(url);
            if (!meta)
                return { success: false, stopSeed: false };
            const hashtags = meta.tags.map(t => `#${t}`).join(' ');
            const dbRecord = await MysqlStore_1.MysqlStore.saveOrGetCrawledVideo('TIKTOK', url, meta.url, meta.title, hashtags, meta.uploader);
            dbId = dbRecord.id;
            if (!dbRecord.inserted && !testUrl) {
                if (dbRecord.postCount >= env_1.ENV.MAX_POSTS_PER_VIDEO) {
                    console.log(`  - DB đã có bản ghi đủ quota post (${dbRecord.postCount}/${env_1.ENV.MAX_POSTS_PER_VIDEO}), bỏ qua: ${meta.title}`);
                    return { success: false, stopSeed: true };
                }
                if (dbRecord.downloaded === 1 && dbRecord.localPath && fs.existsSync(dbRecord.localPath)) {
                    console.log(`  - Đã có trong DB và file còn tồn tại: ${meta.title}`);
                    return { success: false, stopSeed: true };
                }
                const reason = dbRecord.localPath && !fs.existsSync(dbRecord.localPath)
                    ? 'file local đã mất'
                    : `downloaded=${dbRecord.downloaded}`;
                console.log(`  - DB đã có bản ghi nhưng chưa có file hợp lệ (${reason}), tải lại: ${meta.title}`);
            }
            // 2. Kiểm tra file sẵn có (Sử dụng tiền tố tt_raw_ mới)
            const possibleFile1 = path.join(finalDir, `tt_raw_${meta.id}.mp4`);
            const possibleFile2 = path.join(finalDir, `tt_raw_${meta.id}_compressed.mp4`);
            if (fs.existsSync(possibleFile1) || fs.existsSync(possibleFile2)) {
                console.log(`  - File đã có sẵn: ${meta.id}`);
                if (dbId)
                    await MysqlStore_1.MysqlStore.saveLocalPath(dbId, fs.existsSync(possibleFile1) ? possibleFile1 : possibleFile2);
                return { success: false, stopSeed: true };
            }
            // 3. Tải & Nén
            rawPath = path.join(tmpDir, `tt_raw_${meta.id}.mp4`);
            console.log(`  >>> Đang tải: ${meta.title}`);
            const downloadedPath = await this.downloadRawVideo(url, meta.id, tmpDir);
            if (downloadedPath && dbId) {
                console.log(`  >>> Đang nén...`);
                const compressedPath = await (0, videoCompressor_1.compressVideoTo5MB)(rawPath, finalDir);
                if (compressedPath && fs.existsSync(compressedPath)) {
                    await MysqlStore_1.MysqlStore.saveLocalPath(dbId, compressedPath);
                    console.log(`  ✅ Thành công: ${(fs.statSync(compressedPath).size / 1024 / 1024).toFixed(2)}MB`);
                    return { success: true, stopSeed: false };
                }
            }
            else {
                console.error(`    ❌ Không thể tiếp tục vì tải video thất bại.`);
                if (dbId)
                    await MysqlStore_1.MysqlStore.markVideoFailed(dbId).catch(() => { });
            }
            return { success: false, stopSeed: false };
        }
        catch (err) {
            this.logger.error("VIDEO_PROCESS_ERROR", { url, err: err.message });
            console.error(`  ❌ Lỗi xử lý video: ${err.message}`);
            if (dbId && (err.message.includes('exceeds 5MB limit') || err.message.includes('timeout') || err.message.includes('too large'))) {
                await MysqlStore_1.MysqlStore.markVideoFailed(dbId).catch(() => { });
            }
            return { success: false, stopSeed: false };
        }
        finally {
            // Dọn dẹp file tạm
            await new Promise(r => setTimeout(r, 1000));
            const idToClean = meta?.id || (rawPath ? path.basename(rawPath, '.mp4').replace('raw_', '') : null);
            if (idToClean) {
                const files = fs.readdirSync(tmpDir);
                for (const file of files) {
                    if (file.includes(idToClean)) {
                        const fullPath = path.join(tmpDir, file);
                        if (fs.existsSync(fullPath))
                            fs.unlinkSync(fullPath);
                    }
                }
            }
        }
    }
    async scanSeed(seed, finalDir, tmpDir, perSeedLimit, currentTotal, limit) {
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
                const result = await this.processSingleVideo(url, finalDir, tmpDir);
                if (result.success) {
                    savedInSeed++;
                    if (currentTotal + savedInSeed >= limit)
                        break;
                }
                if (checkedCount >= perSeedLimit) {
                    console.log(`  ! Đã đủ ${perSeedLimit} lượt quét cho kênh này.`);
                    break;
                }
            }
            return savedInSeed;
        }
        catch (e) {
            console.error(`  [LỖI NGUỒN] Có lỗi khi quét kênh ${seed}: ${e.message.split('\n')[0]}`);
            return 0;
        }
    }
    async crawlTikTokVideos(limit = 20, seedUrl) {
        try {
            const finalDir = path.resolve(env_1.ENV.VIDEO_DOWNLOAD_DIR || 'data/videos/raw');
            const tmpDir = path.resolve('data/videos/tmp');
            this.ensureDir(finalDir);
            this.ensureDir(tmpDir);
            // Nếu được truyền seedUrl (từ worker), chỉ crawl đúng 1 seed đó.
            // Nếu không, lấy toàn bộ từ ENV (dùng khi chạy standalone).
            const seedUrls = seedUrl ? [seedUrl] : (env_1.ENV.TIKTOK_SEED_URLS || []);
            if (seedUrls.length === 0)
                return 0;
            const perSeedLimit = limit; // Mỗi worker đã được chia limit rồi, dùng hết
            let totalSaved = 0;
            console.log(`\n=== BẮT ĐẦU CÀO VIDEO [${seedUrl || 'ALL'}] (Limit: ${limit}) ===`);
            for (const seed of seedUrls) {
                const saved = await this.scanSeed(seed, finalDir, tmpDir, perSeedLimit, totalSaved, limit);
                totalSaved += saved;
                if (totalSaved >= limit)
                    break;
            }
            console.log(`\n=== HOÀN TẤT [${seedUrl || 'ALL'}]: +${totalSaved} video ===`);
            return totalSaved;
        }
        catch (e) {
            this.logger.error("CRAWL_CRITICAL_ERROR", { err: e.message });
            return 0;
        }
    }
}
exports.TikTokCrawlService = TikTokCrawlService;
