import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { getFullContext, refreshContext } from './tools/index.js';
import { ProjectContext } from './types/index.js';

// Get project root from environment or current directory
const PROJECT_ROOT = process.env.REPO_CONTEXT_ROOT || process.cwd();

// Define available tools
const tools: Tool[] = [
  {
    name: 'get_project_context',
    description: `Analyzes the current project and returns comprehensive context including:
- Project name, description, and version
- Tech stack (languages, frameworks, dependencies)
- Folder structure with descriptions
- API endpoints (REST, GraphQL, etc.)
- Data models and schemas
- Architecture patterns detected
- Project status (TODOs, tests, CI/CD, Docker)

Use this tool at the START of a conversation to understand the project structure and save tokens by avoiding redundant exploration.`,
    inputSchema: {
      type: 'object',
      properties: {
        force_refresh: {
          type: 'boolean',
          description: 'Force re-analysis even if cached context exists (default: false)',
        },
      },
      required: [],
    },
  },
  {
    name: 'refresh_project_context',
    description: 'Invalidates the cached context and performs a fresh analysis of the project. Use this after making significant changes to the project structure.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_stack',
    description: 'Returns only the tech stack information: languages, frameworks, dependencies, package manager, and runtime.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_structure',
    description: 'Returns only the folder structure, entry points, and configuration files.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_endpoints',
    description: 'Returns only the detected API endpoints (REST routes, GraphQL operations, etc.).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_models',
    description: 'Returns only the detected data models, schemas, types, and interfaces.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_status',
    description: 'Returns project status: TODOs found in code, test coverage info, CI/CD setup, Docker presence.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// Format context for output
function formatContext(context: ProjectContext): string {
  const sections: string[] = [];
  
  // Header
  sections.push(`# ${context.name}`);
  if (context.description) {
    sections.push(`\n${context.description}`);
  }
  if (context.version) {
    sections.push(`\nVersion: ${context.version}`);
  }
  
  // Stack
  sections.push(`\n## Tech Stack`);
  sections.push(`- **Primary Language:** ${context.stack.primaryLanguage}`);
  if (context.stack.languages.length > 1) {
    sections.push(`- **All Languages:** ${context.stack.languages.join(', ')}`);
  }
  if (context.stack.frameworks.length > 0) {
    const fwList = context.stack.frameworks.map(f => `${f.name}${f.version ? ` (${f.version})` : ''}`).join(', ');
    sections.push(`- **Frameworks:** ${fwList}`);
  }
  if (context.stack.packageManager) {
    sections.push(`- **Package Manager:** ${context.stack.packageManager}`);
  }
  if (context.stack.runtime) {
    sections.push(`- **Runtime:** ${context.stack.runtime}`);
  }
  
  // Key dependencies (limit to 15)
  const prodDeps = context.stack.dependencies.filter(d => !d.dev).slice(0, 15);
  if (prodDeps.length > 0) {
    sections.push(`\n### Key Dependencies`);
    for (const dep of prodDeps) {
      sections.push(`- ${dep.name}: ${dep.version}`);
    }
  }
  
  // Structure
  sections.push(`\n## Project Structure`);
  if (context.structure.entryPoints.length > 0) {
    sections.push(`\n### Entry Points`);
    for (const entry of context.structure.entryPoints) {
      sections.push(`- ${entry}`);
    }
  }
  
  sections.push(`\n### Folders`);
  for (const folder of context.structure.folders.slice(0, 20)) {
    sections.push(`- **${folder.path}/** - ${folder.description} (${folder.fileCount} files)`);
  }
  
  if (context.structure.configFiles.length > 0) {
    sections.push(`\n### Config Files`);
    sections.push(context.structure.configFiles.join(', '));
  }
  
  // Endpoints
  if (context.endpoints && context.endpoints.endpoints.length > 0) {
    sections.push(`\n## API Endpoints (${context.endpoints.type.toUpperCase()})`);
    for (const ep of context.endpoints.endpoints.slice(0, 30)) {
      sections.push(`- \`${ep.method} ${ep.path}\` → ${ep.file}:${ep.line}`);
    }
    if (context.endpoints.endpoints.length > 30) {
      sections.push(`\n... and ${context.endpoints.endpoints.length - 30} more endpoints`);
    }
  }
  
  // Models
  if (context.models && context.models.models.length > 0) {
    sections.push(`\n## Data Models`);
    if (context.models.ormUsed) {
      sections.push(`ORM: ${context.models.ormUsed}`);
    }
    for (const model of context.models.models.slice(0, 20)) {
      const fields = model.fields.slice(0, 5).map(f => f.name).join(', ');
      const moreFields = model.fields.length > 5 ? `, +${model.fields.length - 5} more` : '';
      sections.push(`- **${model.name}** (${model.type}) → ${model.file}:${model.line}`);
      if (fields) {
        sections.push(`  Fields: ${fields}${moreFields}`);
      }
    }
    if (context.models.models.length > 20) {
      sections.push(`\n... and ${context.models.models.length - 20} more models`);
    }
  }
  
  // Architecture
  sections.push(`\n## Architecture`);
  sections.push(`- **Pattern:** ${context.architecture.pattern}`);
  sections.push(`- ${context.architecture.description}`);
  if (context.architecture.layers.length > 0) {
    sections.push(`- **Layers:** ${context.architecture.layers.join(', ')}`);
  }
  
  // Status
  sections.push(`\n## Project Status`);
  sections.push(`- **Documentation:** ${context.status.hasDocumentation ? 'Yes' : 'No'}`);
  sections.push(`- **Docker:** ${context.status.hasDocker ? 'Yes' : 'No'}`);
  sections.push(`- **CI/CD:** ${context.status.hasCI ? `Yes (${context.status.ciPlatform})` : 'No'}`);
  sections.push(`- **Tests:** ${context.status.tests.testFiles} test files${context.status.tests.framework ? ` (${context.status.tests.framework})` : ''}`);
  sections.push(`- **TODOs:** ${context.status.todos.length} found`);
  
  if (context.status.todos.length > 0) {
    sections.push(`\n### Top TODOs`);
    for (const todo of context.status.todos.slice(0, 10)) {
      const priority = todo.priority === 'high' ? '🔴' : todo.priority === 'medium' ? '🟡' : '⚪';
      sections.push(`- ${priority} ${todo.text} (${todo.file}:${todo.line})`);
    }
  }
  
  sections.push(`\n---\n*Analyzed at: ${context.analyzedAt}*`);
  
  return sections.join('\n');
}

// Create and configure the server
export function createServer(): Server {
  const server = new Server(
    {
      name: 'repo-context-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });
  
  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
      let context: ProjectContext;
      
      switch (name) {
        case 'get_project_context': {
          const forceRefresh = (args as { force_refresh?: boolean })?.force_refresh ?? false;
          context = await getFullContext(PROJECT_ROOT, forceRefresh);
          return {
            content: [
              {
                type: 'text',
                text: formatContext(context),
              },
            ],
          };
        }
        
        case 'refresh_project_context': {
          context = await refreshContext(PROJECT_ROOT);
          return {
            content: [
              {
                type: 'text',
                text: `Project context refreshed successfully.\n\n${formatContext(context)}`,
              },
            ],
          };
        }
        
        case 'get_project_stack': {
          context = await getFullContext(PROJECT_ROOT);
          const stackInfo = [
            `# Tech Stack for ${context.name}`,
            `\n- **Primary Language:** ${context.stack.primaryLanguage}`,
            `- **All Languages:** ${context.stack.languages.join(', ')}`,
            context.stack.frameworks.length > 0 ? `- **Frameworks:** ${context.stack.frameworks.map(f => f.name).join(', ')}` : '',
            context.stack.packageManager ? `- **Package Manager:** ${context.stack.packageManager}` : '',
            context.stack.runtime ? `- **Runtime:** ${context.stack.runtime}` : '',
            `\n## Dependencies (${context.stack.dependencies.length} total)`,
            ...context.stack.dependencies.filter(d => !d.dev).slice(0, 20).map(d => `- ${d.name}: ${d.version}`),
          ].filter(Boolean).join('\n');
          
          return {
            content: [{ type: 'text', text: stackInfo }],
          };
        }
        
        case 'get_project_structure': {
          context = await getFullContext(PROJECT_ROOT);
          const structureInfo = [
            `# Project Structure for ${context.name}`,
            `\n## Entry Points`,
            ...context.structure.entryPoints.map(e => `- ${e}`),
            `\n## Folders`,
            ...context.structure.folders.map(f => `- **${f.path}/** - ${f.description} (${f.fileCount} files)`),
            `\n## Config Files`,
            context.structure.configFiles.join(', '),
          ].join('\n');
          
          return {
            content: [{ type: 'text', text: structureInfo }],
          };
        }
        
        case 'get_project_endpoints': {
          context = await getFullContext(PROJECT_ROOT);
          if (!context.endpoints || context.endpoints.endpoints.length === 0) {
            return {
              content: [{ type: 'text', text: 'No API endpoints detected in this project.' }],
            };
          }
          
          const endpointsInfo = [
            `# API Endpoints (${context.endpoints.type.toUpperCase()})`,
            `\nTotal: ${context.endpoints.endpoints.length} endpoints`,
            '',
            ...context.endpoints.endpoints.map(ep => `- \`${ep.method} ${ep.path}\` → ${ep.file}:${ep.line}`),
          ].join('\n');
          
          return {
            content: [{ type: 'text', text: endpointsInfo }],
          };
        }
        
        case 'get_project_models': {
          context = await getFullContext(PROJECT_ROOT);
          if (!context.models || context.models.models.length === 0) {
            return {
              content: [{ type: 'text', text: 'No data models detected in this project.' }],
            };
          }
          
          const modelsInfo = [
            `# Data Models`,
            context.models.ormUsed ? `\nORM: ${context.models.ormUsed}` : '',
            `\nTotal: ${context.models.models.length} models`,
            '',
            ...context.models.models.map(m => {
              const fields = m.fields.map(f => `${f.name}: ${f.type}`).join(', ');
              return `## ${m.name} (${m.type})\nFile: ${m.file}:${m.line}\nFields: ${fields || 'none detected'}`;
            }),
          ].filter(Boolean).join('\n');
          
          return {
            content: [{ type: 'text', text: modelsInfo }],
          };
        }
        
        case 'get_project_status': {
          context = await getFullContext(PROJECT_ROOT);
          const statusInfo = [
            `# Project Status for ${context.name}`,
            `\n## Overview`,
            `- **Documentation:** ${context.status.hasDocumentation ? 'Yes' : 'No'}`,
            `- **Docker:** ${context.status.hasDocker ? 'Yes' : 'No'}`,
            `- **CI/CD:** ${context.status.hasCI ? `Yes (${context.status.ciPlatform})` : 'No'}`,
            `- **Tests:** ${context.status.tests.testFiles} test files${context.status.tests.framework ? ` (${context.status.tests.framework})` : ''}`,
            `\n## TODOs (${context.status.todos.length} found)`,
            ...context.status.todos.map(t => {
              const priority = t.priority === 'high' ? '🔴 HIGH' : t.priority === 'medium' ? '🟡 MEDIUM' : '⚪ LOW';
              return `- [${priority}] ${t.text}\n  ${t.file}:${t.line}`;
            }),
          ].join('\n');
          
          return {
            content: [{ type: 'text', text: statusInfo }],
          };
        }
        
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });
  
  return server;
}

// Main entry point
export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}
