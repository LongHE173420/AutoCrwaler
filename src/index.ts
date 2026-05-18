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
                const cleanup = await MysqlStore.cleanupFullyPostedVideos();
                if (cleanup.rowsFound > 0 || cleanup.rowsReset > 0) {
                    console.log(
                        `[Master] Cleanup: found=${cleanup.rowsFound} deleted=${cleanup.filesDeleted} missing=${cleanup.filesMissing} reset=${cleanup.rowsReset}.`
                    );
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
