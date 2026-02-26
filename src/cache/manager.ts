import * as fs from 'fs/promises';
import * as path from 'path';
import { CacheData, ProjectContext } from '../types/index.js';

const CACHE_VERSION = '1.0.0';
const CACHE_FILENAME = '.repo-context.json';

export class CacheManager {
  private cacheFile: string;

  constructor(projectRoot: string) {
    this.cacheFile = path.join(projectRoot, CACHE_FILENAME);
  }

  async get(): Promise<ProjectContext | null> {
    try {
      const content = await fs.readFile(this.cacheFile, 'utf-8');
      const data: CacheData = JSON.parse(content);
      
      // Check version compatibility
      if (data.version !== CACHE_VERSION) {
        return null;
      }
      
      return data.context;
    } catch {
      return null;
    }
  }

  async set(context: ProjectContext, projectRoot: string): Promise<void> {
    const data: CacheData = {
      version: CACHE_VERSION,
      context,
      generatedAt: new Date().toISOString(),
      projectRoot,
    };

    await fs.writeFile(this.cacheFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  async invalidate(): Promise<void> {
    try {
      await fs.unlink(this.cacheFile);
    } catch {
      // File doesn't exist, ignore
    }
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.cacheFile);
      return true;
    } catch {
      return false;
    }
  }
}
