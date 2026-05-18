"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MasterWorker = void 0;
const env_1 = require("../config/env");
const log_1 = require("../utils/log");
const CrawlerWorker_1 = require("./CrawlerWorker");
class MasterWorker {
    constructor() {
        this.logger = log_1.Log.getLogger('MasterWorker');
        this.workers = [];
    }
    async start() {
        this.logger.info("MASTER_WORKER_STARTING", {
            enabled: env_1.ENV.CRAWL_TIKTOK_ENABLED,
            seedsCount: env_1.ENV.TIKTOK_SEED_URLS.length
        });
        if (!env_1.ENV.CRAWL_TIKTOK_ENABLED) {
            this.logger.warn("CRAWL_DISABLED_BY_CONFIG");
            return;
        }
        const seeds = env_1.ENV.TIKTOK_SEED_URLS || [];
        if (seeds.length === 0) {
            this.logger.warn("NO_SEEDS_CONFIGURED");
            return;
        }
        // Chia đều limit cho từng worker (mỗi worker = 1 tài khoản)
        const totalLimit = env_1.ENV.CRAWL_LIMIT || 20;
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
    async spawnWorker(seedUrl, limit) {
        try {
            const worker = new CrawlerWorker_1.CrawlerWorker(seedUrl, limit);
            this.workers.push(worker);
            this.logger.info("SPAWNED_WORKER_FOR_CHANNEL", { seedUrl, limit });
            await worker.start();
        }
        catch (e) {
            this.logger.error("SPAWN_WORKER_ERROR", { seedUrl, err: e.message });
        }
    }
}
exports.MasterWorker = MasterWorker;
