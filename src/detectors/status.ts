import * as fs from 'fs/promises';
import * as path from 'path';
import { StatusInfo, TodoItem, TestInfo } from '../types/index.js';

// TODO patterns
const TODO_PATTERNS = [
  /\/\/\s*TODO:?\s*(.+)/gi,
  /\/\*\s*TODO:?\s*(.+)\*\//gi,
  /#\s*TODO:?\s*(.+)/gi,
  /--\s*TODO:?\s*(.+)/gi,
  /\/\/\s*FIXME:?\s*(.+)/gi,
  /\/\/\s*HACK:?\s*(.+)/gi,
  /\/\/\s*XXX:?\s*(.+)/gi,
  /\/\/\s*BUG:?\s*(.+)/gi,
];

// Source file extensions to scan for TODOs
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.rs',
  '.go',
  '.java', '.kt', '.kts',
  '.cs',
  '.php',
  '.rb',
  '.swift',
  '.dart',
  '.c', '.cpp', '.h', '.hpp',
  '.vue', '.svelte',
]);

// Skip directories
const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'venv', '.venv', 'env', '.env',
  'target', 'build', 'dist', 'out', '.git', '__pycache__',
  '.next', '.nuxt', '.svelte-kit', 'coverage', '.cache',
]);

// Test framework detection
const TEST_FRAMEWORKS: Record<string, { files: string[]; configPatterns: RegExp[] }> = {
  'Jest': {
    files: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs'],
    configPatterns: [/"jest":\s*\{/],
  },
  'Vitest': {
    files: ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs'],
    configPatterns: [/vitest/],
  },
  'Mocha': {
    files: ['.mocharc.js', '.mocharc.json', '.mocharc.yaml', '.mocharc.yml'],
    configPatterns: [/"mocha":/],
  },
  'Pytest': {
    files: ['pytest.ini', 'pyproject.toml', 'conftest.py'],
    configPatterns: [/\[tool\.pytest/],
  },
  'Go Test': {
    files: [],
    configPatterns: [],
  },
  'Cargo Test': {
    files: ['Cargo.toml'],
    configPatterns: [/\[dev-dependencies\]/],
  },
  'JUnit': {
    files: [],
    configPatterns: [/junit/i],
  },
  'PHPUnit': {
    files: ['phpunit.xml', 'phpunit.xml.dist'],
    configPatterns: [],
  },
  'RSpec': {
    files: ['.rspec', 'spec/spec_helper.rb'],
    configPatterns: [],
  },
  'XCTest': {
    files: [],
    configPatterns: [],
  },
};

// CI platforms
const CI_PLATFORMS: Record<string, string[]> = {
  'GitHub Actions': ['.github/workflows'],
  'GitLab CI': ['.gitlab-ci.yml'],
  'CircleCI': ['.circleci/config.yml', '.circleci'],
  'Travis CI': ['.travis.yml'],
  'Jenkins': ['Jenkinsfile'],
  'Azure Pipelines': ['azure-pipelines.yml'],
  'Bitbucket Pipelines': ['bitbucket-pipelines.yml'],
};

export async function detectStatus(projectRoot: string): Promise<StatusInfo> {
  const todos = await scanForTodos(projectRoot);
  const tests = await detectTestFramework(projectRoot);
  const { hasCI, ciPlatform } = await detectCI(projectRoot);
  const hasDocker = await detectDocker(projectRoot);
  const hasDocumentation = await detectDocumentation(projectRoot);
  
  return {
    todos,
    tests,
    hasCI,
    ciPlatform,
    hasDocker,
    hasDocumentation,
  };
}

async function scanForTodos(projectRoot: string, maxTodos = 50): Promise<TodoItem[]> {
  const todos: TodoItem[] = [];
  
  await scanDirectoryForTodos(projectRoot, projectRoot, todos, maxTodos);
  
  // Sort by priority (FIXME and BUG first)
  todos.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return (priorityOrder[a.priority || 'low'] || 2) - (priorityOrder[b.priority || 'low'] || 2);
  });
  
  return todos.slice(0, maxTodos);
}

async function scanDirectoryForTodos(
  dir: string,
  projectRoot: string,
  todos: TodoItem[],
  maxTodos: number,
  depth = 0
): Promise<void> {
  if (depth > 8 || todos.length >= maxTodos) return;
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (todos.length >= maxTodos) break;
      if (entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await scanDirectoryForTodos(fullPath, projectRoot, todos, maxTodos, depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          await scanFileForTodos(fullPath, projectRoot, todos, maxTodos);
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

async function scanFileForTodos(
  filePath: string,
  projectRoot: string,
  todos: TodoItem[],
  maxTodos: number
): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const relativePath = path.relative(projectRoot, filePath);
    
    for (let i = 0; i < lines.length && todos.length < maxTodos; i++) {
      const line = lines[i];
      
      for (const pattern of TODO_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        
        if (match) {
          const text = match[1].trim();
          const priority = determinePriority(line);
          
          todos.push({
            text: text.substring(0, 200), // Limit length
            file: relativePath,
            line: i + 1,
            priority,
          });
          
          break; // Only count one TODO per line
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

function determinePriority(line: string): 'high' | 'medium' | 'low' {
  const upper = line.toUpperCase();
  
  if (upper.includes('FIXME') || upper.includes('BUG') || upper.includes('CRITICAL')) {
    return 'high';
  }
  if (upper.includes('HACK') || upper.includes('XXX') || upper.includes('IMPORTANT')) {
    return 'medium';
  }
  return 'low';
}

async function detectTestFramework(projectRoot: string): Promise<TestInfo> {
  let framework: string | undefined;
  let testFiles = 0;
  let hasConfig = false;
  
  // Check for test framework config files
  try {
    const files = await fs.readdir(projectRoot);
    
    for (const [name, info] of Object.entries(TEST_FRAMEWORKS)) {
      for (const configFile of info.files) {
        if (files.includes(configFile) || files.includes(path.basename(configFile))) {
          framework = name;
          hasConfig = true;
          break;
        }
      }
      if (framework) break;
    }
    
    // Check package.json for test config
    if (!framework) {
      try {
        const pkgPath = path.join(projectRoot, 'package.json');
        const content = await fs.readFile(pkgPath, 'utf-8');
        
        if (content.includes('"jest"') || content.includes('"@jest/')) {
          framework = 'Jest';
          hasConfig = true;
        } else if (content.includes('vitest')) {
          framework = 'Vitest';
          hasConfig = true;
        } else if (content.includes('mocha')) {
          framework = 'Mocha';
          hasConfig = true;
        }
      } catch {
        // No package.json
      }
    }
    
    // Count test files
    testFiles = await countTestFiles(projectRoot);
    
    // Infer framework from test files if not detected
    if (!framework && testFiles > 0) {
      const files = await fs.readdir(projectRoot, { recursive: false });
      
      if (await fileExists(path.join(projectRoot, 'Cargo.toml'))) {
        framework = 'Cargo Test';
      } else if (await fileExists(path.join(projectRoot, 'go.mod'))) {
        framework = 'Go Test';
      } else if (await fileExists(path.join(projectRoot, 'conftest.py')) || 
                 await fileExists(path.join(projectRoot, 'tests', 'conftest.py'))) {
        framework = 'Pytest';
      }
    }
    
  } catch {
    // Ignore errors
  }
  
  return {
    framework,
    testFiles,
    hasConfig,
  };
}

async function countTestFiles(projectRoot: string): Promise<number> {
  let count = 0;
  
  const testPatterns = [
    /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/,
    /\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/,
    /_test\.(go|py|rb)$/,
    /test_\w+\.py$/,
    /Tests?\.java$/,
    /Tests?\.kt$/,
    /Tests?\.cs$/,
  ];
  
  const testDirs = ['test', 'tests', '__tests__', 'spec', 'specs'];
  
  // Check test directories
  for (const dir of testDirs) {
    const testDir = path.join(projectRoot, dir);
    try {
      count += await countFilesRecursive(testDir);
    } catch {
      // Directory doesn't exist
    }
    
    // Also in src/
    const srcTestDir = path.join(projectRoot, 'src', dir);
    try {
      count += await countFilesRecursive(srcTestDir);
    } catch {
      // Directory doesn't exist
    }
  }
  
  // Count test files in src directory
  try {
    const srcPath = path.join(projectRoot, 'src');
    count += await countTestFilesInDir(srcPath, testPatterns);
  } catch {
    // No src directory
  }
  
  return count;
}

async function countFilesRecursive(dir: string, depth = 0): Promise<number> {
  if (depth > 5) return 0;
  
  let count = 0;
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      
      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        count += await countFilesRecursive(path.join(dir, entry.name), depth + 1);
      }
    }
  } catch {
    // Ignore errors
  }
  
  return count;
}

async function countTestFilesInDir(dir: string, patterns: RegExp[], depth = 0): Promise<number> {
  if (depth > 5) return 0;
  
  let count = 0;
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      
      if (entry.isFile()) {
        for (const pattern of patterns) {
          if (pattern.test(entry.name)) {
            count++;
            break;
          }
        }
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        count += await countTestFilesInDir(path.join(dir, entry.name), patterns, depth + 1);
      }
    }
  } catch {
    // Ignore errors
  }
  
  return count;
}

async function detectCI(projectRoot: string): Promise<{ hasCI: boolean; ciPlatform?: string }> {
  try {
    const entries = await fs.readdir(projectRoot);
    
    for (const [platform, files] of Object.entries(CI_PLATFORMS)) {
      for (const file of files) {
        const filePath = path.join(projectRoot, file);
        if (await fileExists(filePath)) {
          return { hasCI: true, ciPlatform: platform };
        }
      }
    }
  } catch {
    // Ignore errors
  }
  
  return { hasCI: false };
}

async function detectDocker(projectRoot: string): Promise<boolean> {
  const dockerFiles = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'];
  
  try {
    const entries = await fs.readdir(projectRoot);
    
    for (const file of dockerFiles) {
      if (entries.includes(file)) {
        return true;
      }
    }
    
    // Check for Dockerfile with suffix
    for (const entry of entries) {
      if (entry.startsWith('Dockerfile')) {
        return true;
      }
    }
  } catch {
    // Ignore errors
  }
  
  return false;
}

async function detectDocumentation(projectRoot: string): Promise<boolean> {
  const docIndicators = [
    'README.md', 'README.rst', 'README.txt', 'README',
    'docs', 'documentation', 'doc',
    'CONTRIBUTING.md', 'CHANGELOG.md', 'HISTORY.md',
    'wiki', 'API.md',
  ];
  
  try {
    const entries = await fs.readdir(projectRoot);
    
    for (const indicator of docIndicators) {
      if (entries.includes(indicator)) {
        return true;
      }
    }
  } catch {
    // Ignore errors
  }
  
  return false;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
