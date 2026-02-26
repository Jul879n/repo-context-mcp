import * as fs from 'fs/promises';
import * as path from 'path';
import { ArchitectureInfo, ArchitecturePattern } from '../types/index.js';

// Patterns that suggest architectural styles
const ARCHITECTURE_INDICATORS: Record<ArchitecturePattern, {
  dirs: string[];
  files: string[];
  keywords: string[];
}> = {
  'clean-architecture': {
    dirs: ['domain', 'usecases', 'use-cases', 'application', 'infrastructure', 'adapters', 'ports'],
    files: [],
    keywords: ['usecase', 'repository', 'gateway', 'presenter'],
  },
  'hexagonal': {
    dirs: ['ports', 'adapters', 'domain', 'application', 'infrastructure'],
    files: [],
    keywords: ['port', 'adapter', 'driven', 'driving'],
  },
  'mvc': {
    dirs: ['models', 'views', 'controllers', 'model', 'view', 'controller'],
    files: [],
    keywords: ['controller', 'view', 'model'],
  },
  'mvvm': {
    dirs: ['models', 'views', 'viewmodels', 'view-models'],
    files: [],
    keywords: ['viewmodel', 'binding', 'observable'],
  },
  'layered': {
    dirs: ['presentation', 'business', 'data', 'dal', 'bll', 'ui', 'services', 'repositories'],
    files: [],
    keywords: ['service', 'repository', 'layer'],
  },
  'microservices': {
    dirs: ['services', 'microservices', 'apps'],
    files: ['docker-compose.yml', 'docker-compose.yaml', 'kubernetes', 'k8s'],
    keywords: ['service', 'gateway', 'messaging'],
  },
  'serverless': {
    dirs: ['functions', 'lambdas', 'handlers'],
    files: ['serverless.yml', 'serverless.yaml', 'netlify.toml', 'vercel.json', 'sst.config.ts'],
    keywords: ['handler', 'lambda', 'function'],
  },
  'event-driven': {
    dirs: ['events', 'handlers', 'listeners', 'subscribers', 'sagas'],
    files: [],
    keywords: ['event', 'handler', 'subscriber', 'publish', 'emit'],
  },
  'monolith': {
    dirs: [],
    files: [],
    keywords: [],
  },
  'unknown': {
    dirs: [],
    files: [],
    keywords: [],
  },
};

// Common folder descriptions
const FOLDER_PURPOSES: Record<string, string> = {
  'src': 'Source code',
  'lib': 'Library code',
  'app': 'Application code',
  'api': 'API endpoints',
  'pages': 'Page components/routes',
  'components': 'UI components',
  'hooks': 'Custom hooks',
  'utils': 'Utility functions',
  'helpers': 'Helper functions',
  'services': 'Business logic/services',
  'controllers': 'Request handlers',
  'models': 'Data models',
  'entities': 'Domain entities',
  'schemas': 'Data schemas',
  'types': 'Type definitions',
  'interfaces': 'Interface definitions',
  'domain': 'Domain logic',
  'usecases': 'Use cases/application logic',
  'repositories': 'Data access layer',
  'infrastructure': 'Infrastructure code',
  'adapters': 'External adapters',
  'ports': 'Port interfaces',
  'config': 'Configuration files',
  'constants': 'Constant values',
  'middleware': 'Middleware functions',
  'routes': 'Route definitions',
  'views': 'View templates',
  'templates': 'Template files',
  'assets': 'Static assets',
  'public': 'Public files',
  'static': 'Static files',
  'styles': 'Stylesheets',
  'css': 'CSS files',
  'scss': 'SCSS files',
  'images': 'Image files',
  'fonts': 'Font files',
  'locales': 'Localization files',
  'i18n': 'Internationalization',
  'tests': 'Test files',
  'test': 'Test files',
  '__tests__': 'Test files',
  'spec': 'Test specifications',
  'e2e': 'End-to-end tests',
  'integration': 'Integration tests',
  'unit': 'Unit tests',
  'fixtures': 'Test fixtures',
  'mocks': 'Mock objects',
  'docs': 'Documentation',
  'documentation': 'Documentation',
  'scripts': 'Utility scripts',
  'bin': 'Binary/executable scripts',
  'tools': 'Development tools',
  'build': 'Build output',
  'dist': 'Distribution files',
  'out': 'Output files',
  'target': 'Build target',
  'vendor': 'Third-party code',
  'node_modules': 'Node.js dependencies',
  'packages': 'Monorepo packages',
  'apps': 'Monorepo applications',
  'libs': 'Monorepo libraries',
  'modules': 'Application modules',
  'features': 'Feature modules',
  'core': 'Core functionality',
  'shared': 'Shared code',
  'common': 'Common utilities',
  'internal': 'Internal packages',
  'pkg': 'Go packages',
  'cmd': 'Go commands',
  'migrations': 'Database migrations',
  'seeds': 'Database seeds',
  'database': 'Database related',
  'db': 'Database related',
  'prisma': 'Prisma ORM files',
  'drizzle': 'Drizzle ORM files',
  'graphql': 'GraphQL schemas',
  'proto': 'Protocol buffer files',
  'grpc': 'gRPC definitions',
  'functions': 'Serverless functions',
  'lambdas': 'AWS Lambda functions',
  'handlers': 'Request handlers',
  'events': 'Event definitions',
  'jobs': 'Background jobs',
  'workers': 'Worker processes',
  'queues': 'Queue processors',
  'cron': 'Scheduled tasks',
  'tasks': 'Task definitions',
  'plugins': 'Plugin system',
  'extensions': 'Extensions',
  'providers': 'Provider implementations',
  'guards': 'Auth guards',
  'decorators': 'Decorators',
  'filters': 'Filters',
  'pipes': 'Data pipes',
  'interceptors': 'Interceptors',
  'validators': 'Validation logic',
  'transformers': 'Data transformers',
  'serializers': 'Serialization logic',
  'exceptions': 'Exception handling',
  'errors': 'Error definitions',
  'logging': 'Logging configuration',
  'cache': 'Caching logic',
  'auth': 'Authentication',
  'security': 'Security features',
  'email': 'Email handling',
  'notifications': 'Notification system',
  'uploads': 'File uploads',
  'storage': 'File storage',
  'media': 'Media files',
};

export async function detectArchitecture(projectRoot: string): Promise<ArchitectureInfo> {
  const scores: Record<ArchitecturePattern, number> = {
    'clean-architecture': 0,
    'hexagonal': 0,
    'mvc': 0,
    'mvvm': 0,
    'layered': 0,
    'microservices': 0,
    'serverless': 0,
    'event-driven': 0,
    'monolith': 0,
    'unknown': 0,
  };
  
  try {
    // Get top-level directories
    const entries = await fs.readdir(projectRoot, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name.toLowerCase());
    const files = entries.filter(e => e.isFile()).map(e => e.name.toLowerCase());
    
    // Also check src/ directory
    const srcPath = path.join(projectRoot, 'src');
    try {
      const srcEntries = await fs.readdir(srcPath, { withFileTypes: true });
      const srcDirs = srcEntries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name.toLowerCase());
      dirs.push(...srcDirs);
    } catch {
      // src doesn't exist
    }
    
    // Score each architecture pattern
    for (const [pattern, indicators] of Object.entries(ARCHITECTURE_INDICATORS)) {
      // Check directories
      for (const dir of indicators.dirs) {
        if (dirs.includes(dir.toLowerCase())) {
          scores[pattern as ArchitecturePattern] += 2;
        }
      }
      
      // Check files
      for (const file of indicators.files) {
        if (files.includes(file.toLowerCase())) {
          scores[pattern as ArchitecturePattern] += 3;
        }
      }
    }
    
    // Special cases
    
    // Monorepo detection
    if (dirs.includes('packages') || dirs.includes('apps') || files.includes('pnpm-workspace.yaml') || files.includes('lerna.json')) {
      // Could be microservices if also has docker
      if (files.includes('docker-compose.yml') || files.includes('docker-compose.yaml')) {
        scores['microservices'] += 3;
      }
    }
    
    // Serverless indicators
    if (files.some(f => f.includes('serverless') || f.includes('netlify') || f.includes('vercel') || f === 'sst.config.ts')) {
      scores['serverless'] += 5;
    }
    
    // Default to layered or monolith if no clear pattern
    if (Object.values(scores).every(s => s === 0)) {
      scores['monolith'] = 1;
    }
    
  } catch {
    scores['unknown'] = 1;
  }
  
  // Find the highest scoring pattern
  let maxScore = 0;
  let detectedPattern: ArchitecturePattern = 'unknown';
  
  for (const [pattern, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedPattern = pattern as ArchitecturePattern;
    }
  }
  
  // Identify layers based on detected pattern
  const layers = await identifyLayers(projectRoot, detectedPattern);
  
  return {
    pattern: detectedPattern,
    layers,
    description: getArchitectureDescription(detectedPattern),
  };
}

async function identifyLayers(projectRoot: string, pattern: ArchitecturePattern): Promise<string[]> {
  const layers: string[] = [];
  
  try {
    const entries = await fs.readdir(projectRoot, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
    
    // Also check src/
    try {
      const srcEntries = await fs.readdir(path.join(projectRoot, 'src'), { withFileTypes: true });
      const srcDirs = srcEntries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => `src/${e.name}`);
      dirs.push(...srcDirs);
    } catch {
      // Ignore
    }
    
    // Map directories to their purpose
    for (const dir of dirs) {
      const baseName = path.basename(dir).toLowerCase();
      const purpose = FOLDER_PURPOSES[baseName];
      if (purpose && !layers.includes(purpose)) {
        layers.push(purpose);
      }
    }
    
  } catch {
    // Ignore
  }
  
  return layers.slice(0, 10); // Limit to 10 layers
}

function getArchitectureDescription(pattern: ArchitecturePattern): string {
  const descriptions: Record<ArchitecturePattern, string> = {
    'clean-architecture': 'Clean Architecture with clear separation between domain, application, and infrastructure layers',
    'hexagonal': 'Hexagonal (Ports & Adapters) architecture with explicit boundaries between core and external systems',
    'mvc': 'Model-View-Controller pattern separating data, presentation, and logic',
    'mvvm': 'Model-View-ViewModel pattern with data binding between view and model',
    'layered': 'Traditional layered architecture with distinct presentation, business, and data layers',
    'microservices': 'Microservices architecture with independently deployable services',
    'serverless': 'Serverless/FaaS architecture with event-driven function handlers',
    'event-driven': 'Event-driven architecture with message passing between components',
    'monolith': 'Monolithic application with all functionality in a single deployable unit',
    'unknown': 'Architecture pattern could not be determined',
  };
  
  return descriptions[pattern];
}

export { FOLDER_PURPOSES };
