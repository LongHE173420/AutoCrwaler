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
        if (seeds.length === 0) {
            this.logger.warn("NO_SEEDS_CONFIGURED");
            return;
        }

        // Chia đều limit cho từng worker (mỗi worker = 1 tài khoản)
        const totalLimit = ENV.CRAWL_LIMIT || 20;
        const perWorkerLimit = Math.max(1, Math.ceil(totalLimit / seeds.length));

        this.logger.info("DISTRIBUTING_CRAWL_LIMIT", {
            totalLimit,
            perWorkerLimit,
            totalWorkers: seeds.length
        });

        // Khởi tạo tất cả workers và chạy song song
        const workerPromises = seeds.map(seed => this.spawnWorker(seed, perWorkerLimit));
        await Promise.all(workerPromises);
    }

    private async spawnWorker(seedUrl: string, limit: number): Promise<void> {
        try {
            const worker = new CrawlerWorker(seedUrl, limit);
            this.workers.push(worker);

            this.logger.info("SPAWNED_WORKER_FOR_CHANNEL", { seedUrl, limit });
            await worker.start();
        } catch (e: any) {
            this.logger.error("SPAWN_WORKER_ERROR", { seedUrl, err: e.message });
        }
    }
}
