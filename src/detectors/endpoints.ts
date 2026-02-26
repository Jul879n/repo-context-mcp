import * as fs from 'fs/promises';
import * as path from 'path';
import { Endpoint, EndpointsInfo, HttpMethod, Language } from '../types/index.js';

// Patterns for detecting endpoints by framework
const ENDPOINT_PATTERNS: Record<string, RegExp[]> = {
  // Express.js / Node.js
  express: [
    /(?:app|router)\.(get|post|put|patch|delete|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /(?:app|router)\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.(get|post|put|patch|delete)/gi,
  ],
  
  // Fastify
  fastify: [
    /fastify\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /\.route\s*\(\s*\{[^}]*method:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`][^}]*url:\s*['"`]([^'"`]+)['"`]/gi,
  ],
  
  // Hono
  hono: [
    /(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  ],
  
  // NestJS
  nestjs: [
    /@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(\s*['"`]?([^'"`\)]*?)['"`]?\s*\)/gi,
  ],
  
  // FastAPI (Python)
  fastapi: [
    /@(?:app|router)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  ],
  
  // Flask (Python)
  flask: [
    /@(?:app|blueprint|bp)\.(route|get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /@(?:app|blueprint|bp)\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*methods\s*=\s*\[([^\]]+)\]/gi,
  ],
  
  // Django (Python)
  django: [
    /path\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /url\s*\(\s*r?['"`]\^?([^'"`$]+)/gi,
  ],
  
  // Gin (Go)
  gin: [
    /(?:r|router|group|g)\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  ],
  
  // Echo (Go)
  echo: [
    /(?:e|echo|g|group)\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  ],
  
  // Fiber (Go)
  fiber: [
    /(?:app|router|group)\.(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  ],
  
  // Actix (Rust)
  actix: [
    /#\[(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\]/gi,
    /\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*web::(get|post|put|patch|delete)/gi,
  ],
  
  // Axum (Rust)
  axum: [
    /\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:get|post|put|patch|delete)\s*\(/gi,
  ],
  
  // Laravel (PHP)
  laravel: [
    /Route::(get|post|put|patch|delete|options|any)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  ],
  
  // Spring (Java)
  spring: [
    /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?['"`]?([^'"`\)]+)['"`]?\s*\)/gi,
  ],
  
  // Rails (Ruby)
  rails: [
    /(get|post|put|patch|delete)\s+['"`]([^'"`]+)['"`]/gi,
    /resources?\s+:(\w+)/gi,
  ],
};

// File extensions to scan for each language
const SCAN_EXTENSIONS: Record<Language, string[]> = {
  javascript: ['.js', '.mjs', '.cjs'],
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  python: ['.py'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  kotlin: ['.kt'],
  csharp: ['.cs'],
  php: ['.php'],
  ruby: ['.rb'],
  swift: ['.swift'],
  dart: ['.dart'],
  unknown: [],
};

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'venv', '.venv', 'env', '.env',
  'target', 'build', 'dist', 'out', '.git', '__pycache__',
  '.next', '.nuxt', '.svelte-kit', 'coverage', '.cache',
]);

export async function detectEndpoints(
  projectRoot: string, 
  language: Language,
  frameworks: string[]
): Promise<EndpointsInfo> {
  const endpoints: Endpoint[] = [];
  const extensions = SCAN_EXTENSIONS[language] || [];
  
  // Determine which patterns to use based on frameworks
  const patternsToUse: RegExp[] = [];
  
  for (const framework of frameworks) {
    const frameworkLower = framework.toLowerCase();
    for (const [name, patterns] of Object.entries(ENDPOINT_PATTERNS)) {
      if (frameworkLower.includes(name) || name.includes(frameworkLower)) {
        patternsToUse.push(...patterns);
      }
    }
  }
  
  // Fallback: use common patterns for the language
  if (patternsToUse.length === 0) {
    if (language === 'javascript' || language === 'typescript') {
      patternsToUse.push(...ENDPOINT_PATTERNS.express);
      patternsToUse.push(...ENDPOINT_PATTERNS.fastify);
      patternsToUse.push(...ENDPOINT_PATTERNS.hono);
      patternsToUse.push(...ENDPOINT_PATTERNS.nestjs);
    } else if (language === 'python') {
      patternsToUse.push(...ENDPOINT_PATTERNS.fastapi);
      patternsToUse.push(...ENDPOINT_PATTERNS.flask);
      patternsToUse.push(...ENDPOINT_PATTERNS.django);
    } else if (language === 'go') {
      patternsToUse.push(...ENDPOINT_PATTERNS.gin);
      patternsToUse.push(...ENDPOINT_PATTERNS.echo);
      patternsToUse.push(...ENDPOINT_PATTERNS.fiber);
    } else if (language === 'rust') {
      patternsToUse.push(...ENDPOINT_PATTERNS.actix);
      patternsToUse.push(...ENDPOINT_PATTERNS.axum);
    } else if (language === 'php') {
      patternsToUse.push(...ENDPOINT_PATTERNS.laravel);
    } else if (language === 'java' || language === 'kotlin') {
      patternsToUse.push(...ENDPOINT_PATTERNS.spring);
    } else if (language === 'ruby') {
      patternsToUse.push(...ENDPOINT_PATTERNS.rails);
    }
  }
  
  if (patternsToUse.length === 0 || extensions.length === 0) {
    return { type: 'rest', endpoints: [] };
  }
  
  // Scan files
  await scanDirectory(projectRoot, extensions, patternsToUse, endpoints, projectRoot);
  
  // Determine API type
  let apiType: EndpointsInfo['type'] = 'rest';
  // Could add GraphQL detection here
  
  return {
    type: apiType,
    endpoints: deduplicateEndpoints(endpoints),
  };
}

async function scanDirectory(
  dir: string,
  extensions: string[],
  patterns: RegExp[],
  endpoints: Endpoint[],
  projectRoot: string,
  depth = 0
): Promise<void> {
  if (depth > 10) return;
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await scanDirectory(fullPath, extensions, patterns, endpoints, projectRoot, depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          await scanFile(fullPath, patterns, endpoints, projectRoot);
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

async function scanFile(
  filePath: string,
  patterns: RegExp[],
  endpoints: Endpoint[],
  projectRoot: string
): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const relativePath = path.relative(projectRoot, filePath);
    
    for (const pattern of patterns) {
      // Reset regex state
      pattern.lastIndex = 0;
      
      let match;
      while ((match = pattern.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        
        // Extract method and path based on capture groups
        let method: string;
        let routePath: string;
        
        // Different patterns have different capture group orders
        if (match[1] && match[2]) {
          // Check if first group looks like a method
          if (isHttpMethod(match[1])) {
            method = match[1].toUpperCase();
            routePath = match[2];
          } else {
            // Path is first, method is second (e.g., route pattern)
            routePath = match[1];
            method = match[2].toUpperCase();
          }
        } else if (match[1]) {
          // Only one capture group - likely just the path
          routePath = match[1];
          method = 'GET'; // Default
        } else {
          continue;
        }
        
        // Clean up the path
        routePath = cleanPath(routePath);
        
        if (routePath) {
          endpoints.push({
            method: normalizeMethod(method),
            path: routePath,
            file: relativePath,
            line: lineNumber,
          });
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

function isHttpMethod(str: string): boolean {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'];
  return methods.includes(str.toLowerCase());
}

function normalizeMethod(method: string): HttpMethod {
  const upper = method.toUpperCase();
  const validMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL'];
  
  // Handle mapping decorator names to methods
  const mappings: Record<string, HttpMethod> = {
    'GETMAPPING': 'GET',
    'POSTMAPPING': 'POST',
    'PUTMAPPING': 'PUT',
    'PATCHMAPPING': 'PATCH',
    'DELETEMAPPING': 'DELETE',
    'REQUESTMAPPING': 'ALL',
  };
  
  if (mappings[upper]) {
    return mappings[upper];
  }
  
  return validMethods.includes(upper as HttpMethod) ? upper as HttpMethod : 'GET';
}

function cleanPath(routePath: string): string {
  return routePath
    .trim()
    .replace(/^['"`]|['"`]$/g, '') // Remove quotes
    .replace(/\s+/g, '') // Remove whitespace
    .replace(/^\^|\$$/g, ''); // Remove regex anchors
}

function deduplicateEndpoints(endpoints: Endpoint[]): Endpoint[] {
  const seen = new Set<string>();
  return endpoints.filter(ep => {
    const key = `${ep.method}:${ep.path}:${ep.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
