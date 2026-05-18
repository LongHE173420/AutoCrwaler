"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Log = void 0;
exports.ensureLogDir = ensureLogDir;
exports.getTodayLogPath = getTodayLogPath;
exports.cleanupOldLogs = cleanupOldLogs;
const pino_1 = __importDefault(require("pino"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const env_1 = require("../config/env");
function ensureLogDir() {
    const dir = path_1.default.resolve(process.cwd(), env_1.ENV.LOG_DIR);
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
function getTodayLogPath() {
    const dir = ensureLogDir();
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const fileName = `login-worker-${yyyy}-${mm}-${dd}.log`;
    const filePath = path_1.default.join(dir, fileName);
    return { fileName, filePath };
}
function tryDeleteLog(fp, cutoff) {
    try {
        if (!fs_1.default.existsSync(fp))
            return;
        const st = fs_1.default.statSync(fp);
        if (!st.isFile())
            return;
        if (st.mtimeMs < cutoff)
            fs_1.default.rmSync(fp, { force: true });
    }
    catch {
        // ignore
    }
}
function cleanupOldLogs() {
    const dir = ensureLogDir();
    const days = env_1.ENV.LOG_RETENTION_DAYS;
    if (!Number.isFinite(days) || days <= 0)
        return;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    try {
        for (const name of fs_1.default.readdirSync(dir)) {
            tryDeleteLog(path_1.default.join(dir, name), cutoff);
        }
    }
    catch (e) {
    }
}
const multistream = pino_1.default.multistream;
class Log {
    static init(opts) {
        if (this.initialized)
            return;
        const baseConfig = {
            level: opts?.level ?? process.env.LOG_LEVEL,
            base: {
                app: opts?.appName,
            },
            timestamp: () => `,"time":"${new Date().toISOString().split('T')[1].split('Z')[0]}"`,
        };
        if (opts?.filePath) {
            const fileStream = pino_1.default.destination({ dest: opts.filePath, sync: false });
            const streams = [{ stream: fileStream }];
            if (process.env.LOG_CONSOLE === "true" || process.env.LOG_CONSOLE === "1") {
                streams.push({ stream: pino_1.default.destination(1) });
            }
            this.root = (0, pino_1.default)(baseConfig, multistream(streams));
        }
        else {
            if (process.env.LOG_CONSOLE === "true" || process.env.LOG_CONSOLE === "1") {
                this.root = (0, pino_1.default)(baseConfig);
            }
            else {
                this.root = (0, pino_1.default)({ ...baseConfig, level: "silent" });
            }
        }
        this.initialized = true;
    }
    static getLogger(name) {
        if (!this.initialized) {
            this.init();
        }
        const logger = this.root.child({ logger: name });
        return {
            debug: (msg, obj) => logger.debug(obj || {}, msg),
            info: (msg, obj) => logger.info(obj || {}, msg),
            warn: (msg, obj) => logger.warn(obj || {}, msg),
            error: (msg, obj) => logger.error(obj || {}, msg),
        };
    }
}
exports.Log = Log;
Log.initialized = false;
