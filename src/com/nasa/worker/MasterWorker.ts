import { ENV } from '../config/env';
import { Log } from '../utils/log';
import { CrawlerWorker } from './CrawlerWorker';

export class MasterWorker {
    private logger = Log.getLogger('MasterWorker');
    private workers: CrawlerWorker[] = [];

    public async start() {
        this.logger.info("MASTER_WORKER_STARTING", {
            enabled: ENV.CRAWL_TIKTOK_ENABLED,
            seedsCount: ENV.TIKTOK_SEED_URLS.length
        });

        if (!ENV.CRAWL_TIKTOK_ENABLED) {
            this.logger.warn("CRAWL_DISABLED_BY_CONFIG");
            return;
        }

        const seeds = ENV.TIKTOK_SEED_URLS || [];
        for (const seed of seeds) {
            this.spawnWorker(seed);
        }
    }

    private spawnWorker(seedUrl: string) {
        try {
            // Khởi tạo và lưu trữ con worker như một object riêng biệt (không dùng thư viện ngoài)
            const worker = new CrawlerWorker(seedUrl);
            this.workers.push(worker);

            // Bắt đầu worker bất đồng bộ (giống như hoạt động của một thread hoặc coroutine)
            worker.start().catch((err: any) => {
                this.logger.error("WORKER_ERROR", { seedUrl, err: err.message });
            });
            
            this.logger.info("SPAWNED_WORKER_FOR_CHANNEL", { seedUrl });
        } catch (e: any) {
            this.logger.error("SPAWN_WORKER_ERROR", { seedUrl, err: e.message });
        }
    }
}
