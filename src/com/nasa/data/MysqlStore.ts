import mysql from 'mysql2/promise';
import { ENV } from '../config/env';

export class MysqlStore {
    private static pool: mysql.Pool | null = null;

    private static getPool() {
        try {
            if (!this.pool) {
                this.pool = mysql.createPool({
                    host: ENV.DB_HOST,
                    user: ENV.DB_USER,
                    password: ENV.DB_PASS,
                    database: ENV.DB_NAME,
                    waitForConnections: true,
                    connectionLimit: 10,
                    queueLimit: 0,
                    connectTimeout: 10000,
                });
            }
            return this.pool;
        } catch (e: any) {
            console.error("[DB] getPool failed:", e.message);
            throw e;
        }
    }

    static async initCrawlTables() {
        const pool = this.getPool();
        try {
            await pool.execute(`
                CREATE TABLE IF NOT EXISTS crawled_videos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    source VARCHAR(50),
                    source_url VARCHAR(255) UNIQUE,
                    video_url TEXT,
                    caption TEXT,
                    hashtags TEXT,
                    author VARCHAR(100),
                    local_path VARCHAR(255),
                    downloaded TINYINT DEFAULT 0,
                    post_count INT DEFAULT 0,
                    max_posts INT DEFAULT 2,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await pool.execute(`
                CREATE TABLE IF NOT EXISTS video_post_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    video_id INT,
                    account_phone VARCHAR(20),
                    posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_post (video_id, account_phone)
                )
            `);
        } catch (e: any) {
            console.error("[DB] initCrawlTables failed:", e.message);
            throw e;
        }
    }

    static async saveCrawledVideo(
        source: string,
        sourceUrl: string,
        videoUrl: string,
        caption: string,
        hashtags: string,
        author = ''
    ): Promise<number | null> {
        const pool = this.getPool();
        try {
            const [result]: any = await pool.execute(
                `INSERT IGNORE INTO crawled_videos (source, source_url, video_url, caption, hashtags, author, max_posts)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [source, sourceUrl, videoUrl, caption || '', hashtags || '', author, ENV.MAX_POSTS_PER_VIDEO]
            );
            const insertId: number = result.insertId;
            if (insertId === 0) return null;
            return insertId;
        } catch (e: any) {
            console.error("[DB] saveCrawledVideo failed:", e.message);
            return null;
        }
    }

    static async saveLocalPath(videoId: number, localPath: string) {
        const pool = this.getPool();
        try {
            await pool.execute(
                `UPDATE crawled_videos SET local_path = ?, downloaded = 1 WHERE id = ?`,
                [localPath, videoId]
            );
        } catch (e: any) {
            console.error("[DB] saveLocalPath failed:", e.message);
        }
    }

    static async markVideoFailed(videoId: number) {
        const pool = this.getPool();
        try {
            await pool.execute(
                `UPDATE crawled_videos SET local_path = NULL, downloaded = 2 WHERE id = ?`,
                [videoId]
            );
        } catch (e: any) {
            console.error("[DB] markVideoFailed failed:", e.message);
        }
    }


    static async cleanupFullyPostedVideos(): Promise<number> {
        const pool = this.getPool();
        try {
            const [rows]: any = await pool.execute(
                `SELECT id, local_path FROM crawled_videos
                 WHERE post_count >= max_posts AND local_path IS NOT NULL AND downloaded = 1`
            );
            let cleaned = 0;
            const fs = await import('fs');
            for (const row of rows as { id: number; local_path: string }[]) {
                if (fs.existsSync(row.local_path)) {
                    fs.unlinkSync(row.local_path);
                    cleaned++;
                }
                await pool.execute(
                    `UPDATE crawled_videos SET local_path = NULL, downloaded = 0 WHERE id = ?`,
                    [row.id]
                );
            }
            return cleaned;
        } catch (e: any) {
            console.error("[DB] cleanupFullyPostedVideos failed:", e.message);
            return 0;
        }
    }
}
