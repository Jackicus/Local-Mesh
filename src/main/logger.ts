import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

// Minimal file logger: userData/logs/main.log, truncated when it outgrows 1MB.
// Crash visibility for packaged builds, where there is no terminal to read.

let logPath: string | null = null;

function getLogPath(): string {
  if (!logPath) {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'main.log');
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1_000_000) {
        fs.truncateSync(logPath);
      }
    } catch {}
  }
  return logPath;
}

function write(level: string, message: string) {
  try {
    fs.appendFileSync(getLogPath(), `${new Date().toISOString()} [${level}] ${message}\n`);
  } catch {}
}

export const log = {
  info: (message: string) => write('info', message),
  error: (message: string) => write('error', message),
};

export function installCrashLogging() {
  process.on('uncaughtException', (err) => {
    log.error(`uncaughtException: ${err.stack ?? err}`);
  });
  process.on('unhandledRejection', (reason) => {
    log.error(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });
}
