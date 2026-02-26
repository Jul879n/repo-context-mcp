import * as fs from 'fs/promises';
import * as path from 'path';
import { Language, StackInfo, Framework, Dependency } from '../types/index.js';

// File patterns that indicate a language
const LANGUAGE_INDICATORS: Record<Language, { files: string[]; extensions: string[] }> = {
  typescript: {
    files: ['tsconfig.json', 'tsconfig.base.json'],
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
  },
  javascript: {
    files: ['package.json', 'jsconfig.json'],
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  },
  python: {
    files: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'poetry.lock'],
    extensions: ['.py', '.pyw', '.pyi'],
  },
  rust: {
    files: ['Cargo.toml', 'Cargo.lock'],
    extensions: ['.rs'],
  },
  go: {
    files: ['go.mod', 'go.sum'],
    extensions: ['.go'],
  },
  java: {
    files: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'],
    extensions: ['.java'],
  },
  kotlin: {
    files: ['build.gradle.kts'],
    extensions: ['.kt', '.kts'],
  },
  csharp: {
    files: [],
    extensions: ['.cs', '.csproj', '.sln'],
  },
  php: {
    files: ['composer.json', 'composer.lock'],
    extensions: ['.php'],
  },
  ruby: {
    files: ['Gemfile', 'Gemfile.lock', 'Rakefile'],
    extensions: ['.rb', '.rake'],
  },
  swift: {
    files: ['Package.swift'],
    extensions: ['.swift'],
  },
  dart: {
    files: ['pubspec.yaml', 'pubspec.lock'],
    extensions: ['.dart'],
  },
  unknown: {
    files: [],
    extensions: [],
  },
};

// Framework detection patterns
const FRAMEWORK_PATTERNS: Record<string, { 
  indicator: string; 
  type: 'file' | 'dependency';
  category: Framework['category'];
}> = {
  // JavaScript/TypeScript
  'react': { indicator: 'react', type: 'dependency', category: 'frontend' },
  'next.js': { indicator: 'next', type: 'dependency', category: 'fullstack' },
  'vue': { indicator: 'vue', type: 'dependency', category: 'frontend' },
  'nuxt': { indicator: 'nuxt', type: 'dependency', category: 'fullstack' },
  'angular': { indicator: '@angular/core', type: 'dependency', category: 'frontend' },
  'svelte': { indicator: 'svelte', type: 'dependency', category: 'frontend' },
  'express': { indicator: 'express', type: 'dependency', category: 'backend' },
  'fastify': { indicator: 'fastify', type: 'dependency', category: 'backend' },
  'nestjs': { indicator: '@nestjs/core', type: 'dependency', category: 'backend' },
  'hono': { indicator: 'hono', type: 'dependency', category: 'backend' },
  'elysia': { indicator: 'elysia', type: 'dependency', category: 'backend' },
  'astro': { indicator: 'astro', type: 'dependency', category: 'fullstack' },
  'remix': { indicator: '@remix-run/node', type: 'dependency', category: 'fullstack' },
  'electron': { indicator: 'electron', type: 'dependency', category: 'other' },
  'tauri': { indicator: '@tauri-apps/api', type: 'dependency', category: 'other' },
  
  // Python
  'django': { indicator: 'django', type: 'dependency', category: 'fullstack' },
  'flask': { indicator: 'flask', type: 'dependency', category: 'backend' },
  'fastapi': { indicator: 'fastapi', type: 'dependency', category: 'backend' },
  'pytorch': { indicator: 'torch', type: 'dependency', category: 'library' },
  'tensorflow': { indicator: 'tensorflow', type: 'dependency', category: 'library' },
  
  // Rust
  'actix': { indicator: 'actix-web', type: 'dependency', category: 'backend' },
  'axum': { indicator: 'axum', type: 'dependency', category: 'backend' },
  'rocket': { indicator: 'rocket', type: 'dependency', category: 'backend' },
  
  // Go
  'gin': { indicator: 'github.com/gin-gonic/gin', type: 'dependency', category: 'backend' },
  'echo': { indicator: 'github.com/labstack/echo', type: 'dependency', category: 'backend' },
  'fiber': { indicator: 'github.com/gofiber/fiber', type: 'dependency', category: 'backend' },
  
  // Java
  'spring': { indicator: 'org.springframework', type: 'dependency', category: 'backend' },
  
  // PHP
  'laravel': { indicator: 'laravel/framework', type: 'dependency', category: 'fullstack' },
  'symfony': { indicator: 'symfony/framework-bundle', type: 'dependency', category: 'backend' },
  
  // Ruby
  'rails': { indicator: 'rails', type: 'dependency', category: 'fullstack' },
  'sinatra': { indicator: 'sinatra', type: 'dependency', category: 'backend' },
};

export async function detectLanguages(projectRoot: string): Promise<Language[]> {
  const detected: Set<Language> = new Set();
  
  try {
    const files = await fs.readdir(projectRoot);
    
    for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS)) {
      if (lang === 'unknown') continue;
      
      // Check for indicator files
      for (const file of indicators.files) {
        if (files.includes(file)) {
          detected.add(lang as Language);
          break;
        }
      }
    }
    
    // If no languages detected from config files, scan for source files
    if (detected.size === 0) {
      await scanForExtensions(projectRoot, detected);
    }
  } catch {
    // If we can't read the directory, return unknown
  }
  
  return detected.size > 0 ? Array.from(detected) : ['unknown'];
}

async function scanForExtensions(dir: string, detected: Set<Language>, depth = 0): Promise<void> {
  if (depth > 3) return; // Don't go too deep
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') {
        continue;
      }
      
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS)) {
          if (indicators.extensions.includes(ext)) {
            detected.add(lang as Language);
          }
        }
      } else if (entry.isDirectory()) {
        await scanForExtensions(path.join(dir, entry.name), detected, depth + 1);
      }
    }
  } catch {
    // Ignore errors
  }
}

export function determinePrimaryLanguage(languages: Language[]): Language {
  // Priority order for primary language
  const priority: Language[] = [
    'typescript', 'javascript', 'python', 'rust', 'go', 
    'java', 'kotlin', 'csharp', 'php', 'ruby', 'swift', 'dart'
  ];
  
  for (const lang of priority) {
    if (languages.includes(lang)) {
      return lang;
    }
  }
  
  return languages[0] || 'unknown';
}

export async function detectPackageManager(projectRoot: string): Promise<string | undefined> {
  const files: string[] = await fs.readdir(projectRoot).catch(() => [] as string[]);
  
  // Node.js package managers
  if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun';
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (files.includes('package-lock.json')) return 'npm';
  
  // Python
  if (files.includes('poetry.lock')) return 'poetry';
  if (files.includes('Pipfile.lock')) return 'pipenv';
  if (files.includes('requirements.txt')) return 'pip';
  if (files.includes('pyproject.toml')) return 'pip/poetry';
  
  // Rust
  if (files.includes('Cargo.lock')) return 'cargo';
  
  // Go
  if (files.includes('go.sum')) return 'go modules';
  
  // PHP
  if (files.includes('composer.lock')) return 'composer';
  
  // Ruby
  if (files.includes('Gemfile.lock')) return 'bundler';
  
  // Dart
  if (files.includes('pubspec.lock')) return 'pub';
  
  return undefined;
}

export async function detectRuntime(projectRoot: string, languages: Language[]): Promise<string | undefined> {
  const files: string[] = await fs.readdir(projectRoot).catch(() => [] as string[]);
  
  if (languages.includes('typescript') || languages.includes('javascript')) {
    if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun';
    if (files.includes('deno.json') || files.includes('deno.jsonc')) return 'deno';
    return 'node';
  }
  
  if (languages.includes('python')) {
    return 'python';
  }
  
  return undefined;
}

export async function parseDependencies(projectRoot: string, primaryLanguage: Language): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  
  try {
    switch (primaryLanguage) {
      case 'typescript':
      case 'javascript':
        return await parseNodeDependencies(projectRoot);
      case 'python':
        return await parsePythonDependencies(projectRoot);
      case 'rust':
        return await parseRustDependencies(projectRoot);
      case 'go':
        return await parseGoDependencies(projectRoot);
      case 'php':
        return await parsePhpDependencies(projectRoot);
      case 'ruby':
        return await parseRubyDependencies(projectRoot);
      default:
        return deps;
    }
  } catch {
    return deps;
  }
}

async function parseNodeDependencies(projectRoot: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    
    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
      deps.push({ name, version: String(version), dev: false });
    }
    
    for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
      deps.push({ name, version: String(version), dev: true });
    }
  } catch {
    // Ignore
  }
  
  return deps;
}

async function parsePythonDependencies(projectRoot: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  
  // Try pyproject.toml first
  try {
    const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
    const content = await fs.readFile(pyprojectPath, 'utf-8');
    
    // Simple TOML parsing for dependencies
    const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depsMatch) {
      const depsStr = depsMatch[1];
      const depLines = depsStr.match(/"([^"]+)"/g) || [];
      for (const dep of depLines) {
        const clean = dep.replace(/"/g, '');
        const [name, version] = clean.split(/[>=<~^]+/);
        deps.push({ name: name.trim(), version: version?.trim() || '*', dev: false });
      }
    }
  } catch {
    // Try requirements.txt
    try {
      const reqPath = path.join(projectRoot, 'requirements.txt');
      const content = await fs.readFile(reqPath, 'utf-8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^([a-zA-Z0-9_-]+)([>=<~^!]+)?(.+)?$/);
          if (match) {
            deps.push({ 
              name: match[1], 
              version: match[3]?.trim() || '*', 
              dev: false 
            });
          }
        }
      }
    } catch {
      // Ignore
    }
  }
  
  return deps;
}

async function parseRustDependencies(projectRoot: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  
  try {
    const cargoPath = path.join(projectRoot, 'Cargo.toml');
    const content = await fs.readFile(cargoPath, 'utf-8');
    
    // Simple parsing for [dependencies] section
    const depsSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
    if (depsSection) {
      const lines = depsSection[1].split('\n');
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"?([^"]+)"?/);
        if (match) {
          deps.push({ name: match[1], version: match[2], dev: false });
        }
      }
    }
    
    // Dev dependencies
    const devDepsSection = content.match(/\[dev-dependencies\]([\s\S]*?)(?:\[|$)/);
    if (devDepsSection) {
      const lines = devDepsSection[1].split('\n');
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"?([^"]+)"?/);
        if (match) {
          deps.push({ name: match[1], version: match[2], dev: true });
        }
      }
    }
  } catch {
    // Ignore
  }
  
  return deps;
}

async function parseGoDependencies(projectRoot: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  
  try {
    const goModPath = path.join(projectRoot, 'go.mod');
    const content = await fs.readFile(goModPath, 'utf-8');
    
    const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock) {
      const lines = requireBlock[1].split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^(\S+)\s+(\S+)/);
        if (match) {
          deps.push({ name: match[1], version: match[2], dev: false });
        }
      }
    }
    
    // Single requires
    const singleRequires = content.matchAll(/require\s+(\S+)\s+(\S+)/g);
    for (const match of singleRequires) {
      deps.push({ name: match[1], version: match[2], dev: false });
    }
  } catch {
    // Ignore
  }
  
  return deps;
}

async function parsePhpDependencies(projectRoot: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  
  try {
    const composerPath = path.join(projectRoot, 'composer.json');
    const content = await fs.readFile(composerPath, 'utf-8');
    const composer = JSON.parse(content);
    
    for (const [name, version] of Object.entries(composer.require || {})) {
      if (!name.startsWith('php') && !name.startsWith('ext-')) {
        deps.push({ name, version: String(version), dev: false });
      }
    }
    
    for (const [name, version] of Object.entries(composer['require-dev'] || {})) {
      deps.push({ name, version: String(version), dev: true });
    }
  } catch {
    // Ignore
  }
  
  return deps;
}

async function parseRubyDependencies(projectRoot: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  
  try {
    const gemfilePath = path.join(projectRoot, 'Gemfile');
    const content = await fs.readFile(gemfilePath, 'utf-8');
    
    const gemMatches = content.matchAll(/gem\s+['"]([^'"]+)['"](,\s*['"]([^'"]+)['"])?/g);
    for (const match of gemMatches) {
      deps.push({ name: match[1], version: match[3] || '*', dev: false });
    }
  } catch {
    // Ignore
  }
  
  return deps;
}

export async function detectFrameworks(dependencies: Dependency[]): Promise<Framework[]> {
  const frameworks: Framework[] = [];
  const depNames = new Set(dependencies.map(d => d.name.toLowerCase()));
  
  for (const [name, pattern] of Object.entries(FRAMEWORK_PATTERNS)) {
    if (pattern.type === 'dependency') {
      const indicator = pattern.indicator.toLowerCase();
      for (const dep of dependencies) {
        if (dep.name.toLowerCase() === indicator || dep.name.toLowerCase().includes(indicator)) {
          frameworks.push({
            name,
            version: dep.version,
            category: pattern.category,
          });
          break;
        }
      }
    }
  }
  
  return frameworks;
}

export async function detectStack(projectRoot: string): Promise<StackInfo> {
  const languages = await detectLanguages(projectRoot);
  const primaryLanguage = determinePrimaryLanguage(languages);
  const packageManager = await detectPackageManager(projectRoot);
  const runtime = await detectRuntime(projectRoot, languages);
  const dependencies = await parseDependencies(projectRoot, primaryLanguage);
  const frameworks = await detectFrameworks(dependencies);
  
  return {
    languages,
    primaryLanguage,
    frameworks,
    dependencies,
    packageManager,
    runtime,
  };
}
