import type { LoggingConfig } from '../types/index';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const PREFIX = '[MindHeal]';

let currentLevel: keyof typeof LOG_LEVELS = 'info';
let logFilePath: string | undefined;

export function configureLogger(config: LoggingConfig): void {
  currentLevel = config.level;
  logFilePath = config.file;

  if (logFilePath) {
    const dir = dirname(logFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function shouldLog(level: keyof typeof LOG_LEVELS): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const base = `${timestamp} ${PREFIX} [${level.toUpperCase()}] ${message}`;
  if (data !== undefined) {
    return `${base} ${JSON.stringify(data, null, 2)}`;
  }
  return base;
}

function writeToFile(formatted: string): void {
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, formatted + '\n', 'utf-8');
    } catch {
      // Silently fail file logging
    }
  }
}

export const logger = {
  debug(message: string, data?: unknown): void {
    if (!shouldLog('debug')) return;
    const formatted = formatMessage('debug', message, data);
    writeToFile(formatted);
    // eslint-disable-next-line no-console
    console.debug(formatted);
  },

  info(message: string, data?: unknown): void {
    if (!shouldLog('info')) return;
    const formatted = formatMessage('info', message, data);
    writeToFile(formatted);
    // eslint-disable-next-line no-console
    console.info(formatted);
  },

  warn(message: string, data?: unknown): void {
    if (!shouldLog('warn')) return;
    const formatted = formatMessage('warn', message, data);
    writeToFile(formatted);
    // eslint-disable-next-line no-console
    console.warn(formatted);
  },

  error(message: string, data?: unknown): void {
    if (!shouldLog('error')) return;
    const formatted = formatMessage('error', message, data);
    writeToFile(formatted);
    // eslint-disable-next-line no-console
    console.error(formatted);
  },
};
