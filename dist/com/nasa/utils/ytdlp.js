"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getYtdlpCommand = getYtdlpCommand;
exports.createYtdlpExecOptions = createYtdlpExecOptions;
exports.cleanupYtdlpTempDir = cleanupYtdlpTempDir;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const env_1 = require("../config/env");
function getYtdlpCommand() {
    return env_1.ENV.YTDLP_CMD || "yt-dlp";
}
function createYtdlpExecOptions() {
    const options = {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
    };
    const tempBase = env_1.ENV.YTDLP_TEMP_DIR ? path_1.default.resolve(env_1.ENV.YTDLP_TEMP_DIR) : "";
    if (!tempBase) {
        return { options, tempDir: null };
    }
    const tempDir = path_1.default.join(tempBase, `run-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs_1.default.mkdirSync(tempDir, { recursive: true });
    options.env = {
        ...process.env,
        TEMP: tempDir,
        TMP: tempDir,
        TMPDIR: tempDir,
    };
    return { options, tempDir };
}
function cleanupYtdlpTempDir(tempDir) {
    if (!tempDir)
        return;
    setTimeout(() => {
        fs_1.default.rm(tempDir, { recursive: true, force: true }, () => undefined);
    }, 5000);
}
