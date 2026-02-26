import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectContext } from '../types/index.js';
import { CacheManager } from '../cache/manager.js';
import {
  detectStack,
  detectEndpoints,
  detectModels,
  detectArchitecture,
  detectStructure,
  detectStatus,
} from '../detectors/index.js';

export async function getFullContext(
  projectRoot: string,
  forceRefresh = false
): Promise<ProjectContext> {
  const cache = new CacheManager(projectRoot);
  
  // Check cache first
  if (!forceRefresh) {
    const cached = await cache.get();
    if (cached) {
      return cached;
    }
  }
  
  // Analyze project
  const context = await analyzeProject(projectRoot);
  
  // Save to cache
  await cache.set(context, projectRoot);
  
  return context;
}

export async function analyzeProject(projectRoot: string): Promise<ProjectContext> {
  // Get project name from package.json, Cargo.toml, etc. or folder name
  const name = await getProjectName(projectRoot);
  const description = await getProjectDescription(projectRoot);
  const version = await getProjectVersion(projectRoot);
  
  // Run all detectors
  const [stack, structure, architecture, status] = await Promise.all([
    detectStack(projectRoot),
    detectStructure(projectRoot),
    detectArchitecture(projectRoot),
    detectStatus(projectRoot),
  ]);
  
  // These depend on stack info
  const frameworkNames = stack.frameworks.map(f => f.name);
  const [endpoints, models] = await Promise.all([
    detectEndpoints(projectRoot, stack.primaryLanguage, frameworkNames),
    detectModels(projectRoot, stack.primaryLanguage),
  ]);
  
  return {
    name,
    description,
    version,
    stack,
    structure,
    endpoints: endpoints.endpoints.length > 0 ? endpoints : undefined,
    models: models.models.length > 0 ? models : undefined,
    architecture,
    status,
    analyzedAt: new Date().toISOString(),
  };
}

async function getProjectName(projectRoot: string): Promise<string> {
  // Try package.json
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.name) return pkg.name;
  } catch {}
  
  // Try Cargo.toml
  try {
    const cargoPath = path.join(projectRoot, 'Cargo.toml');
    const content = await fs.readFile(cargoPath, 'utf-8');
    const match = content.match(/name\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {}
  
  // Try pyproject.toml
  try {
    const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
    const content = await fs.readFile(pyprojectPath, 'utf-8');
    const match = content.match(/name\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {}
  
  // Try go.mod
  try {
    const goModPath = path.join(projectRoot, 'go.mod');
    const content = await fs.readFile(goModPath, 'utf-8');
    const match = content.match(/module\s+(\S+)/);
    if (match) {
      // Return last part of module path
      const parts = match[1].split('/');
      return parts[parts.length - 1];
    }
  } catch {}
  
  // Fallback to folder name
  return path.basename(projectRoot);
}

async function getProjectDescription(projectRoot: string): Promise<string | undefined> {
  // Try package.json
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.description) return pkg.description;
  } catch {}
  
  // Try README
  try {
    const readmePath = path.join(projectRoot, 'README.md');
    const content = await fs.readFile(readmePath, 'utf-8');
    
    // Get first paragraph after title
    const lines = content.split('\n');
    let foundTitle = false;
    let description = '';
    
    for (const line of lines) {
      if (line.startsWith('#')) {
        foundTitle = true;
        continue;
      }
      if (foundTitle && line.trim()) {
        description = line.trim();
        break;
      }
    }
    
    if (description && description.length < 300) {
      return description;
    }
  } catch {}
  
  return undefined;
}

async function getProjectVersion(projectRoot: string): Promise<string | undefined> {
  // Try package.json
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.version) return pkg.version;
  } catch {}
  
  // Try Cargo.toml
  try {
    const cargoPath = path.join(projectRoot, 'Cargo.toml');
    const content = await fs.readFile(cargoPath, 'utf-8');
    const match = content.match(/version\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {}
  
  return undefined;
}

export async function refreshContext(projectRoot: string): Promise<ProjectContext> {
  const cache = new CacheManager(projectRoot);
  await cache.invalidate();
  return getFullContext(projectRoot, true);
}
