import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from './logger';

export function readFileContent(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    logger.error(`Failed to read file: ${filePath}`, error);
    throw new Error(`[MindHeal] Cannot read file: ${filePath}`);
  }
}

export function writeFileContent(filePath: string, content: string): void {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, content, 'utf-8');
  } catch (error) {
    logger.error(`Failed to write file: ${filePath}`, error);
    throw new Error(`[MindHeal] Cannot write file: ${filePath}`);
  }
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

export function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    logger.warn(`Failed to parse JSON file: ${filePath}`, error);
    return null;
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  writeFileContent(filePath, JSON.stringify(data, null, 2));
}
