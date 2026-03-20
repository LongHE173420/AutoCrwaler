import { TikTokCrawlService } from '../service/TikTokCrawlService';
import { FacebookCrawlService } from '../service/FacebookCrawlService';
import { MysqlStore } from '../data/MysqlStore';
import { ENV } from '../config/env';
import { Log } from '../utils/log';

export class CrawlerWorker {
    private logger = Log.getLogger('CrawlerWorker');
    private crawlService: TikTokCrawlService;
    private fbCrawlService: FacebookCrawlService;
    private crawlRunning = false;

    constructor() {
        try {
            const logger = Log.getLogger('TikTokCrawl');
            this.crawlService = new TikTokCrawlService(logger);
            this.fbCrawlService = new FacebookCrawlService(Log.getLogger('FBCrawl'));
        } catch (e: any) {
            const logger = Log.getLogger('CrawlerWorker');
            logger.error("CONSTRUCTOR_FAIL", { err: e.message });
            this.crawlService = null!;
            this.fbCrawlService = null!;
        }
    }

    private async runCrawl() {
        if (this.crawlRunning) return;
        this.crawlRunning = true;
        try {
            console.log(`\n[${new Date().toLocaleString()}] --- BẮT ĐẦU CHU KỲ CRAWL MỚI ---`);


            const cleaned = await MysqlStore.cleanupFullyPostedVideos();
            if (cleaned > 0) console.log(`  * Đã dọn dẹp ${cleaned} video cũ.`);

            let tiktokCount = 0;
            if (ENV.CRAWL_TIKTOK_ENABLED) {
                this.logger.info("CRAWL_TIKTOK_START", { limit: ENV.CRAWL_LIMIT });
                tiktokCount = await this.crawlService.crawlTikTokVideos(ENV.CRAWL_LIMIT || 20);
                this.logger.info("CRAWL_TIKTOK_COMPLETE", { savedCount: tiktokCount });
            } else {
                this.logger.warn("CRAWL_TIKTOK_DISABLED_BY_CONFIG");
            }

            /* 
            // 3. Crawl Facebook (Tạm thời vô hiệu hóa theo yêu cầu)
            this.logger.info("CRAWL_FACEBOOK_START", { limit: ENV.CRAWL_LIMIT });
            const fbCount = await this.fbCrawlService.crawlFacebookVideos(ENV.CRAWL_LIMIT || 20);
            this.logger.info("CRAWL_FACEBOOK_COMPLETE", { savedCount: fbCount });
            */

            console.log(`\n[${new Date().toLocaleString()}] --- HOÀN TẤT CHU KỲ ---`);
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
            this.runCrawl();

            const crawlInterval = ENV.CRAWL_INTERVAL_MS || 30 * 60 * 1000;
            setInterval(() => this.runCrawl(), crawlInterval);

            const cleanupInterval = 60 * 60 * 1000;
            setInterval(() => this.runCleanup(), cleanupInterval);

            this.logger.info("CRAWLER_WORKER_STARTED", {
                crawlInterval: crawlInterval / 1000,
                cleanupInterval: cleanupInterval / 1000
            });
        } catch (e: any) {
            this.logger.error("CRAWLER_WORKER_START_FAIL", { err: e.message });
        }
    }
}
