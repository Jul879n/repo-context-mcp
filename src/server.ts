import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
  Resource,
  Prompt,
} from '@modelcontextprotocol/sdk/types.js';
import { getFullContext, refreshContext } from './tools/index.js';
import { ProjectContext } from './types/index.js';
import {
  formatUltraCompact,
  formatCompact,
  formatMinimal,
  formatJSON,
} from './formatters/index.js';

// Get project root from environment or current directory
const PROJECT_ROOT = process.env.REPO_CONTEXT_ROOT || process.cwd();

// Output format type
type OutputFormat = 'ultra' | 'compact' | 'normal' | 'minimal' | 'json';

// Define available tools - OPTIMIZED for minimal token usage
const tools: Tool[] = [
  {
    name: 'get_project_context',
    description: `IMPORTANT: Call this tool FIRST at the START of every conversation to understand the project.
Returns analyzed project context (stack, structure, endpoints, models).
Format options: ultra (~50 tokens), compact (~150, default), normal (full).
This replaces the need to explore the codebase manually.`,
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['ultra', 'compact', 'normal', 'minimal', 'json'],
          description: 'Output format (default: compact)',
        },
        force_refresh: {
          type: 'boolean',
          description: 'Force re-analysis (default: false)',
        },
      },
      required: [],
    },
  },
  {
    name: 'refresh_project_context',
    description: 'Re-analyzes project. Use after major changes.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_stack',
    description: 'Returns tech stack only: lang, frameworks, deps.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_structure',
    description: 'Returns folder structure and entry points only.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_endpoints',
    description: 'Returns API endpoints only.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_models',
    description: 'Returns data models/schemas only.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_status',
    description: 'Returns project status: tests, CI, Docker, TODOs.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// Define MCP Prompts - These inject context WITHOUT tool calls!
// The context becomes part of the system prompt = 0 extra tokens per message
function getPrompts(): Prompt[] {
  return [
    {
      name: 'project-context',
      description: 'Injects project context into conversation. Use at start.',
      arguments: [
        {
          name: 'format',
          description: 'Output format: minimal, ultra, compact (default)',
          required: false,
        },
      ],
    },
    {
      name: 'project-summary',
      description: 'Ultra-minimal project summary (~50 tokens)',
    },
  ];
}

// Define MCP Resources - These are FREE (no tool call tokens!)
// Resources can be embedded directly into context without explicit tool calls
function getResources(): Resource[] {
  return [
    {
      uri: 'repo://context/summary',
      name: 'Project Summary',
      description: 'Ultra-compact project summary (~50 tokens). Embed this for instant context.',
      mimeType: 'text/plain',
    },
    {
      uri: 'repo://context/full',
      name: 'Full Project Context',
      description: 'Complete project analysis in compact format.',
      mimeType: 'text/plain',
    },
    {
      uri: 'repo://context/stack',
      name: 'Tech Stack',
      description: 'Languages, frameworks, and dependencies.',
      mimeType: 'text/plain',
    },
    {
      uri: 'repo://context/structure',
      name: 'Project Structure',
      description: 'Folder layout and entry points.',
      mimeType: 'text/plain',
    },
    {
      uri: 'repo://context/api',
      name: 'API Endpoints',
      description: 'REST/GraphQL endpoints if detected.',
      mimeType: 'text/plain',
    },
    {
      uri: 'repo://context/models',
      name: 'Data Models',
      description: 'Schemas, types, and interfaces.',
      mimeType: 'text/plain',
    },
    {
      uri: 'repo://context.json',
      name: 'Project Context (JSON)',
      description: 'Full context in JSON format for programmatic use.',
      mimeType: 'application/json',
    },
  ];
}

// Format context based on output format
function formatByType(context: ProjectContext, format: OutputFormat): string {
  switch (format) {
    case 'ultra':
      return formatUltraCompact(context);
    case 'compact':
      return formatCompact(context);
    case 'minimal':
      return formatMinimal(context);
    case 'json':
      return formatJSON(context);
    case 'normal':
    default:
      return formatContextNormal(context);
  }
}

// Original "normal" format (kept for backwards compatibility)
function formatContextNormal(context: ProjectContext): string {
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
      const priority = todo.priority === 'high' ? '!' : todo.priority === 'medium' ? '-' : '.';
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
        resources: {},
        prompts: {},
      },
    }
  );
  
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });
  
  // List available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: getPrompts() };
  });
  
  // Get prompt content - This is the key for 0-token context injection!
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: promptArgs } = request.params;
    
    try {
      const context = await getFullContext(PROJECT_ROOT);
      
      if (name === 'project-context') {
        const format = (promptArgs?.format as OutputFormat) || 'compact';
        const content = formatByType(context, format);
        
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Project context:\n${content}`,
              },
            },
          ],
        };
      }
      
      if (name === 'project-summary') {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Project: ${formatMinimal(context)}`,
              },
            },
          ],
        };
      }
      
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Unknown prompt: ${name}`,
            },
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          },
        ],
      };
    }
  });
  
  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: getResources() };
  });
  
  // Read resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    
    try {
      const context = await getFullContext(PROJECT_ROOT);
      let content: string;
      let mimeType = 'text/plain';
      
      switch (uri) {
        case 'repo://context/summary':
          content = formatMinimal(context);
          break;
        case 'repo://context/full':
          content = formatCompact(context);
          break;
        case 'repo://context/stack':
          content = [
            `Stack: ${context.stack.primaryLanguage}`,
            context.stack.frameworks.length > 0 
              ? `Frameworks: ${context.stack.frameworks.map(f => f.name).join(', ')}`
              : '',
            `Deps: ${context.stack.dependencies.filter(d => !d.dev).slice(0, 10).map(d => d.name).join(', ')}`,
          ].filter(Boolean).join('\n');
          break;
        case 'repo://context/structure':
          content = [
            `Entry: ${context.structure.entryPoints.join(', ')}`,
            `Folders: ${context.structure.folders.map(f => f.path).join(', ')}`,
            `Config: ${context.structure.configFiles.join(', ')}`,
          ].join('\n');
          break;
        case 'repo://context/api':
          if (context.endpoints && context.endpoints.endpoints.length > 0) {
            content = context.endpoints.endpoints
              .map(e => `${e.method} ${e.path} → ${e.file}:${e.line}`)
              .join('\n');
          } else {
            content = 'No API endpoints detected';
          }
          break;
        case 'repo://context/models':
          if (context.models && context.models.models.length > 0) {
            content = context.models.models
              .map(m => `${m.name} (${m.type}): ${m.fields.map(f => f.name).join(', ')}`)
              .join('\n');
          } else {
            content = 'No data models detected';
          }
          break;
        case 'repo://context.json':
          content = JSON.stringify(context, null, 2);
          mimeType = 'application/json';
          break;
        default:
          return {
            contents: [{
              uri,
              mimeType: 'text/plain',
              text: `Unknown resource: ${uri}`,
            }],
          };
      }
      
      return {
        contents: [{
          uri,
          mimeType,
          text: content,
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `Error: ${errorMessage}`,
        }],
      };
    }
  });
  
  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
      let context: ProjectContext;
      
      switch (name) {
        case 'get_project_context': {
          const typedArgs = args as { format?: OutputFormat; force_refresh?: boolean } | undefined;
          const format = typedArgs?.format ?? 'compact';
          const forceRefresh = typedArgs?.force_refresh ?? false;
          context = await getFullContext(PROJECT_ROOT, forceRefresh);
          return {
            content: [
              {
                type: 'text',
                text: formatByType(context, format),
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
                text: `Refreshed.\n\n${formatCompact(context)}`,
              },
            ],
          };
        }
        
        case 'get_project_stack': {
          context = await getFullContext(PROJECT_ROOT);
          const stackInfo = [
            `${context.name}|${context.stack.primaryLanguage}`,
            context.stack.frameworks.length > 0 ? `fw:${context.stack.frameworks.map(f => f.name).join(',')}` : '',
            context.stack.packageManager ? `pkg:${context.stack.packageManager}` : '',
            `deps:${context.stack.dependencies.filter(d => !d.dev).slice(0, 10).map(d => d.name).join(',')}`,
          ].filter(Boolean).join('\n');
          
          return {
            content: [{ type: 'text', text: stackInfo }],
          };
        }
        
        case 'get_project_structure': {
          context = await getFullContext(PROJECT_ROOT);
          const structureInfo = [
            `→${context.structure.entryPoints.join(',')}`,
            context.structure.folders.map(f => `${f.path}:${f.fileCount}`).join(' '),
            `cfg:${context.structure.configFiles.join(',')}`,
          ].join('\n');
          
          return {
            content: [{ type: 'text', text: structureInfo }],
          };
        }
        
        case 'get_project_endpoints': {
          context = await getFullContext(PROJECT_ROOT);
          if (!context.endpoints || context.endpoints.endpoints.length === 0) {
            return {
              content: [{ type: 'text', text: 'No API endpoints.' }],
            };
          }
          
          const endpointsInfo = [
            `API(${context.endpoints.type}):${context.endpoints.endpoints.length}`,
            ...context.endpoints.endpoints.slice(0, 20).map(ep => 
              `${ep.method[0]}:${ep.path}→${ep.file}:${ep.line}`
            ),
            context.endpoints.endpoints.length > 20 
              ? `+${context.endpoints.endpoints.length - 20} more`
              : '',
          ].filter(Boolean).join('\n');
          
          return {
            content: [{ type: 'text', text: endpointsInfo }],
          };
        }
        
        case 'get_project_models': {
          context = await getFullContext(PROJECT_ROOT);
          if (!context.models || context.models.models.length === 0) {
            return {
              content: [{ type: 'text', text: 'No models.' }],
            };
          }
          
          const modelsInfo = [
            `Models:${context.models.models.length}${context.models.ormUsed ? '|' + context.models.ormUsed : ''}`,
            ...context.models.models.slice(0, 15).map(m => 
              `${m.name}(${m.type}):${m.fields.slice(0, 4).map(f => f.name).join(',')}${m.fields.length > 4 ? '...' : ''}`
            ),
          ].join('\n');
          
          return {
            content: [{ type: 'text', text: modelsInfo }],
          };
        }
        
        case 'get_project_status': {
          context = await getFullContext(PROJECT_ROOT);
          const statusInfo = [
            `${context.name}`,
            `test:${context.status.tests.testFiles}${context.status.tests.framework ? '(' + context.status.tests.framework + ')' : ''}`,
            context.status.hasDocker ? 'docker:yes' : '',
            context.status.hasCI ? `ci:${context.status.ciPlatform}` : '',
            context.status.hasDocumentation ? 'docs:yes' : '',
            context.status.todos.length > 0 ? `todos:${context.status.todos.length}` : '',
          ].filter(Boolean).join('|');
          
          return {
            content: [{ type: 'text', text: statusInfo }],
          };
        }
        
        default:
          return {
            content: [{ type: 'text', text: `Unknown: ${name}` }],
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
  
  // AUTO-INJECT: Send context notification after connection
  // This makes the context available immediately without tool calls
  try {
    const context = await getFullContext(PROJECT_ROOT);
    const summary = formatUltraCompact(context);
    
    // Log to stderr (visible to user, not consumed as tokens)
    console.error(`\n[repo-context] Project loaded: ${context.name}`);
    console.error(`[repo-context] ${formatMinimal(context)}\n`);
    
    // Notify resource change so clients know context is ready
    server.notification({
      method: 'notifications/resources/list_changed',
    });
  } catch (error) {
    console.error('[repo-context] Warning: Could not pre-load context:', error);
  }
  
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
