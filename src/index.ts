import { CrawlerWorker } from './com/nasa/worker/CrawlerWorker';
import { MysqlStore } from './com/nasa/data/MysqlStore';

async function main() {
    console.log('\n--- TIKTOK CRAWLER STANDALONE ---');
    try {
        await MysqlStore.initCrawlTables();
        const worker = new CrawlerWorker();
        await worker.start();
    } catch (err: any) {
        console.error('Failed to start system:', err.message);
        process.exit(1);
    }
}

main();
