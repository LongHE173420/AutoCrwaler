"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MysqlStore = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
const env_1 = require("../config/env");
class MysqlStore {
    static getPool() {
        try {
            if (!this.pool) {
                this.pool = promise_1.default.createPool({
                    host: env_1.ENV.DB_HOST,
                    user: env_1.ENV.DB_USER,
                    password: env_1.ENV.DB_PASS,
                    database: env_1.ENV.DB_NAME,
                    waitForConnections: true,
                    connectionLimit: 10,
                    queueLimit: 0,
                    connectTimeout: 10000,
                });
            }
            return this.pool;
        }
        catch (e) {
            console.error("[DB] getPool failed:", e.message);
            throw e;
        }
    }
    static async ensureColumn(pool, tableName, columnName, definition) {
        const [rows] = await pool.execute(`SELECT COUNT(*) AS count
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND COLUMN_NAME = ?`, [tableName, columnName]);
        if (Number(rows?.[0]?.count || 0) === 0) {
            await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
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
            await this.ensureColumn(pool, 'crawled_videos', 'local_path', 'VARCHAR(255)');
            await this.ensureColumn(pool, 'crawled_videos', 'downloaded', 'TINYINT DEFAULT 0');
            await this.ensureColumn(pool, 'crawled_videos', 'post_count', 'INT DEFAULT 0');
        }
        catch (e) {
            console.error("[DB] initCrawlTables failed:", e.message);
            throw e;
        }
    }
    static async saveCrawledVideo(source, sourceUrl, videoUrl, caption, hashtags, author = '') {
        const pool = this.getPool();
        try {
            const [result] = await pool.execute(`INSERT IGNORE INTO crawled_videos (source, source_url, video_url, caption, hashtags, author)
                 VALUES (?, ?, ?, ?, ?, ?)`, [source, sourceUrl, videoUrl, caption || '', hashtags || '', author]);
            const insertId = result.insertId;
            if (insertId === 0)
                return null;
            return insertId;
        }
        catch (e) {
            console.error("[DB] saveCrawledVideo failed:", e.message);
            throw e;
        }
    }
    static async saveOrGetCrawledVideo(source, sourceUrl, videoUrl, caption, hashtags, author = '') {
        const pool = this.getPool();
        const [result] = await pool.execute(`INSERT IGNORE INTO crawled_videos (source, source_url, video_url, caption, hashtags, author)
             VALUES (?, ?, ?, ?, ?, ?)`, [source, sourceUrl, videoUrl, caption || '', hashtags || '', author]);
        if (result.insertId && result.insertId > 0) {
            return {
                id: result.insertId,
                localPath: null,
                downloaded: 0,
                postCount: 0,
                inserted: true,
            };
        }
        const [rows] = await pool.execute(`SELECT id, local_path, downloaded, post_count
             FROM crawled_videos
             WHERE source = ? AND source_url = ?
             LIMIT 1`, [source, sourceUrl]);
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error(`Insert ignored but no existing crawled_videos row found for ${sourceUrl}`);
        }
        const row = rows[0];
        await pool.execute(`UPDATE crawled_videos
             SET video_url = ?, caption = ?, hashtags = ?, author = ?
             WHERE id = ?`, [videoUrl, caption || '', hashtags || '', author, row.id]);
        return {
            id: row.id,
            localPath: row.local_path || null,
            downloaded: Number(row.downloaded || 0),
            postCount: Number(row.post_count || 0),
            inserted: false,
        };
    }
    static async saveLocalPath(videoId, localPath) {
        const pool = this.getPool();
        try {
            await pool.execute(`UPDATE crawled_videos SET local_path = ?, downloaded = 1 WHERE id = ?`, [localPath, videoId]);
        }
        catch (e) {
            console.error("[DB] saveLocalPath failed:", e.message);
        }
    }
    static async markVideoFailed(videoId) {
        const pool = this.getPool();
        try {
            await pool.execute(`UPDATE crawled_videos SET local_path = NULL, downloaded = 2 WHERE id = ?`, [videoId]);
        }
        catch (e) {
            console.error("[DB] markVideoFailed failed:", e.message);
        }
    }
    static async cleanupFullyPostedVideos() {
        const pool = this.getPool();
        try {
            const [rows] = await pool.execute(`SELECT id, local_path, downloaded, post_count
                 FROM crawled_videos`);
            let rowsFound = 0;
            let filesDeleted = 0;
            let filesMissing = 0;
            let rowsReset = 0;
            const fs = await Promise.resolve().then(() => __importStar(require('fs')));
            for (const row of rows) {
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
                    }
                    catch (e) {
                        console.error("[DB] cleanupFullyPostedVideos unlink failed:", localPath, e.message);
                    }
                }
                else if (localPath) {
                    filesMissing++;
                }
                const [resetRes] = await pool.execute(`UPDATE crawled_videos SET local_path = NULL, downloaded = 0 WHERE id = ?`, [row.id]);
                rowsReset += Number(resetRes?.affectedRows || 0);
            }
            return {
                rowsFound,
                filesDeleted,
                filesMissing,
                rowsReset,
            };
        }
        catch (e) {
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
exports.MysqlStore = MysqlStore;
MysqlStore.pool = null;
