/**
 * Ultra-compact formatters for minimal token usage
 * Target: <300 tokens for full context
 */

import { ProjectContext } from '../types/index.js';

/**
 * Ultra-compact summary (~100-150 tokens)
 * Better than CLAUDE.md because it's dynamic and always accurate
 */
export function formatUltraCompact(ctx: ProjectContext): string {
  const lines: string[] = [];
  
  // Single line header: name|lang|framework
  const fw = ctx.stack.frameworks[0]?.name || '';
  lines.push(`${ctx.name}|${ctx.stack.primaryLanguage}${fw ? '|' + fw : ''}`);
  
  // Structure: folder:count pairs (compact)
  const folders = ctx.structure.folders
    .slice(0, 8)
    .map(f => `${f.path}:${f.fileCount}`)
    .join(' ');
  if (folders) lines.push(`[${folders}]`);
  
  // Entry points (just files)
  if (ctx.structure.entryPoints.length > 0) {
    lines.push(`→${ctx.structure.entryPoints.slice(0, 3).join(',')}`);
  }
  
  // Endpoints count + sample
  if (ctx.endpoints && ctx.endpoints.endpoints.length > 0) {
    const sample = ctx.endpoints.endpoints.slice(0, 3)
      .map(e => `${e.method[0]}:${e.path}`)
      .join(' ');
    lines.push(`API(${ctx.endpoints.endpoints.length}):${sample}`);
  }
  
  // Models count + names
  if (ctx.models && ctx.models.models.length > 0) {
    const names = ctx.models.models.slice(0, 5).map(m => m.name).join(',');
    lines.push(`M(${ctx.models.models.length}):${names}`);
  }
  
  // Status icons: 📝docs ✅tests 🐳docker 🔄ci
  const status: string[] = [];
  if (ctx.status.hasDocumentation) status.push('docs');
  if (ctx.status.tests.testFiles > 0) status.push(`test:${ctx.status.tests.testFiles}`);
  if (ctx.status.hasDocker) status.push('docker');
  if (ctx.status.hasCI) status.push(`ci:${ctx.status.ciPlatform}`);
  if (status.length > 0) lines.push(`[${status.join('|')}]`);
  
  return lines.join('\n');
}

/**
 * Compact format (~200-300 tokens)
 * Structured but minimal
 */
export function formatCompact(ctx: ProjectContext): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`# ${ctx.name} (${ctx.stack.primaryLanguage})`);
  if (ctx.description) {
    lines.push(ctx.description.slice(0, 100));
  }
  
  // Stack (one line)
  const stackParts: string[] = [ctx.stack.primaryLanguage];
  if (ctx.stack.frameworks.length > 0) {
    stackParts.push(...ctx.stack.frameworks.slice(0, 3).map(f => f.name));
  }
  if (ctx.stack.packageManager) stackParts.push(ctx.stack.packageManager);
  lines.push(`Stack: ${stackParts.join(', ')}`);
  
  // Key deps (one line, max 5)
  const deps = ctx.stack.dependencies
    .filter(d => !d.dev)
    .slice(0, 5)
    .map(d => d.name);
  if (deps.length > 0) {
    lines.push(`Deps: ${deps.join(', ')}`);
  }
  
  // Structure (compact table)
  lines.push('\nStructure:');
  for (const folder of ctx.structure.folders.slice(0, 10)) {
    lines.push(`  ${folder.path}/ (${folder.fileCount}) - ${folder.description.slice(0, 30)}`);
  }
  
  // Entry points
  if (ctx.structure.entryPoints.length > 0) {
    lines.push(`Entry: ${ctx.structure.entryPoints.join(', ')}`);
  }
  
  // Endpoints (if any)
  if (ctx.endpoints && ctx.endpoints.endpoints.length > 0) {
    lines.push(`\nAPI (${ctx.endpoints.endpoints.length}):`);
    for (const ep of ctx.endpoints.endpoints.slice(0, 10)) {
      lines.push(`  ${ep.method} ${ep.path} → ${ep.file}:${ep.line}`);
    }
    if (ctx.endpoints.endpoints.length > 10) {
      lines.push(`  ...+${ctx.endpoints.endpoints.length - 10} more`);
    }
  }
  
  // Models (if any)
  if (ctx.models && ctx.models.models.length > 0) {
    lines.push(`\nModels (${ctx.models.models.length}):`);
    for (const m of ctx.models.models.slice(0, 8)) {
      const fields = m.fields.slice(0, 3).map(f => f.name).join(', ');
      lines.push(`  ${m.name} (${m.type}): ${fields}${m.fields.length > 3 ? '...' : ''}`);
    }
  }
  
  // Status (one line)
  const statusParts: string[] = [];
  statusParts.push(`tests:${ctx.status.tests.testFiles}`);
  if (ctx.status.hasDocker) statusParts.push('docker');
  if (ctx.status.hasCI) statusParts.push(`ci:${ctx.status.ciPlatform}`);
  if (ctx.status.todos.length > 0) statusParts.push(`todos:${ctx.status.todos.length}`);
  lines.push(`\nStatus: ${statusParts.join(' | ')}`);
  
  return lines.join('\n');
}

/**
 * Minimal format for resource embedding (~50 tokens)
 * Just the essentials for context awareness
 */
export function formatMinimal(ctx: ProjectContext): string {
  const fw = ctx.stack.frameworks[0]?.name || '';
  const folders = ctx.structure.folders.slice(0, 5).map(f => f.path).join('/');
  
  return `${ctx.name}:${ctx.stack.primaryLanguage}${fw ? '+' + fw : ''} [${folders}] entry:${ctx.structure.entryPoints[0] || 'N/A'}`;
}

/**
 * JSON-like compact format for programmatic use
 */
export function formatJSON(ctx: ProjectContext): string {
  return JSON.stringify({
    name: ctx.name,
    lang: ctx.stack.primaryLanguage,
    fw: ctx.stack.frameworks.map(f => f.name),
    dirs: ctx.structure.folders.map(f => f.path),
    entry: ctx.structure.entryPoints,
    api: ctx.endpoints?.endpoints.length || 0,
    models: ctx.models?.models.map(m => m.name) || [],
    tests: ctx.status.tests.testFiles,
  });
}
