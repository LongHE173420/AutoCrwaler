"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrawlerWorker = void 0;
const TikTokCrawlService_1 = require("../service/TikTokCrawlService");
const FacebookCrawlService_1 = require("../service/FacebookCrawlService");
const MysqlStore_1 = require("../data/MysqlStore");
const env_1 = require("../config/env");
const log_1 = require("../utils/log");
class CrawlerWorker {
    constructor(seedUrl, limit) {
        this.crawlRunning = false;
        this.seedUrl = seedUrl;
        this.limit = limit;
        const channelName = seedUrl.split('/').pop() || seedUrl;
        this.logger = log_1.Log.getLogger(`Worker-${channelName}`);
        try {
            this.crawlService = new TikTokCrawlService_1.TikTokCrawlService(log_1.Log.getLogger('TikTokCrawl'));
            this.fbCrawlService = new FacebookCrawlService_1.FacebookCrawlService(log_1.Log.getLogger('FBCrawl'));
        }
        catch (e) {
            this.logger.error("CONSTRUCTOR_FAIL", { err: e.message });
            this.crawlService = null;
            this.fbCrawlService = null;
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async runCrawl() {
        if (this.crawlRunning) {
            this.logger.warn("CRAWL_SKIPPED_ALREADY_RUNNING", { seedUrl: this.seedUrl });
            return;
        }
        this.crawlRunning = true;
        try {
            console.log(`\n[${new Date().toLocaleString()}] [${this.seedUrl}] --- CRAWL CYCLE START ---`);
            const cleanup = await MysqlStore_1.MysqlStore.cleanupFullyPostedVideos();
            if (cleanup.rowsFound > 0 || cleanup.rowsReset > 0) {
                console.log(`  * Cleanup: found=${cleanup.rowsFound} deleted=${cleanup.filesDeleted} missing=${cleanup.filesMissing} reset=${cleanup.rowsReset}.`);
            }
            let tiktokCount = 0;
            if (env_1.ENV.CRAWL_TIKTOK_ENABLED) {
                this.logger.info("CRAWL_TIKTOK_START", { seedUrl: this.seedUrl, limit: this.limit });
                tiktokCount = await this.crawlService.crawlTikTokVideos(this.limit, this.seedUrl);
                this.logger.info("CRAWL_TIKTOK_COMPLETE", { seedUrl: this.seedUrl, savedCount: tiktokCount });
            }
            else {
                this.logger.warn("CRAWL_TIKTOK_DISABLED_BY_CONFIG");
            }
            console.log(`\n[${new Date().toLocaleString()}] [${this.seedUrl}] --- CRAWL CYCLE DONE (+${tiktokCount} video) ---`);
        }
        catch (e) {
            this.logger.error("CRAWL_ERROR", { err: e.message });
        }
        finally {
            this.crawlRunning = false;
        }
    }
    startCrawlLoop(crawlInterval) {
        void (async () => {
            while (true) {
                await this.runCrawl();
                await this.sleep(crawlInterval);
            }
        })();
    }
    async runCleanup() {
        try {
            const cleanup = await MysqlStore_1.MysqlStore.cleanupFullyPostedVideos();
            if (cleanup.rowsFound > 0 || cleanup.rowsReset > 0) {
                this.logger.info("CLEANUP_SUCCESS", cleanup);
            }
        }
        catch (e) {
            this.logger.error("CLEANUP_ERROR", { err: e.message });
        }
    }
    async start() {
        try {
            await MysqlStore_1.MysqlStore.initCrawlTables();
            if (!env_1.ENV.CRAWL_TIKTOK_ENABLED) {
                this.logger.warn("CRAWL_DISABLED_BY_CONFIG");
                return;
            }
            await this.runCleanup();
            const crawlInterval = env_1.ENV.CRAWL_INTERVAL_MS || 30 * 60 * 1000;
            this.startCrawlLoop(crawlInterval);
            const cleanupInterval = 60 * 60 * 1000;
            setInterval(() => this.runCleanup(), cleanupInterval);
            this.logger.info("CRAWLER_WORKER_STARTED", {
                seedUrl: this.seedUrl,
                limit: this.limit,
                crawlIntervalSec: crawlInterval / 1000,
                cleanupIntervalSec: cleanupInterval / 1000
            });
        }
        catch (e) {
            this.logger.error("CRAWLER_WORKER_START_FAIL", { err: e.message });
        }
    }
}
exports.CrawlerWorker = CrawlerWorker;
