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
exports.ENV = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path = __importStar(require("path"));
dotenv_1.default.config();
function num(name, def) {
    const v = process.env[name];
    if (v == null || v === "")
        return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}
function str(name, def) {
    const v = process.env[name];
    return v == null || v === "" ? def : String(v);
}
function bool(name, def) {
    const v = process.env[name];
    if (v == null || v === "")
        return def;
    return String(v).toLowerCase() === "true" || String(v) === "1";
}
function strArray(name, def) {
    const v = process.env[name];
    if (v == null || v === "")
        return def;
    return v.split(',').map(s => s.trim()).filter(s => s.length > 0);
}
exports.ENV = {
    LOG_LEVEL: str("LOG_LEVEL", "debug"),
    LOG_DIR: str("LOG_DIR", "data/logs"),
    LOG_RETENTION_DAYS: num("LOG_RETENTION_DAYS", 7),
    DB_HOST: str("DB_HOST", "127.0.0.1"),
    DB_USER: str("DB_USER", "admin"),
    DB_PASS: str("DB_PASS", "123456"),
    DB_NAME: str("DB_NAME", "auth_service"),
    CRAWL_TIKTOK_ENABLED: bool("CRAWL_TIKTOK_ENABLED", true),
    CRAWL_INTERVAL_MS: num("CRAWL_INTERVAL_MS", 30 * 60000),
    CRAWL_LIMIT: num("CRAWL_LIMIT", 20),
    VIDEO_DOWNLOAD_DIR: str("VIDEO_DOWNLOAD_DIR", path.resolve("data/videos/raw")),
    MAX_POSTS_PER_VIDEO: num("MAX_POSTS_PER_VIDEO", 1),
    TIKTOK_SEED_URLS: strArray("TIKTOK_SEED_URLS", ["https://www.tiktok.com/@vtv24news", "https://www.tiktok.com/@theanh28entertainment", "https://www.tiktok.com/@beatvn.network", "https://www.tiktok.com/@vtvcab.tintuc", "https://www.tiktok.com/@tiin.vn", "https://www.tiktok.com/@dantri.com.vn"]),
    FB_SEED_URLS: strArray("FB_SEED_URLS", []),
    TIKTOK_BROWSER: str("TIKTOK_BROWSER", ""),
    DOWNLOAD_TIMEOUT_MS: num("DOWNLOAD_TIMEOUT_MS", 120000),
    COMPRESS_TIMEOUT_MS: num("COMPRESS_TIMEOUT_MS", 300000),
    FFMPEG_PATH: str("FFMPEG_PATH", ""),
    FFPROBE_PATH: str("FFPROBE_PATH", ""),
};
