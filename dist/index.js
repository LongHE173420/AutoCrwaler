"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const MasterWorker_1 = require("./com/nasa/worker/MasterWorker");
const MysqlStore_1 = require("./com/nasa/data/MysqlStore");
const log_1 = require("./com/nasa/utils/log");
const env_1 = require("./com/nasa/config/env");
async function main() {
    console.log('\n--- TIKTOK CRAWLER MASTER (MULTI-THREAD) ---');
    try {
        const { filePath } = (0, log_1.getTodayLogPath)();
        log_1.Log.init({
            appName: 'TikTokCrawlerMaster',
            level: env_1.ENV.LOG_LEVEL || 'info',
            filePath: filePath
        });
        await MysqlStore_1.MysqlStore.initCrawlTables();
        const master = new MasterWorker_1.MasterWorker();
        await master.start();
        const runCleanup = async () => {
            try {
                const cleanup = await MysqlStore_1.MysqlStore.cleanupFullyPostedVideos();
                if (cleanup.rowsFound > 0 || cleanup.rowsReset > 0) {
                    console.log(`[Master] Cleanup: found=${cleanup.rowsFound} deleted=${cleanup.filesDeleted} missing=${cleanup.filesMissing} reset=${cleanup.rowsReset}.`);
                }
            }
            catch (e) {
                console.error(`[Master Cleanup Error] ${e.message}`);
            }
        };
        const cleanupInterval = 60 * 60 * 1000;
        setInterval(runCleanup, cleanupInterval);
    }
    catch (err) {
        console.error('Failed to start system:', err.message);
        process.exit(1);
    }
}
main();
