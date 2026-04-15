import { TikTokCrawlService } from '../service/TikTokCrawlService';
import { FacebookCrawlService } from '../service/FacebookCrawlService';
import { MysqlStore } from '../data/MysqlStore';
import { ENV } from '../config/env';
import { Log } from '../utils/log';

export class CrawlerWorker {
    private logger;
    private crawlService: TikTokCrawlService;
    private fbCrawlService: FacebookCrawlService;
    private crawlRunning = false;
    private seedUrl: string;
    private limit: number;

    constructor(seedUrl: string, limit: number) {
        this.seedUrl = seedUrl;
        this.limit = limit;

        const channelName = seedUrl.split('/').pop() || seedUrl;
        this.logger = Log.getLogger(`Worker-${channelName}`);

        try {
            this.crawlService = new TikTokCrawlService(Log.getLogger('TikTokCrawl'));
            this.fbCrawlService = new FacebookCrawlService(Log.getLogger('FBCrawl'));
        } catch (e: any) {
            this.logger.error("CONSTRUCTOR_FAIL", { err: e.message });
            this.crawlService = null!;
            this.fbCrawlService = null!;
        }
    }

    private async runCrawl() {
        if (this.crawlRunning) return;
        this.crawlRunning = true;
        try {
            console.log(`\n[${new Date().toLocaleString()}] [${this.seedUrl}] --- BẮT ĐẦU CHU KỲ CRAWL ---`);

            const cleaned = await MysqlStore.cleanupFullyPostedVideos();
            if (cleaned > 0) console.log(`  * Đã dọn dẹp ${cleaned} video cũ.`);

            let tiktokCount = 0;
            if (ENV.CRAWL_TIKTOK_ENABLED) {
                this.logger.info("CRAWL_TIKTOK_START", { seedUrl: this.seedUrl, limit: this.limit });
                // Mỗi worker chỉ crawl seedUrl được giao với đúng limit được phân chia
                tiktokCount = await this.crawlService.crawlTikTokVideos(this.limit, this.seedUrl);
                this.logger.info("CRAWL_TIKTOK_COMPLETE", { seedUrl: this.seedUrl, savedCount: tiktokCount });
            } else {
                this.logger.warn("CRAWL_TIKTOK_DISABLED_BY_CONFIG");
            }

            /* 
            // Crawl Facebook (Tạm thời vô hiệu hóa)
            const fbCount = await this.fbCrawlService.crawlFacebookVideos(this.limit);
            */

            console.log(`\n[${new Date().toLocaleString()}] [${this.seedUrl}] --- HOÀN TẤT CHU KỲ (+${tiktokCount} video) ---`);
        } catch (e: any) {
            this.logger.error("CRAWL_ERROR", { err: e.message });
        } finally {
            this.crawlRunning = false;
        }
    }

    private async runCleanup() {
        try {
            const deleted = await MysqlStore.cleanupFullyPostedVideos();
            if (deleted > 0) {
                this.logger.info("CLEANUP_SUCCESS", { deletedFiles: deleted });
            }
        } catch (e: any) {
            this.logger.error("CLEANUP_ERROR", { err: e.message });
        }
    }

    public async start() {
        try {
            await MysqlStore.initCrawlTables();

            if (!ENV.CRAWL_TIKTOK_ENABLED) {
                this.logger.warn("CRAWL_DISABLED_BY_CONFIG");
                return;
            }

            await this.runCleanup();
            this.runCrawl(); // Fire and forget — không block, để interval quản lý

            const crawlInterval = ENV.CRAWL_INTERVAL_MS || 30 * 60 * 1000;
            setInterval(() => this.runCrawl(), crawlInterval);

            const cleanupInterval = 60 * 60 * 1000;
            setInterval(() => this.runCleanup(), cleanupInterval);

            this.logger.info("CRAWLER_WORKER_STARTED", {
                seedUrl: this.seedUrl,
                limit: this.limit,
                crawlIntervalSec: crawlInterval / 1000,
                cleanupIntervalSec: cleanupInterval / 1000
            });
        } catch (e: any) {
            this.logger.error("CRAWLER_WORKER_START_FAIL", { err: e.message });
        }
    }
}
