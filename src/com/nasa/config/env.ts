import dotenv from "dotenv";
import * as path from "path";

dotenv.config();

type Bool = boolean;

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name: string, def: string): string {
  const v = process.env[name];
  return v == null || v === "" ? def : String(v);
}

function bool(name: string, def: Bool): Bool {
  const v = process.env[name];
  if (v == null || v === "") return def;
  return String(v).toLowerCase() === "true" || String(v) === "1";
}

function strArray(name: string, def: string[]): string[] {
  const v = process.env[name];
  if (v == null || v === "") return def;
  return v.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

export const ENV = {
  KONG_URL: str("KONG_URL", "https://social.eric.pro.vn"),

  INTERVAL_MS: num("INTERVAL_MS", 60_000),
  RUN_ONCE: bool("RUN_ONCE", false),

  LOG_LEVEL: str("LOG_LEVEL", "debug"),
  LOG_VERBOSE: bool("LOG_VERBOSE", false),
  LOG_HTTP: bool("LOG_HTTP", false),
  LOG_DIR: str("LOG_DIR", "data/logs"),
  LOG_RETENTION_DAYS: num("LOG_RETENTION_DAYS", 7),

  DB_HOST: str("DB_HOST", "127.0.0.1"),
  DB_USER: str("DB_USER", "root"),
  DB_PASS: str("DB_PASS", "Long2002@"),
  DB_NAME: str("DB_NAME", "auth_service"),

  CRAWL_TIKTOK_ENABLED: bool("CRAWL_TIKTOK_ENABLED", true),
  CRAWL_INTERVAL_MS: num("CRAWL_INTERVAL_MS", 30 * 60_000),
  CRAWL_LIMIT: num("CRAWL_LIMIT", 20),
  VIDEO_DOWNLOAD_DIR: str("VIDEO_DOWNLOAD_DIR", path.resolve("data/videos/raw")),
  MAX_POSTS_PER_VIDEO: num("MAX_POSTS_PER_VIDEO", 2),

  TIKTOK_SEED_URLS: strArray("TIKTOK_SEED_URLS", ["https://www.tiktok.com/@vtv24news", "https://www.tiktok.com/@theanh28entertainment", "https://www.tiktok.com/@beatvn.network", "https://www.tiktok.com/@vtvcab.tintuc", "https://www.tiktok.com/@tiin.vn", "https://www.tiktok.com/@dantri.com.vn"]),
  FB_SEED_URLS: strArray("FB_SEED_URLS", []),
  TIKTOK_BROWSER: str("TIKTOK_BROWSER", "chrome"),

  DOWNLOAD_TIMEOUT_MS: num("DOWNLOAD_TIMEOUT_MS", 120_000),
  COMPRESS_TIMEOUT_MS: num("COMPRESS_TIMEOUT_MS", 300_000),

  FFMPEG_PATH: str("FFMPEG_PATH", ""),
  FFPROBE_PATH: str("FFPROBE_PATH", ""),
};

export type Env = typeof ENV;
