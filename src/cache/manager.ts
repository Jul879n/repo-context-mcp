import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { CacheData, ProjectContext } from '../types/index.js';

const CACHE_VERSION = '1.1.0';
const CACHE_FILENAME = '.repo-context.json';

// Default TTL: 1 hour (in milliseconds)
const DEFAULT_TTL = 60 * 60 * 1000;

// Key files to monitor for changes (if any change, invalidate cache)
const WATCH_FILES = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'Gemfile',
  'tsconfig.json',
];

interface ExtendedCacheData extends CacheData {
  fileHash: string;
  ttl: number;
}

export class CacheManager {
  private cacheFile: string;
  private projectRoot: string;
  private ttl: number;

  constructor(projectRoot: string, ttl: number = DEFAULT_TTL) {
    this.projectRoot = projectRoot;
    this.cacheFile = path.join(projectRoot, CACHE_FILENAME);
    this.ttl = ttl;
  }

  /**
   * Get cached context if valid (not expired, not stale)
   */
  async get(): Promise<ProjectContext | null> {
    try {
      const content = await fs.readFile(this.cacheFile, 'utf-8');
      const data: ExtendedCacheData = JSON.parse(content);
      
      // Check version compatibility
      if (data.version !== CACHE_VERSION) {
        return null;
      }
      
      // Check TTL
      const generatedTime = new Date(data.generatedAt).getTime();
      const now = Date.now();
      if (now - generatedTime > (data.ttl || this.ttl)) {
        return null;
      }
      
      // Check file hash (quick check for config changes)
      const currentHash = await this.computeFileHash();
      if (currentHash !== data.fileHash) {
        return null;
      }
      
      return data.context;
    } catch {
      return null;
    }
  }

  /**
   * Save context to cache with hash
   */
  async set(context: ProjectContext, projectRoot: string): Promise<void> {
    const fileHash = await this.computeFileHash();
    
    const data: ExtendedCacheData = {
      version: CACHE_VERSION,
      context,
      generatedAt: new Date().toISOString(),
      projectRoot,
      fileHash,
      ttl: this.ttl,
    };

    // Write minified JSON for smaller cache file
    await fs.writeFile(this.cacheFile, JSON.stringify(data), 'utf-8');
  }

  /**
   * Invalidate cache
   */
  async invalidate(): Promise<void> {
    try {
      await fs.unlink(this.cacheFile);
    } catch {
      // File doesn't exist, ignore
    }
  }

  /**
   * Check if cache file exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.cacheFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get cache info (for debugging)
   */
  async getInfo(): Promise<{ exists: boolean; age?: number; valid?: boolean }> {
    try {
      const content = await fs.readFile(this.cacheFile, 'utf-8');
      const data: ExtendedCacheData = JSON.parse(content);
      const generatedTime = new Date(data.generatedAt).getTime();
      const age = Date.now() - generatedTime;
      const currentHash = await this.computeFileHash();
      
      return {
        exists: true,
        age,
        valid: age < this.ttl && currentHash === data.fileHash,
      };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Compute hash of key config files
   * This is FAST because we only hash config files, not the whole project
   */
  private async computeFileHash(): Promise<string> {
    const hash = crypto.createHash('md5');
    
    for (const file of WATCH_FILES) {
      try {
        const filePath = path.join(this.projectRoot, file);
        const stat = await fs.stat(filePath);
        // Use mtime + size for speed (don't read file content)
        hash.update(`${file}:${stat.mtimeMs}:${stat.size}`);
      } catch {
        // File doesn't exist, skip
      }
    }
    
    // Also include folder structure (just top-level dirs)
    try {
      const entries = await fs.readdir(this.projectRoot, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => e.name)
        .sort()
        .join(',');
      hash.update(`dirs:${dirs}`);
    } catch {
      // Ignore errors
    }
    
    return hash.digest('hex').slice(0, 12); // Short hash is enough
  }
}

/**
 * In-memory cache for even faster repeated access
 * (useful within same MCP session)
 */
const memoryCache = new Map<string, { context: ProjectContext; timestamp: number }>();
const MEMORY_TTL = 30000; // 30 seconds

export class FastCache {
  static get(projectRoot: string): ProjectContext | null {
    const cached = memoryCache.get(projectRoot);
    if (cached && Date.now() - cached.timestamp < MEMORY_TTL) {
      return cached.context;
    }
    return null;
  }

  static set(projectRoot: string, context: ProjectContext): void {
    memoryCache.set(projectRoot, { context, timestamp: Date.now() });
  }

  static clear(projectRoot?: string): void {
    if (projectRoot) {
      memoryCache.delete(projectRoot);
    } else {
      memoryCache.clear();
    }
  }
}
