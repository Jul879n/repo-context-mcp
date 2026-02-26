import * as fs from 'fs/promises';
import * as path from 'path';
import { Model, ModelField, ModelsInfo, Language } from '../types/index.js';

// Patterns for detecting models/types by language
const MODEL_PATTERNS: Record<Language, RegExp[]> = {
  typescript: [
    // Interface
    /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+\w+)?\s*\{([^}]+)\}/gs,
    // Type alias with object
    /(?:export\s+)?type\s+(\w+)\s*=\s*\{([^}]+)\}/gs,
    // Class
    /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+\w+)?\s*\{/gs,
    // Enum
    /(?:export\s+)?enum\s+(\w+)\s*\{([^}]+)\}/gs,
  ],
  javascript: [
    // JSDoc @typedef
    /@typedef\s*\{Object\}\s*(\w+)/g,
    // Class
    /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?\s*\{/gs,
  ],
  python: [
    // Pydantic BaseModel
    /class\s+(\w+)\s*\(\s*(?:BaseModel|Base)\s*\)\s*:/gs,
    // Dataclass
    /@dataclass\s*\n\s*class\s+(\w+)/gs,
    // SQLAlchemy Model
    /class\s+(\w+)\s*\(\s*(?:Base|db\.Model)\s*\)\s*:/gs,
    // TypedDict
    /class\s+(\w+)\s*\(\s*TypedDict\s*\)\s*:/gs,
  ],
  rust: [
    // Struct
    /(?:pub\s+)?struct\s+(\w+)(?:<[^>]+>)?\s*\{([^}]+)\}/gs,
    // Enum
    /(?:pub\s+)?enum\s+(\w+)(?:<[^>]+>)?\s*\{([^}]+)\}/gs,
  ],
  go: [
    // Struct
    /type\s+(\w+)\s+struct\s*\{([^}]+)\}/gs,
  ],
  java: [
    // Class/Entity
    /(?:@Entity\s+)?(?:public\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/gs,
    // Record
    /(?:public\s+)?record\s+(\w+)\s*\(([^)]+)\)/gs,
  ],
  kotlin: [
    // Data class
    /data\s+class\s+(\w+)\s*\(([^)]+)\)/gs,
    // Class
    /(?:open\s+)?class\s+(\w+)(?:\s*:\s*\w+)?\s*\{/gs,
  ],
  csharp: [
    // Class
    /(?:public\s+)?(?:partial\s+)?class\s+(\w+)(?:\s*:\s*[\w,\s]+)?\s*\{/gs,
    // Record
    /(?:public\s+)?record\s+(\w+)\s*\(([^)]+)\)/gs,
  ],
  php: [
    // Class
    /(?:final\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/gs,
  ],
  ruby: [
    // Class with ActiveRecord
    /class\s+(\w+)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base)/gs,
  ],
  swift: [
    // Struct
    /struct\s+(\w+)(?:\s*:\s*[\w,\s]+)?\s*\{/gs,
    // Class
    /(?:final\s+)?class\s+(\w+)(?:\s*:\s*[\w,\s]+)?\s*\{/gs,
  ],
  dart: [
    // Class
    /class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?(?:\s+with\s+[\w,\s]+)?\s*\{/gs,
  ],
  unknown: [],
};

// Field extraction patterns
const FIELD_PATTERNS: Record<Language, RegExp> = {
  typescript: /(\w+)(\?)?:\s*([^;,\n]+)/g,
  javascript: /(\w+):\s*([^,\n]+)/g,
  python: /(\w+):\s*(\w+(?:\[[\w,\s]+\])?)/g,
  rust: /(?:pub\s+)?(\w+):\s*([^,\n]+)/g,
  go: /(\w+)\s+(\S+)/g,
  java: /(?:private|public|protected)?\s*(\w+)\s+(\w+)\s*[;=]/g,
  kotlin: /(?:val|var)\s+(\w+):\s*(\w+)/g,
  csharp: /(?:public|private|protected)?\s*(\w+)\s+(\w+)\s*\{/g,
  php: /(?:public|private|protected)?\s*\$(\w+)/g,
  ruby: /attr_(?:accessor|reader|writer)\s+:(\w+)/g,
  swift: /(?:var|let)\s+(\w+):\s*(\w+)/g,
  dart: /(?:final\s+)?(\w+)\s+(\w+)\s*[;,]/g,
  unknown: /(\w+)/g,
};

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'venv', '.venv', 'env', '.env',
  'target', 'build', 'dist', 'out', '.git', '__pycache__',
  '.next', '.nuxt', '.svelte-kit', 'coverage', '.cache',
  'migrations', '__tests__', 'test', 'tests', 'spec',
]);

// Files that typically contain models
const MODEL_DIRS = [
  'models', 'entities', 'schemas', 'types', 'interfaces',
  'domain', 'dto', 'dtos', 'model', 'entity', 'schema',
];

const EXTENSIONS: Record<Language, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx'],
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

export async function detectModels(
  projectRoot: string,
  language: Language
): Promise<ModelsInfo> {
  const models: Model[] = [];
  const patterns = MODEL_PATTERNS[language] || [];
  const extensions = EXTENSIONS[language] || [];
  
  if (patterns.length === 0 || extensions.length === 0) {
    return { models: [] };
  }
  
  // First, prioritize model directories
  for (const modelDir of MODEL_DIRS) {
    const dirPath = path.join(projectRoot, modelDir);
    await scanDirectory(dirPath, extensions, patterns, language, models, projectRoot);
    
    // Also check in src/
    const srcDirPath = path.join(projectRoot, 'src', modelDir);
    await scanDirectory(srcDirPath, extensions, patterns, language, models, projectRoot);
    
    // And app/
    const appDirPath = path.join(projectRoot, 'app', modelDir);
    await scanDirectory(appDirPath, extensions, patterns, language, models, projectRoot);
  }
  
  // If no models found in typical dirs, scan more broadly but limit depth
  if (models.length === 0) {
    await scanDirectory(projectRoot, extensions, patterns, language, models, projectRoot, 0, 3);
  }
  
  // Detect ORM
  const ormUsed = await detectORM(projectRoot, language);
  
  return {
    models: deduplicateModels(models),
    ormUsed,
  };
}

async function scanDirectory(
  dir: string,
  extensions: string[],
  patterns: RegExp[],
  language: Language,
  models: Model[],
  projectRoot: string,
  depth = 0,
  maxDepth = 5
): Promise<void> {
  if (depth > maxDepth) return;
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await scanDirectory(fullPath, extensions, patterns, language, models, projectRoot, depth + 1, maxDepth);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          await scanFile(fullPath, patterns, language, models, projectRoot);
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
}

async function scanFile(
  filePath: string,
  patterns: RegExp[],
  language: Language,
  models: Model[],
  projectRoot: string
): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const relativePath = path.relative(projectRoot, filePath);
    
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        const body = match[2] || '';
        
        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        
        // Determine model type
        const type = determineModelType(match[0], language);
        
        // Extract fields
        const fields = extractFields(body, language);
        
        models.push({
          name,
          type,
          file: relativePath,
          line: lineNumber,
          fields,
        });
      }
    }
  } catch {
    // Ignore errors
  }
}

function determineModelType(matchStr: string, language: Language): Model['type'] {
  const lower = matchStr.toLowerCase();
  
  if (lower.includes('interface')) return 'interface';
  if (lower.includes('type ') && !lower.includes('typedef')) return 'type';
  if (lower.includes('enum')) return 'enum';
  if (lower.includes('struct')) return 'struct';
  if (lower.includes('class')) return 'class';
  if (lower.includes('record')) return 'schema';
  if (lower.includes('basemodel') || lower.includes('schema')) return 'schema';
  if (lower.includes('model')) return 'model';
  
  return 'class';
}

function extractFields(body: string, language: Language): ModelField[] {
  const fields: ModelField[] = [];
  const pattern = FIELD_PATTERNS[language];
  
  if (!pattern || !body) return fields;
  
  pattern.lastIndex = 0;
  
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1];
    const optional = match[2] === '?';
    const type = match[3] || match[2] || 'unknown';
    
    // Skip common non-field patterns
    if (isCommonKeyword(name)) continue;
    
    fields.push({
      name,
      type: type.trim(),
      required: !optional,
    });
  }
  
  return fields;
}

function isCommonKeyword(name: string): boolean {
  const keywords = new Set([
    'constructor', 'function', 'return', 'if', 'else', 'for', 'while',
    'class', 'interface', 'type', 'export', 'import', 'from', 'const',
    'let', 'var', 'public', 'private', 'protected', 'static', 'readonly',
    'async', 'await', 'try', 'catch', 'finally', 'throw', 'new', 'this',
    'super', 'extends', 'implements', 'get', 'set', 'def', 'self', 'fn',
    'pub', 'mut', 'impl', 'trait', 'use', 'mod', 'crate',
  ]);
  
  return keywords.has(name.toLowerCase());
}

async function detectORM(projectRoot: string, language: Language): Promise<string | undefined> {
  try {
    if (language === 'typescript' || language === 'javascript') {
      const pkgPath = path.join(projectRoot, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      if (allDeps['prisma'] || allDeps['@prisma/client']) return 'Prisma';
      if (allDeps['typeorm']) return 'TypeORM';
      if (allDeps['sequelize']) return 'Sequelize';
      if (allDeps['mongoose']) return 'Mongoose';
      if (allDeps['drizzle-orm']) return 'Drizzle';
      if (allDeps['knex']) return 'Knex';
    } else if (language === 'python') {
      const reqPath = path.join(projectRoot, 'requirements.txt');
      const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
      
      let content = '';
      try {
        content = await fs.readFile(reqPath, 'utf-8');
      } catch {
        content = await fs.readFile(pyprojectPath, 'utf-8');
      }
      
      if (content.includes('sqlalchemy')) return 'SQLAlchemy';
      if (content.includes('django')) return 'Django ORM';
      if (content.includes('tortoise')) return 'Tortoise ORM';
      if (content.includes('peewee')) return 'Peewee';
    } else if (language === 'rust') {
      const cargoPath = path.join(projectRoot, 'Cargo.toml');
      const content = await fs.readFile(cargoPath, 'utf-8');
      
      if (content.includes('diesel')) return 'Diesel';
      if (content.includes('sea-orm')) return 'SeaORM';
      if (content.includes('sqlx')) return 'SQLx';
    } else if (language === 'go') {
      const goModPath = path.join(projectRoot, 'go.mod');
      const content = await fs.readFile(goModPath, 'utf-8');
      
      if (content.includes('gorm')) return 'GORM';
      if (content.includes('ent')) return 'Ent';
      if (content.includes('sqlx')) return 'sqlx';
    }
  } catch {
    // Ignore
  }
  
  return undefined;
}

function deduplicateModels(models: Model[]): Model[] {
  const seen = new Set<string>();
  return models.filter(m => {
    const key = `${m.name}:${m.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
