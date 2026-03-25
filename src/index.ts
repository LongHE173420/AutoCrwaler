import { MasterWorker } from './com/nasa/worker/MasterWorker';
import { MysqlStore } from './com/nasa/data/MysqlStore';
import { Log, getTodayLogPath } from './com/nasa/utils/log';
import { ENV } from './com/nasa/config/env';

async function main() {
    console.log('\n--- TIKTOK CRAWLER MASTER (MULTI-THREAD) ---');
    try {
        const { filePath } = getTodayLogPath();
        Log.init({
            appName: 'TikTokCrawlerMaster',
            level: (ENV.LOG_LEVEL as any) || 'info',
            filePath: filePath
        });

        await MysqlStore.initCrawlTables();
        const master = new MasterWorker();
        await master.start();

        const runCleanup = async () => {
            try {
                const deleted = await MysqlStore.cleanupFullyPostedVideos();
                if (deleted > 0) {
                    console.log(`[Master] Đã dọn dẹp ${deleted} video cũ.`);
                }
            } catch (e: any) {
                console.error(`[Master Cleanup Error] ${e.message}`);
            }
        };
        
        const cleanupInterval = 60 * 60 * 1000;
        setInterval(runCleanup, cleanupInterval);

    } catch (err: any) {
        console.error('Failed to start system:', err.message);
        process.exit(1);
    }
}

main();
