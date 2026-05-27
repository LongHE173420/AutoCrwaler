import mysql from 'mysql2/promise';
import { ENV } from '../config/env';

export interface CrawledVideoRecord {
    id: number;
    localPath: string | null;
    downloaded: number;
    postCount: number;
    inserted: boolean;
}

export interface CleanupResult {
    rowsFound: number;
    filesDeleted: number;
    filesMissing: number;
    rowsReset: number;
}

export class MysqlStore {
    private static pool: mysql.Pool | null = null;
    private static readonly CRAWLED_VIDEOS_TABLE = 'crawled_videos1';

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
        try {
            this.getPool();
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
        const tableName = this.CRAWLED_VIDEOS_TABLE;
        try {
            const [result]: any = await pool.execute(
                `INSERT IGNORE INTO ${tableName} (source, source_url, video_url, caption, hashtags, author)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [source, sourceUrl, videoUrl, caption || '', hashtags || '', author]
            );
            const insertId: number = result.insertId;
            if (insertId === 0) return null;
            return insertId;
        } catch (e: any) {
            console.error("[DB] saveCrawledVideo failed:", e.message);
            throw e;
        }
    }

    static async saveOrGetCrawledVideo(
        source: string,
        sourceUrl: string,
        videoUrl: string,
        caption: string,
        hashtags: string,
        author = ''
    ): Promise<CrawledVideoRecord> {
        const pool = this.getPool();
        const tableName = this.CRAWLED_VIDEOS_TABLE;

        const [result]: any = await pool.execute(
            `INSERT IGNORE INTO ${tableName} (source, source_url, video_url, caption, hashtags, author)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [source, sourceUrl, videoUrl, caption || '', hashtags || '', author]
        );

        if (result.insertId && result.insertId > 0) {
            return {
                id: result.insertId,
                localPath: null,
                downloaded: 0,
                postCount: 0,
                inserted: true,
            };
        }

        const [rows]: any = await pool.execute(
            `SELECT id, local_path, downloaded, post_count
             FROM ${tableName}
             WHERE source = ? AND source_url = ?
             LIMIT 1`,
            [source, sourceUrl]
        );

        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error(`Insert ignored but no existing ${tableName} row found for ${sourceUrl}`);
        }

        const row = rows[0];
        await pool.execute(
            `UPDATE ${tableName}
             SET video_url = ?, caption = ?, hashtags = ?, author = ?
             WHERE id = ?`,
            [videoUrl, caption || '', hashtags || '', author, row.id]
        );

        return {
            id: row.id,
            localPath: row.local_path || null,
            downloaded: Number(row.downloaded || 0),
            postCount: Number(row.post_count || 0),
            inserted: false,
        };
    }

    static async saveLocalPath(videoId: number, localPath: string) {
        const pool = this.getPool();
        const tableName = this.CRAWLED_VIDEOS_TABLE;
        try {
            await pool.execute(
                `UPDATE ${tableName} SET local_path = ?, downloaded = 1 WHERE id = ?`,
                [localPath, videoId]
            );
        } catch (e: any) {
            console.error("[DB] saveLocalPath failed:", e.message);
        }
    }

    static async markVideoFailed(videoId: number) {
        const pool = this.getPool();
        const tableName = this.CRAWLED_VIDEOS_TABLE;
        try {
            await pool.execute(
                `UPDATE ${tableName} SET local_path = NULL, downloaded = 2 WHERE id = ?`,
                [videoId]
            );
        } catch (e: any) {
            console.error("[DB] markVideoFailed failed:", e.message);
        }
    }


    static async cleanupFullyPostedVideos(): Promise<CleanupResult> {
        const pool = this.getPool();
        const tableName = this.CRAWLED_VIDEOS_TABLE;
        try {
            const [rows]: any = await pool.execute(
                `SELECT id, local_path, downloaded, post_count
                 FROM ${tableName}`
            );
            let rowsFound = 0;
            let filesDeleted = 0;
            let filesMissing = 0;
            let rowsReset = 0;
            const fs = await import('fs');
            for (const row of rows as { id: number; local_path: string | null; downloaded: number; post_count: number }[]) {
                const localPath = String(row.local_path || "").trim();
                const downloaded = Number(row.downloaded || 0);
                const postCount = Number(row.post_count || 0);
                const fileExists = localPath ? fs.existsSync(localPath) : false;
                const keepAsReusable = downloaded === 1 && !!localPath && postCount === 0 && fileExists;

                if (keepAsReusable) {
                    continue;
                }

                rowsFound++;

                if (localPath && fileExists) {
                    try {
                        fs.unlinkSync(localPath);
                        filesDeleted++;
                    } catch (e: any) {
                        console.error("[DB] cleanupFullyPostedVideos unlink failed:", localPath, e.message);
                    }
                } else if (localPath) {
                    filesMissing++;
                }

                const [resetRes]: any = await pool.execute(
                    `UPDATE ${tableName} SET local_path = NULL, downloaded = 0 WHERE id = ?`,
                    [row.id]
                );
                rowsReset += Number(resetRes?.affectedRows || 0);
            }
            return {
                rowsFound,
                filesDeleted,
                filesMissing,
                rowsReset,
            };
        } catch (e: any) {
            console.error("[DB] cleanupFullyPostedVideos failed:", e.message);
            return {
                rowsFound: 0,
                filesDeleted: 0,
                filesMissing: 0,
                rowsReset: 0,
            };
        }
    }
}
