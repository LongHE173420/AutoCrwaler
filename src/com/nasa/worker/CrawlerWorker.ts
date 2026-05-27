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

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async runCrawl() {
        if (this.crawlRunning) {
            this.logger.warn("CRAWL_SKIPPED_ALREADY_RUNNING", { seedUrl: this.seedUrl });
            return;
        }
        this.crawlRunning = true;
        try {
            console.log(`\n[${new Date().toLocaleString()}] [${this.seedUrl}] --- CRAWL CYCLE START ---`);

            const cleanup = await MysqlStore.cleanupFullyPostedVideos();
            if (cleanup.rowsFound > 0 || cleanup.rowsReset > 0) {
                console.log(
                    `  * Cleanup: found=${cleanup.rowsFound} deleted=${cleanup.filesDeleted} missing=${cleanup.filesMissing} reset=${cleanup.rowsReset}.`
                );
            }

            let tiktokCount = 0;
            if (ENV.CRAWL_TIKTOK_ENABLED) {
                this.logger.info("CRAWL_TIKTOK_START", { seedUrl: this.seedUrl, limit: this.limit });
                tiktokCount = await this.crawlService.crawlTikTokVideos(this.limit, this.seedUrl);
                this.logger.info("CRAWL_TIKTOK_COMPLETE", { seedUrl: this.seedUrl, savedCount: tiktokCount });
            } else {
                this.logger.warn("CRAWL_TIKTOK_DISABLED_BY_CONFIG");
            }

            console.log(`\n[${new Date().toLocaleString()}] [${this.seedUrl}] --- CRAWL CYCLE DONE (+${tiktokCount} video) ---`);
        } catch (e: any) {
            this.logger.error("CRAWL_ERROR", { err: e.message });
        } finally {
            this.crawlRunning = false;
        }
    }

    private startCrawlLoop(crawlInterval: number) {
        void (async () => {
            while (true) {
                await this.runCrawl();
                await this.sleep(crawlInterval);
            }
        })();
    }

    private async runCleanup() {
        try {
            const cleanup = await MysqlStore.cleanupFullyPostedVideos();
            if (cleanup.rowsFound > 0 || cleanup.rowsReset > 0) {
                this.logger.info("CLEANUP_SUCCESS", cleanup);
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

            const crawlInterval = ENV.CRAWL_INTERVAL_MS || 30 * 60 * 1000;
            this.startCrawlLoop(crawlInterval);

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
