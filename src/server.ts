import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	ListPromptsRequestSchema,
	GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
	getFullContext,
	refreshContext,
	analyzeProject,
	getGitModifiedFiles,
	generateDocs,
	getFileOutline,
	readFileLines,
	readFileSymbol,
	searchInFile,
	searchInProject,
	listFiles,
	readFile,
	getDiagnostics,
	searchSymbolInProject,
	getComplexityReport,
	patchFile,
	replaceSymbol,
	insertAfterSymbol,
	batchRename,
	addImport,
	removeDeadCode,
} from './tools/index.js';
import {ProjectContext} from './types/index.js';
import {startWatcher} from './watcher.js';
import {formatCompact, formatMinimal} from './formatters/index.js';
import {
	formatImportGraphMermaid,
	readAnnotations,
	addAnnotation,
	removeAnnotation,
	formatAnnotations,
} from './detectors/index.js';
import {tools} from './server/tool-definitions.js';
import {getPrompts, getResources} from './server/definitions.js';
import {OutputFormat, formatByType} from './server/formatters.js';

// Get project root from environment or current directory
const PROJECT_ROOT = process.env.REPOSYNAPSE_ROOT || process.cwd();

// Create and configure the server
export function createServer(): Server {
	const server = new Server(
		{
			name: 'reposynapse',
			version: '1.5.3',
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
				case 'reposynapse://context/summary':
					content = formatMinimal(context);
					break;
				case 'reposynapse://context/full':
					content = formatCompact(context);
					break;
				case 'reposynapse://context/stack':
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
				case 'reposynapse://context/structure':
					content = [
						`Entry: ${context.structure.entryPoints.join(', ')}`,
						`Folders: ${context.structure.folders.map((f) => f.path).join(', ')}`,
						`Config: ${context.structure.configFiles.join(', ')}`,
					].join('\n');
					break;
				case 'reposynapse://context/api':
					if (context.endpoints && context.endpoints.endpoints.length > 0) {
						content = context.endpoints.endpoints
							.map((e) => `${e.method} ${e.path} → ${e.file}:${e.line}`)
							.join('\n');
					} else {
						content = 'No API endpoints detected';
					}
					break;
				case 'reposynapse://context/models':
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
				case 'reposynapse://context/hotfiles':
					if (context.hotFiles && context.hotFiles.files.length > 0) {
						content = context.hotFiles.files
							.map((f) => `${f.file} (${f.lines}L) - ${f.reason}`)
							.join('\n');
					} else {
						content = 'No hot files detected';
					}
					break;
				case 'reposynapse://context/annotations': {
					const annots = await readAnnotations(PROJECT_ROOT);
					content = formatAnnotations(annots);
					break;
				}
				case 'reposynapse://context/imports':
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
				case 'reposynapse://context.json':
					content = JSON.stringify(context, null, 2);
					mimeType = 'application/json';
					break;
				case 'reposynapse://context/outlines': {
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
						| {format?: OutputFormat; section?: string; force_refresh?: boolean}
						| undefined;
					const format = typedArgs?.format ?? 'compact';
					const forceRefresh = typedArgs?.force_refresh ?? false;
					const section = typedArgs?.section ?? 'all';
					context = await getFullContext(PROJECT_ROOT, forceRefresh);

					// Handle specific section requests
					if (section !== 'all') {
						let sectionText = '';
						switch (section) {
							case 'stack':
								sectionText = [
									`${context.name}|${context.stack.primaryLanguage}`,
									context.stack.frameworks.length > 0
										? `fw:${context.stack.frameworks.map((f) => f.name).join(',')}`
										: '',
									context.stack.packageManager
										? `pkg:${context.stack.packageManager}`
										: '',
									`deps:${context.stack.dependencies
										.filter((d) => !d.dev)
										.slice(0, 10)
										.map((d) => d.name)
										.join(',')}`,
								]
									.filter(Boolean)
									.join('\n');
								break;
							case 'structure':
								sectionText = [
									`→${context.structure.entryPoints.join(',')}`,
									context.structure.folders
										.map((f) => `${f.path}:${f.fileCount}`)
										.join(' '),
									`cfg:${context.structure.configFiles.join(',')}`,
								].join('\n');
								break;
							case 'endpoints':
								sectionText = context.endpoints?.endpoints.length
									? context.endpoints.endpoints
											.slice(0, 20)
											.map((ep) => `${ep.method[0]}:${ep.path}→${ep.file}:${ep.line}`)
											.join('\n')
									: 'No API endpoints.';
								break;
							case 'models':
								sectionText = context.models?.models.length
									? context.models.models
											.slice(0, 15)
											.map(
												(m) =>
													`${m.name}(${m.type}):${m.fields
														.slice(0, 4)
														.map((f) => f.name)
														.join(',')}`
											)
											.join('\n')
									: 'No models.';
								break;
							case 'status':
								sectionText = [
									`test:${context.status.tests.testFiles}${
										context.status.tests.framework
											? '(' + context.status.tests.framework + ')'
											: ''
									}`,
									context.status.hasDocker ? 'docker:yes' : '',
									context.status.hasCI ? `ci:${context.status.ciPlatform}` : '',
									context.status.todos.length > 0
										? `todos:${context.status.todos.length}`
										: '',
								]
									.filter(Boolean)
									.join('|');
								break;
							case 'hotfiles':
								sectionText = context.hotFiles?.files.length
									? context.hotFiles.files
											.map((f) => `${f.file} (${f.lines}L) [${f.reason}]`)
											.join('\n')
									: 'No hot files.';
								break;
							case 'modified': {
								const modFiles = await getGitModifiedFiles(PROJECT_ROOT);
								if (modFiles.size === 0) {
									sectionText = 'No git-modified files.';
								} else {
									const modLines: string[] = [];
									for (const mf of modFiles) {
										const hf = context.hotFiles?.files.find((f) => f.file === mf);
										const lineInfo = hf ? ` (${hf.lines}L)` : '';
										modLines.push(`${mf}${lineInfo}`);
									}
									sectionText = `${modFiles.size} modified files:\n${modLines.join('\n')}`;
								}
								break;
							}
							case 'imports':
								if (context.importGraph?.nodes.length) {
									const lines: string[] = [];
									if (context.importGraph.mostImported.length)
										lines.push(`Hub: ${context.importGraph.mostImported.join(', ')}`);
									if (context.importGraph.orphans.length)
										lines.push(`Orphans: ${context.importGraph.orphans.join(', ')}`);
									sectionText = lines.join('\n');
								} else {
									sectionText = 'No import graph.';
								}
								break;
							case 'annotations': {
								const annots = await readAnnotations(PROJECT_ROOT);
								sectionText = formatAnnotations(annots);
								break;
							}
							default:
								sectionText = `Unknown section: ${section}`;
						}
						return {content: [{type: 'text', text: sectionText}]};
					}

					return {
						content: [
							{
								type: 'text',
								text: formatByType(context, format),
							},
						],
					};
				}

				// ─── Unified annotate handler ───
				case 'annotate': {
					const aArgs = args as {
						action: string;
						category?: string;
						text?: string;
						index?: number;
					};
					if (!aArgs?.action) {
						return {
							content: [
								{type: 'text', text: 'Error: action is required (list/add/remove).'},
							],
							isError: true,
						};
					}
					if (aArgs.action === 'list') {
						const allAnnotations = await readAnnotations(PROJECT_ROOT);
						return {
							content: [{type: 'text', text: formatAnnotations(allAnnotations)}],
						};
					}
					if (aArgs.action === 'add') {
						if (!aArgs.category || !aArgs.text) {
							return {
								content: [
									{type: 'text', text: 'Error: category and text required for add.'},
								],
								isError: true,
							};
						}
						const updated = await addAnnotation(
							PROJECT_ROOT,
							aArgs.category as keyof import('./types/index.js').Annotations,
							aArgs.text
						);
						await refreshContext(PROJECT_ROOT);
						return {
							content: [
								{
									type: 'text',
									text: `Added to ${aArgs.category}.\n\n${formatAnnotations(updated)}`,
								},
							],
						};
					}
					if (aArgs.action === 'remove') {
						if (!aArgs.category || aArgs.index === undefined) {
							return {
								content: [
									{type: 'text', text: 'Error: category and index required for remove.'},
								],
								isError: true,
							};
						}
						const afterRemove = await removeAnnotation(
							PROJECT_ROOT,
							aArgs.category as keyof import('./types/index.js').Annotations,
							aArgs.index
						);
						await refreshContext(PROJECT_ROOT);
						return {
							content: [
								{
									type: 'text',
									text: `Removed from ${aArgs.category}.\n\n${formatAnnotations(
										afterRemove
									)}`,
								},
							],
						};
					}
					return {
						content: [{type: 'text', text: `Unknown action: ${aArgs.action}`}],
						isError: true,
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
							{type: 'text', text: 'Auto-docs regenerated in .reposynapse/'},
						],
					};
				}

				// ─── Smart File Reader Tools (v1.5.0) ───

				case 'read_file_outline': {
					const outlineArgs = args as {file?: string; file_path?: string; depth?: number};
					const outlineFile = outlineArgs?.file || outlineArgs?.file_path;
					if (!outlineFile) {
						return {
							content: [{type: 'text', text: 'Error: file is required.'}],
							isError: true,
						};
					}
					const outline = await getFileOutline(PROJECT_ROOT, outlineFile, outlineArgs.depth);
					const depthNote = outlineArgs.depth === 1 ? ' (top-level only)' : '';
					return {
						content: [
							{
								type: 'text',
								text: `[${outlineFile}] ${outline.totalLines} lines, ${outline.symbols.length} symbols${depthNote}\n${outline.formatted}`,
							},
						],
					};
				}

				case 'read_file_lines': {
					const linesArgs = args as {
						file?: string;
						file_path?: string;
						start_line: number;
						end_line: number;
					};
					const linesFile = linesArgs?.file || linesArgs?.file_path;
					if (!linesFile || !linesArgs.start_line || !linesArgs.end_line) {
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
						linesFile,
						linesArgs.start_line,
						linesArgs.end_line
					);
					return {
						content: [{type: 'text', text: linesContent}],
					};
				}

				case 'read_file_symbol': {
					const symArgs = args as {file?: string; file_path?: string; symbol: string};
					const symFile = symArgs?.file || symArgs?.file_path;
					if (!symFile || !symArgs?.symbol) {
						return {
							content: [{type: 'text', text: 'Error: file and symbol are required.'}],
							isError: true,
						};
					}
					const symbolContent = await readFileSymbol(
						PROJECT_ROOT,
						symFile,
						symArgs.symbol
					);
					return {
						content: [{type: 'text', text: symbolContent}],
					};
				}

				case 'search_in_file': {
					const searchArgs = args as {
						file?: string;
						file_path?: string;
						pattern: string;
						context_lines?: number;
						max_matches?: number;
					};
					const searchFile = searchArgs?.file || searchArgs?.file_path;
					if (!searchFile || !searchArgs?.pattern) {
						return {
							content: [{type: 'text', text: 'Error: file and pattern are required.'}],
							isError: true,
						};
					}
					const searchResult = await searchInFile(
						PROJECT_ROOT,
						searchFile,
						searchArgs.pattern,
						searchArgs.context_lines,
						searchArgs.max_matches
					);
					return {
						content: [{type: 'text', text: searchResult}],
					};
				}

				case 'search_in_project': {
					const spArgs = args as {
						pattern: string;
						file_pattern?: string;
						max_results?: number;
						context_lines?: number;
						max_files?: number;
						exclude_pattern?: string;
					};
					if (!spArgs?.pattern) {
						return {
							content: [{type: 'text', text: 'Error: pattern is required.'}],
							isError: true,
						};
					}
					const projectSearchResult = await searchInProject(
						PROJECT_ROOT,
						spArgs.pattern,
						spArgs.file_pattern,
						spArgs.max_results,
						spArgs.context_lines,
						spArgs.max_files,
						spArgs.exclude_pattern
					);
					return {
						content: [{type: 'text', text: projectSearchResult}],
					};
				}


				case 'search_symbol': {
					const ssArgs = args as {
						name: string;
						type?: string;
						exported_only?: boolean;
						context_filter?: {returns_type?: string; has_param_type?: string};
						context_lines?: number;
					};
					if (!ssArgs?.name) {
						return {
							content: [{type: 'text', text: 'Error: name is required.'}],
							isError: true,
						};
					}
					const symbolResult = await searchSymbolInProject(
						PROJECT_ROOT,
						ssArgs.name,
						ssArgs.type,
						ssArgs.exported_only,
						ssArgs.context_filter,
						ssArgs.context_lines
					);
					return {
						content: [{type: 'text', text: symbolResult}],
					};
				}

				case 'get_complexity': {
					const gcArgs = args as {
						file_pattern?: string;
						min_lines?: number;
						min_params?: number;
					};
					const complexityResult = await getComplexityReport(
						PROJECT_ROOT,
						gcArgs?.file_pattern,
						gcArgs?.min_lines,
						gcArgs?.min_params
					);
					return {
						content: [{type: 'text', text: complexityResult}],
					};
				}

				case 'patch_file': {
					const pfArgs = args as {file?: string; file_path?: string; patch: string};
					const pfFile = pfArgs?.file || pfArgs?.file_path;
					if (!pfFile || !pfArgs?.patch) {
						return {content: [{type: 'text', text: 'Error: file and patch are required.'}], isError: true};
					}
					const pfResult = await patchFile(PROJECT_ROOT, pfFile, pfArgs.patch);
					return {content: [{type: 'text', text: pfResult}]};
				}

				case 'replace_symbol': {
					const rsArgs = args as {file?: string; file_path?: string; symbol: string; new_body: string};
					const rsFile = rsArgs?.file || rsArgs?.file_path;
					if (!rsFile || !rsArgs?.symbol || rsArgs?.new_body === undefined) {
						return {content: [{type: 'text', text: 'Error: file, symbol, and new_body are required.'}], isError: true};
					}
					const rsResult = await replaceSymbol(PROJECT_ROOT, rsFile, rsArgs.symbol, rsArgs.new_body);
					return {content: [{type: 'text', text: rsResult}]};
				}

				case 'insert_after_symbol': {
					const iaArgs = args as {file?: string; file_path?: string; symbol: string; code: string};
					const iaFile = iaArgs?.file || iaArgs?.file_path;
					if (!iaFile || !iaArgs?.symbol || iaArgs?.code === undefined) {
						return {content: [{type: 'text', text: 'Error: file, symbol, and code are required.'}], isError: true};
					}
					const iaResult = await insertAfterSymbol(PROJECT_ROOT, iaFile, iaArgs.symbol, iaArgs.code);
					return {content: [{type: 'text', text: iaResult}]};
				}

				case 'batch_rename': {
					const brArgs = args as {old_name: string; new_name: string; file_pattern?: string};
					if (!brArgs?.old_name || !brArgs?.new_name) {
						return {content: [{type: 'text', text: 'Error: old_name and new_name are required.'}], isError: true};
					}
					const brResult = await batchRename(PROJECT_ROOT, brArgs.old_name, brArgs.new_name, brArgs.file_pattern);
					return {content: [{type: 'text', text: brResult}]};
				}

				case 'add_import': {
					const aiArgs = args as {file?: string; file_path?: string; import_statement: string};
					const aiFile = aiArgs?.file || aiArgs?.file_path;
					if (!aiFile || !aiArgs?.import_statement) {
						return {content: [{type: 'text', text: 'Error: file and import_statement are required.'}], isError: true};
					}
					const aiResult = await addImport(PROJECT_ROOT, aiFile, aiArgs.import_statement);
					return {content: [{type: 'text', text: aiResult}]};
				}

				case 'remove_dead_code': {
					const rdArgs = args as {file_pattern?: string; dry_run?: boolean};
					const rdResult = await removeDeadCode(PROJECT_ROOT, rdArgs?.file_pattern, rdArgs?.dry_run ?? true);
					return {content: [{type: 'text', text: rdResult}]};
				}

				case 'list_files': {
					const lfArgs = args as {
						path?: string;
						pattern?: string;
						max_depth?: number;
					};
					const listResult = await listFiles(
						PROJECT_ROOT,
						lfArgs?.path,
						lfArgs?.pattern,
						lfArgs?.max_depth
					);
					return {
						content: [{type: 'text', text: listResult}],
					};
				}

				case 'read_file': {
					const rfArgs = args as {
						file?: string;
						file_path?: string;
						start_line?: number;
						end_line?: number;
					};
					const rfFile = rfArgs?.file || rfArgs?.file_path;
					if (!rfFile) {
						return {
							content: [{type: 'text', text: 'Error: file is required.'}],
							isError: true,
						};
					}
					const readResult = await readFile(
						PROJECT_ROOT,
						rfFile,
						rfArgs.start_line,
						rfArgs.end_line
					);
					return {
						content: [{type: 'text', text: readResult}],
					};
				}

				case 'get_diagnostics': {
					const diagResult = await getDiagnostics(PROJECT_ROOT);
					return {
						content: [
							{
								type: 'text',
								text: [
									`[Diagnostics] Language: ${diagResult.language} | Command: ${diagResult.command}`,
									`Fatal errors: ${diagResult.errorCount} | Noise filtered: ${diagResult.filteredLines} lines`,
									`---`,
									diagResult.output,
								].join('\n'),
							},
						],
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
		console.error(`\n[reposynapse] Project loaded: ${context.name}`);
		console.error(`[reposynapse] Generating auto-docs...`);

		// Generate .reposynapse/*.md files
		await generateDocs(PROJECT_ROOT);

		// Start file watcher for auto-updates
		startWatcher(PROJECT_ROOT);

		// Notify resource change so clients know context is ready
		server.notification({
			method: 'notifications/resources/list_changed',
		});
	} catch (error) {
		console.error('[reposynapse] Warning: Could not pre-load context:', error);
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
