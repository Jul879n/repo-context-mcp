import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
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
import {
	getFullContext,
	refreshContext,
	generateDocs,
	getFileOutline,
	readFileLines,
	readFileSymbol,
	searchInFile,
} from './tools/index.js';
import {ProjectContext} from './types/index.js';
import {startWatcher} from './watcher.js';
import {
	formatUltraCompact,
	formatCompact,
	formatMinimal,
	formatJSON,
} from './formatters/index.js';
import {
	formatImportGraphMermaid,
	readAnnotations,
	addAnnotation,
	removeAnnotation,
	formatAnnotations,
} from './detectors/index.js';

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
	{
		name: 'get_project_hotfiles',
		description:
			'Returns large/complex files that need special attention (oversized, high imports, todo-dense).',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'get_project_annotations',
		description: 'Returns human-written business rules, gotchas, and warnings.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'get_project_imports',
		description:
			'Returns internal import graph: hub files, orphan files. Use format "mermaid" for visual diagram.',
		inputSchema: {
			type: 'object',
			properties: {
				format: {
					type: 'string',
					enum: ['text', 'mermaid'],
					description: 'Output format: text (default) or mermaid (visual diagram)',
				},
			},
			required: [],
		},
	},
	{
		name: 'add_annotation',
		description:
			'Adds a business rule, gotcha, or warning to the project annotations.',
		inputSchema: {
			type: 'object',
			properties: {
				category: {
					type: 'string',
					enum: ['businessRules', 'gotchas', 'warnings'],
					description: 'Annotation category',
				},
				text: {
					type: 'string',
					description: 'The annotation text to add',
				},
			},
			required: ['category', 'text'],
		},
	},
	{
		name: 'remove_annotation',
		description:
			'Removes an annotation by category and index. Use list_annotations first to see indices.',
		inputSchema: {
			type: 'object',
			properties: {
				category: {
					type: 'string',
					enum: ['businessRules', 'gotchas', 'warnings'],
					description: 'Annotation category',
				},
				index: {
					type: 'number',
					description: 'Index of the annotation to remove (0-based)',
				},
			},
			required: ['category', 'index'],
		},
	},
	{
		name: 'list_annotations',
		description:
			'Lists all project annotations with indices for easy management.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'generate_project_docs',
		description:
			'Regenerates .repo-context/ auto-docs. Usually automatic via file watcher, use only if needed.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	// ─── Smart File Reader Tools (v1.5.0) ───
	{
		name: 'read_file_outline',
		description:
			'Returns outline of a file: all functions, classes, interfaces, types with line ranges. Use BEFORE reading a large file to know what to target. ~100 tokens.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {
					type: 'string',
					description: 'Relative path to file (e.g. src/server.ts)',
				},
			},
			required: ['file'],
		},
	},
	{
		name: 'read_file_lines',
		description:
			'Reads specific line range from a file. Max 200 lines per call. Use after read_file_outline to read only what you need.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {
					type: 'string',
					description: 'Relative path to file',
				},
				start_line: {
					type: 'number',
					description: 'Start line (1-indexed)',
				},
				end_line: {
					type: 'number',
					description: 'End line (1-indexed, max 200 lines from start)',
				},
			},
			required: ['file', 'start_line', 'end_line'],
		},
	},
	{
		name: 'read_file_symbol',
		description:
			'Reads a specific function, class, or interface by name. Returns complete code block. Use after read_file_outline to get symbol names.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {
					type: 'string',
					description: 'Relative path to file',
				},
				symbol: {
					type: 'string',
					description: 'Symbol name (function, class, interface, type)',
				},
			},
			required: ['file', 'symbol'],
		},
	},
	{
		name: 'search_in_file',
		description:
			'Search for a pattern in a file. Returns matches with ±N lines of context. Max 10 matches.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {
					type: 'string',
					description: 'Relative path to file',
				},
				pattern: {
					type: 'string',
					description: 'Search pattern (string or regex)',
				},
				context_lines: {
					type: 'number',
					description: 'Lines of context around each match (default: 3, max: 10)',
				},
			},
			required: ['file', 'pattern'],
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
		{
			name: 'file-reader-guide',
			description:
				'Injects instructions for efficient file reading. Use for large files.',
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
			description:
				'Ultra-compact project summary (~50 tokens). Embed this for instant context.',
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
			uri: 'repo://context/hotfiles',
			name: 'Hot Files',
			description: 'Large/complex files that need special attention.',
			mimeType: 'text/plain',
		},
		{
			uri: 'repo://context/annotations',
			name: 'Project Annotations',
			description: 'Human-written business rules, gotchas, and warnings.',
			mimeType: 'text/plain',
		},
		{
			uri: 'repo://context/imports',
			name: 'Import Graph',
			description: 'Internal dependency graph: hub files, orphan files.',
			mimeType: 'text/plain',
		},
		{
			uri: 'repo://context.json',
			name: 'Project Context (JSON)',
			description: 'Full context in JSON format for programmatic use.',
			mimeType: 'application/json',
		},
		{
			uri: 'repo://context/outlines',
			name: 'File Outlines',
			description:
				'All source file outlines: functions, classes, interfaces with line ranges. Use to navigate large files.',
			mimeType: 'text/plain',
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
		const fwList = context.stack.frameworks
			.map((f) => `${f.name}${f.version ? ` (${f.version})` : ''}`)
			.join(', ');
		sections.push(`- **Frameworks:** ${fwList}`);
	}
	if (context.stack.packageManager) {
		sections.push(`- **Package Manager:** ${context.stack.packageManager}`);
	}
	if (context.stack.runtime) {
		sections.push(`- **Runtime:** ${context.stack.runtime}`);
	}

	// Key dependencies (limit to 15)
	const prodDeps = context.stack.dependencies.filter((d) => !d.dev).slice(0, 15);
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
		sections.push(
			`- **${folder.path}/** - ${folder.description} (${folder.fileCount} files)`
		);
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
			sections.push(
				`\n... and ${context.endpoints.endpoints.length - 30} more endpoints`
			);
		}
	}

	// Models
	if (context.models && context.models.models.length > 0) {
		sections.push(`\n## Data Models`);
		if (context.models.ormUsed) {
			sections.push(`ORM: ${context.models.ormUsed}`);
		}
		for (const model of context.models.models.slice(0, 20)) {
			const fields = model.fields
				.slice(0, 5)
				.map((f) => f.name)
				.join(', ');
			const moreFields =
				model.fields.length > 5 ? `, +${model.fields.length - 5} more` : '';
			sections.push(
				`- **${model.name}** (${model.type}) → ${model.file}:${model.line}`
			);
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
	sections.push(
		`- **Documentation:** ${context.status.hasDocumentation ? 'Yes' : 'No'}`
	);
	sections.push(`- **Docker:** ${context.status.hasDocker ? 'Yes' : 'No'}`);
	sections.push(
		`- **CI/CD:** ${
			context.status.hasCI ? `Yes (${context.status.ciPlatform})` : 'No'
		}`
	);
	sections.push(
		`- **Tests:** ${context.status.tests.testFiles} test files${
			context.status.tests.framework ? ` (${context.status.tests.framework})` : ''
		}`
	);
	sections.push(`- **TODOs:** ${context.status.todos.length} found`);

	if (context.status.todos.length > 0) {
		sections.push(`\n### Top TODOs`);
		for (const todo of context.status.todos.slice(0, 5)) {
			const priority =
				todo.priority === 'high' ? '!' : todo.priority === 'medium' ? '-' : '.';
			sections.push(`- ${priority} ${todo.text} (${todo.file}:${todo.line})`);
		}
	}

	// Hot Files
	if (context.hotFiles && context.hotFiles.files.length > 0) {
		sections.push(`\n## ⚠ Hot Files (${context.hotFiles.files.length})`);
		sections.push(
			`*Thresholds: >${context.hotFiles.thresholds.lines} lines, >${context.hotFiles.thresholds.imports} imports*`
		);
		for (const hf of context.hotFiles.files.slice(0, 10)) {
			const details: string[] = [`${hf.lines} lines`];
			if (hf.imports) details.push(`${hf.imports} imports`);
			if (hf.exports) details.push(`${hf.exports} exports`);
			if (hf.todoCount) details.push(`${hf.todoCount} TODOs`);
			sections.push(`- **${hf.file}** (${details.join(', ')}) [${hf.reason}]`);
		}
	}

	// Import Graph
	if (context.importGraph) {
		sections.push(`\n## Import Graph`);
		if (context.importGraph.mostImported.length > 0) {
			sections.push(`\n### Hub Files (most imported)`);
			for (const hub of context.importGraph.mostImported) {
				const node = context.importGraph.nodes.find((n) => n.file === hub);
				sections.push(
					`- **${hub}** (imported by ${node?.importedBy || '?'} files)`
				);
			}
		}
		if (context.importGraph.orphans.length > 0) {
			sections.push(`\n### Orphan Files (not imported by anyone)`);
			for (const orphan of context.importGraph.orphans.slice(0, 10)) {
				sections.push(`- ${orphan}`);
			}
		}
	}

	// Annotations
	if (context.annotations) {
		sections.push(`\n## Project Annotations`);
		if (context.annotations.businessRules.length > 0) {
			sections.push(`\n### 📋 Business Rules`);
			for (const rule of context.annotations.businessRules) {
				sections.push(`- ${rule}`);
			}
		}
		if (context.annotations.gotchas.length > 0) {
			sections.push(`\n### ⚠ Gotchas`);
			for (const g of context.annotations.gotchas) {
				sections.push(`- ${g}`);
			}
		}
		if (context.annotations.warnings.length > 0) {
			sections.push(`\n### 🔴 Warnings`);
			for (const w of context.annotations.warnings) {
				sections.push(`- ${w}`);
			}
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
			version: '1.5.0',
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
		return {tools};
	});

	// List available prompts
	server.setRequestHandler(ListPromptsRequestSchema, async () => {
		return {prompts: getPrompts()};
	});

	// Get prompt content - This is the key for 0-token context injection!
	server.setRequestHandler(GetPromptRequestSchema, async (request) => {
		const {name, arguments: promptArgs} = request.params;

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

			if (name === 'file-reader-guide') {
				const hotList =
					context.hotFiles?.files
						.map((f) => `- ${f.file} (${f.lines}L)`)
						.join('\n') || 'None detected';
				return {
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: [
									'# Smart File Reading Guide',
									'For large files, ALWAYS use this workflow to minimize tokens:',
									'1. read_file_outline → see all symbols with line ranges (~100 tokens)',
									'2. read_file_symbol → read specific function/class by name',
									'3. read_file_lines → read specific line range (max 200 lines)',
									'4. search_in_file → find pattern with context',
									'',
									'NEVER read a full file >200 lines without checking outline first.',
									'',
									'## Hot Files (large/complex — use smart reading):',
									hotList,
								].join('\n'),
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
		return {resources: getResources()};
	});

	// Read resource content
	server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
		const {uri} = request.params;

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
							? `Frameworks: ${context.stack.frameworks.map((f) => f.name).join(', ')}`
							: '',
						`Deps: ${context.stack.dependencies
							.filter((d) => !d.dev)
							.slice(0, 10)
							.map((d) => d.name)
							.join(', ')}`,
					]
						.filter(Boolean)
						.join('\n');
					break;
				case 'repo://context/structure':
					content = [
						`Entry: ${context.structure.entryPoints.join(', ')}`,
						`Folders: ${context.structure.folders.map((f) => f.path).join(', ')}`,
						`Config: ${context.structure.configFiles.join(', ')}`,
					].join('\n');
					break;
				case 'repo://context/api':
					if (context.endpoints && context.endpoints.endpoints.length > 0) {
						content = context.endpoints.endpoints
							.map((e) => `${e.method} ${e.path} → ${e.file}:${e.line}`)
							.join('\n');
					} else {
						content = 'No API endpoints detected';
					}
					break;
				case 'repo://context/models':
					if (context.models && context.models.models.length > 0) {
						content = context.models.models
							.map(
								(m) =>
									`${m.name} (${m.type}): ${m.fields.map((f) => f.name).join(', ')}`
							)
							.join('\n');
					} else {
						content = 'No data models detected';
					}
					break;
				case 'repo://context/hotfiles':
					if (context.hotFiles && context.hotFiles.files.length > 0) {
						content = context.hotFiles.files
							.map((f) => `${f.file} (${f.lines}L) - ${f.reason}`)
							.join('\n');
					} else {
						content = 'No hot files detected';
					}
					break;
				case 'repo://context/annotations': {
					const annots = await readAnnotations(PROJECT_ROOT);
					content = formatAnnotations(annots);
					break;
				}
				case 'repo://context/imports':
					if (context.importGraph && context.importGraph.nodes.length > 0) {
						const lines: string[] = [];
						if (context.importGraph.mostImported.length > 0) {
							lines.push(`Hub files: ${context.importGraph.mostImported.join(', ')}`);
						}
						if (context.importGraph.orphans.length > 0) {
							lines.push(`Orphans: ${context.importGraph.orphans.join(', ')}`);
						}
						for (const node of context.importGraph.nodes.slice(0, 10)) {
							lines.push(
								`${node.file} (←${node.importedBy}) imports: ${node.imports
									.slice(0, 5)
									.join(', ')}`
							);
						}
						content = lines.join('\n');
					} else {
						content = 'No significant import graph detected';
					}
					break;
				case 'repo://context.json':
					content = JSON.stringify(context, null, 2);
					mimeType = 'application/json';
					break;
				case 'repo://context/outlines': {
					const {getAllOutlines} = await import('./tools/file-reader.js');
					const allOutlines = await getAllOutlines(PROJECT_ROOT);
					const outlineLines: string[] = [];
					for (const [file, data] of [...allOutlines.entries()].sort((a, b) =>
						a[0].localeCompare(b[0])
					)) {
						outlineLines.push(`## ${file} (${data.totalLines}L)`);
						for (const sym of data.symbols) {
							const exp = sym.exported ? '⬆' : ' ';
							outlineLines.push(
								`${exp}${sym.type}:${sym.name} L${sym.startLine}-${sym.endLine}`
							);
						}
					}
					content =
						outlineLines.length > 0
							? outlineLines.join('\n')
							: 'No source files detected';
					break;
				}
				default: {
					// Handle dynamic file outline: repo://file/outline?path=<relative_path>
					if (uri.startsWith('repo://file/outline')) {
						const url = new URL(uri.replace('repo://', 'http://'));
						const filePath = url.searchParams.get('path');
						if (filePath) {
							const outline = await getFileOutline(PROJECT_ROOT, filePath);
							content = `[${filePath}] ${outline.totalLines}L, ${outline.symbols.length} symbols\n${outline.formatted}`;
							break;
						}
					}
					return {
						contents: [
							{
								uri,
								mimeType: 'text/plain',
								text: `Unknown resource: ${uri}`,
							},
						],
					};
				}
			}

			return {
				contents: [
					{
						uri,
						mimeType,
						text: content,
					},
				],
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				contents: [
					{
						uri,
						mimeType: 'text/plain',
						text: `Error: ${errorMessage}`,
					},
				],
			};
		}
	});

	// Handle tool calls
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const {name, arguments: args} = request.params;

		try {
			let context: ProjectContext;

			switch (name) {
				case 'get_project_context': {
					const typedArgs = args as
						| {format?: OutputFormat; force_refresh?: boolean}
						| undefined;
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
						context.stack.frameworks.length > 0
							? `fw:${context.stack.frameworks.map((f) => f.name).join(',')}`
							: '',
						context.stack.packageManager ? `pkg:${context.stack.packageManager}` : '',
						`deps:${context.stack.dependencies
							.filter((d) => !d.dev)
							.slice(0, 10)
							.map((d) => d.name)
							.join(',')}`,
					]
						.filter(Boolean)
						.join('\n');

					return {
						content: [{type: 'text', text: stackInfo}],
					};
				}

				case 'get_project_structure': {
					context = await getFullContext(PROJECT_ROOT);
					const structureInfo = [
						`→${context.structure.entryPoints.join(',')}`,
						context.structure.folders
							.map((f) => `${f.path}:${f.fileCount}`)
							.join(' '),
						`cfg:${context.structure.configFiles.join(',')}`,
					].join('\n');

					return {
						content: [{type: 'text', text: structureInfo}],
					};
				}

				case 'get_project_endpoints': {
					context = await getFullContext(PROJECT_ROOT);
					if (!context.endpoints || context.endpoints.endpoints.length === 0) {
						return {
							content: [{type: 'text', text: 'No API endpoints.'}],
						};
					}

					const endpointsInfo = [
						`API(${context.endpoints.type}):${context.endpoints.endpoints.length}`,
						...context.endpoints.endpoints
							.slice(0, 20)
							.map((ep) => `${ep.method[0]}:${ep.path}→${ep.file}:${ep.line}`),
						context.endpoints.endpoints.length > 20
							? `+${context.endpoints.endpoints.length - 20} more`
							: '',
					]
						.filter(Boolean)
						.join('\n');

					return {
						content: [{type: 'text', text: endpointsInfo}],
					};
				}

				case 'get_project_models': {
					context = await getFullContext(PROJECT_ROOT);
					if (!context.models || context.models.models.length === 0) {
						return {
							content: [{type: 'text', text: 'No models.'}],
						};
					}

					const modelsInfo = [
						`Models:${context.models.models.length}${
							context.models.ormUsed ? '|' + context.models.ormUsed : ''
						}`,
						...context.models.models.slice(0, 15).map(
							(m) =>
								`${m.name}(${m.type}):${m.fields
									.slice(0, 4)
									.map((f) => f.name)
									.join(',')}${m.fields.length > 4 ? '...' : ''}`
						),
					].join('\n');

					return {
						content: [{type: 'text', text: modelsInfo}],
					};
				}

				case 'get_project_status': {
					context = await getFullContext(PROJECT_ROOT);
					const statusInfo = [
						`${context.name}`,
						`test:${context.status.tests.testFiles}${
							context.status.tests.framework
								? '(' + context.status.tests.framework + ')'
								: ''
						}`,
						context.status.hasDocker ? 'docker:yes' : '',
						context.status.hasCI ? `ci:${context.status.ciPlatform}` : '',
						context.status.hasDocumentation ? 'docs:yes' : '',
						context.status.todos.length > 0
							? `todos:${context.status.todos.length}`
							: '',
					]
						.filter(Boolean)
						.join('|');

					return {
						content: [{type: 'text', text: statusInfo}],
					};
				}

				case 'get_project_hotfiles': {
					context = await getFullContext(PROJECT_ROOT);
					if (!context.hotFiles || context.hotFiles.files.length === 0) {
						return {
							content: [
								{
									type: 'text',
									text:
										'No hot files detected. All files are within normal complexity thresholds.',
								},
							],
						};
					}

					const hotFilesInfo = [
						`⚠ Hot Files (${context.hotFiles.files.length}):`,
						`Thresholds: lines>${context.hotFiles.thresholds.lines}, imports>${context.hotFiles.thresholds.imports}`,
						'',
						...context.hotFiles.files.map((f) => {
							const details: string[] = [`${f.lines}L`];
							if (f.imports) details.push(`${f.imports} imports`);
							if (f.exports) details.push(`${f.exports} exports`);
							if (f.todoCount) details.push(`${f.todoCount} TODOs`);
							return `  ${f.file} (${details.join(', ')}) [${f.reason}]`;
						}),
					].join('\n');

					return {
						content: [{type: 'text', text: hotFilesInfo}],
					};
				}

				case 'get_project_annotations': {
					const annotations = await readAnnotations(PROJECT_ROOT);
					return {
						content: [{type: 'text', text: formatAnnotations(annotations)}],
					};
				}

				case 'get_project_imports': {
					context = await getFullContext(PROJECT_ROOT);
					const importArgs = args as {format?: string} | undefined;
					const importFormat = importArgs?.format || 'text';

					if (!context.importGraph || context.importGraph.nodes.length === 0) {
						return {
							content: [{type: 'text', text: 'No significant import graph detected.'}],
						};
					}

					if (importFormat === 'mermaid') {
						return {
							content: [
								{type: 'text', text: formatImportGraphMermaid(context.importGraph)},
							],
						};
					}

					const importLines: string[] = [];
					if (context.importGraph.mostImported.length > 0) {
						importLines.push(`🔗 Hub files (most imported):`);
						for (const hub of context.importGraph.mostImported) {
							const node = context.importGraph.nodes.find((n) => n.file === hub);
							importLines.push(
								`  ${hub} (imported by ${node?.importedBy || '?'} files)`
							);
						}
					}
					if (context.importGraph.orphans.length > 0) {
						importLines.push(`\n🔴 Orphan files (not imported by anyone):`);
						for (const orphan of context.importGraph.orphans) {
							importLines.push(`  ${orphan}`);
						}
					}
					importLines.push(
						`\n📊 Significant nodes (${context.importGraph.nodes.length}):`
					);
					for (const node of context.importGraph.nodes.slice(0, 10)) {
						importLines.push(
							`  ${node.file} (←${node.importedBy}) → ${node.imports
								.slice(0, 5)
								.join(', ')}`
						);
					}

					return {
						content: [{type: 'text', text: importLines.join('\n')}],
					};
				}

				case 'add_annotation': {
					const addArgs = args as {category: string; text: string};
					if (!addArgs?.category || !addArgs?.text) {
						return {
							content: [
								{type: 'text', text: 'Error: category and text are required.'},
							],
							isError: true,
						};
					}
					const updated = await addAnnotation(
						PROJECT_ROOT,
						addArgs.category as keyof import('./types/index.js').Annotations,
						addArgs.text
					);
					// Invalidate cache since annotations changed
					await refreshContext(PROJECT_ROOT);
					return {
						content: [
							{
								type: 'text',
								text: `Added to ${addArgs.category}.\n\n${formatAnnotations(updated)}`,
							},
						],
					};
				}

				case 'remove_annotation': {
					const rmArgs = args as {category: string; index: number};
					if (!rmArgs?.category || rmArgs?.index === undefined) {
						return {
							content: [
								{type: 'text', text: 'Error: category and index are required.'},
							],
							isError: true,
						};
					}
					const afterRemove = await removeAnnotation(
						PROJECT_ROOT,
						rmArgs.category as keyof import('./types/index.js').Annotations,
						rmArgs.index
					);
					await refreshContext(PROJECT_ROOT);
					return {
						content: [
							{
								type: 'text',
								text: `Removed from ${rmArgs.category}.\n\n${formatAnnotations(
									afterRemove
								)}`,
							},
						],
					};
				}

				case 'list_annotations': {
					const allAnnotations = await readAnnotations(PROJECT_ROOT);
					return {
						content: [{type: 'text', text: formatAnnotations(allAnnotations)}],
					};
				}

				case 'generate_project_docs': {
					await generateDocs(PROJECT_ROOT);
					return {
						content: [
							{type: 'text', text: 'Auto-docs regenerated in .repo-context/'},
						],
					};
				}

				// ─── Smart File Reader Tools (v1.5.0) ───

				case 'read_file_outline': {
					const outlineArgs = args as {file: string};
					if (!outlineArgs?.file) {
						return {
							content: [{type: 'text', text: 'Error: file is required.'}],
							isError: true,
						};
					}
					const outline = await getFileOutline(PROJECT_ROOT, outlineArgs.file);
					return {
						content: [
							{
								type: 'text',
								text: `[${outlineArgs.file}] ${outline.totalLines} lines, ${outline.symbols.length} symbols\n${outline.formatted}`,
							},
						],
					};
				}

				case 'read_file_lines': {
					const linesArgs = args as {
						file: string;
						start_line: number;
						end_line: number;
					};
					if (!linesArgs?.file || !linesArgs.start_line || !linesArgs.end_line) {
						return {
							content: [
								{
									type: 'text',
									text: 'Error: file, start_line and end_line are required.',
								},
							],
							isError: true,
						};
					}
					const linesContent = await readFileLines(
						PROJECT_ROOT,
						linesArgs.file,
						linesArgs.start_line,
						linesArgs.end_line
					);
					return {
						content: [{type: 'text', text: linesContent}],
					};
				}

				case 'read_file_symbol': {
					const symArgs = args as {file: string; symbol: string};
					if (!symArgs?.file || !symArgs?.symbol) {
						return {
							content: [{type: 'text', text: 'Error: file and symbol are required.'}],
							isError: true,
						};
					}
					const symbolContent = await readFileSymbol(
						PROJECT_ROOT,
						symArgs.file,
						symArgs.symbol
					);
					return {
						content: [{type: 'text', text: symbolContent}],
					};
				}

				case 'search_in_file': {
					const searchArgs = args as {
						file: string;
						pattern: string;
						context_lines?: number;
					};
					if (!searchArgs?.file || !searchArgs?.pattern) {
						return {
							content: [{type: 'text', text: 'Error: file and pattern are required.'}],
							isError: true,
						};
					}
					const searchResult = await searchInFile(
						PROJECT_ROOT,
						searchArgs.file,
						searchArgs.pattern,
						searchArgs.context_lines
					);
					return {
						content: [{type: 'text', text: searchResult}],
					};
				}

				default:
					return {
						content: [{type: 'text', text: `Unknown: ${name}`}],
						isError: true,
					};
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				content: [{type: 'text', text: `Error: ${errorMessage}`}],
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

	// AUTO-INJECT: Pre-load context and generate auto-docs
	try {
		const context = await getFullContext(PROJECT_ROOT);

		// Log to stderr (visible to user, not consumed as tokens)
		console.error(`\n[repo-context] Project loaded: ${context.name}`);
		console.error(`[repo-context] Generating auto-docs...`);

		// Generate .repo-context/*.md files
		await generateDocs(PROJECT_ROOT);

		// Start file watcher for auto-updates
		startWatcher(PROJECT_ROOT);

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
