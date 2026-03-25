import {Tool} from '@modelcontextprotocol/sdk/types.js';

// Define available tools - OPTIMIZED: only non-redundant tools exposed
// Removed tools still work via handlers for backward compatibility,
// but are NOT listed = fewer tokens per API message.
export const tools: Tool[] = [
	{
		name: 'get_project_context',
		description:
			'Call FIRST. Returns project context. Use section param for specific info.',
		inputSchema: {
			type: 'object',
			properties: {
				format: {
					type: 'string',
					enum: ['ultra', 'compact', 'normal', 'minimal', 'json'],
					description: 'Output format (default: compact)',
				},
				section: {
					type: 'string',
					enum: [
						'all',
						'stack',
						'structure',
						'endpoints',
						'models',
						'status',
						'hotfiles',
						'modified',
						'imports',
						'annotations',
					],
					description: 'Specific section (default: all). Use "modified" for git-modified files only.',
				},
				force_refresh: {
					type: 'boolean',
					description: 'Force re-analysis',
				},
			},
			required: [],
		},
	},
	{
		name: 'annotate',
		description:
			'Add/remove/list project annotations (business rules, gotchas, warnings).',
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['list', 'add', 'remove'],
					description: 'Action to perform',
				},
				category: {
					type: 'string',
					enum: ['businessRules', 'gotchas', 'warnings'],
					description: 'Category (required for add/remove)',
				},
				text: {
					type: 'string',
					description: 'Text to add (required for add)',
				},
				index: {
					type: 'number',
					description: 'Index to remove (required for remove)',
				},
			},
			required: ['action'],
		},
	},
	{
		name: 'read_file',
		description:
			'Smart reader. <200L: full content. >200L: outline. Optional line range.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {
					type: 'string',
					description: 'Relative path to file (also accepts file_path)',
				},
				file_path: {
					type: 'string',
					description: 'Alias for file',
				},
				start_line: {type: 'number', description: 'Start line'},
				end_line: {type: 'number', description: 'End line'},
			},
			required: [],
		},
	},
	{
		name: 'read_file_outline',
		description: 'File outline: symbols with line ranges (~100 tokens). Use depth=1 for top-level only (~80t vs ~450t on complex files).',
		inputSchema: {
			type: 'object',
			properties: {
				file: {type: 'string', description: 'Relative path (also accepts file_path)'},
				file_path: {type: 'string', description: 'Alias for file'},
				depth: {type: 'number', description: 'Symbol depth: 1 = top-level only (no nested consts/functions). Reduces ~450t to ~80t for complex files.'},
			},
			required: [],
		},
	},
	{
		name: 'read_file_symbol',
		description: 'Read function/class by name. Fuzzy matching supported.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {type: 'string', description: 'Relative path (also accepts file_path)'},
				file_path: {type: 'string', description: 'Alias for file'},
				symbol: {type: 'string', description: 'Symbol name'},
			},
			required: ['symbol'],
		},
	},
	{
		name: 'search_in_file',
		description: 'Search pattern in file. Regex supported.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {type: 'string', description: 'Relative path (also accepts file_path)'},
				file_path: {type: 'string', description: 'Alias for file'},
				pattern: {type: 'string', description: 'Pattern (string/regex)'},
				context_lines: {type: 'number', description: 'Context lines (default: 2)'},
				max_matches: {type: 'number', description: 'Max matches (default: 50)'},
			},
			required: ['pattern'],
		},
	},
	{
		name: 'search_in_project',
		description:
			'Search across all project files. Default: 1-line compact output — total matches, file count, top 10 hottest files. Use max_files=N for code detail on N files. Use max_files=-1 with file_pattern to get all matching files grouped and sorted (replaces grep).',
		inputSchema: {
			type: 'object',
			properties: {
				pattern: {type: 'string', description: 'Pattern (string/regex)'},
				file_pattern: {
					type: 'string',
					description: 'Glob filter. Supports multi-glob: "*.ts,*.tsx" or brace expansion "*.{ts,tsx}". With max_files=-1 acts as grep replacement',
				},
				max_results: {
					type: 'number',
					description: 'Max matches shown per file in detail (default: 30)',
				},
				context_lines: {type: 'number', description: 'Context lines around each match (default: 0)'},
				max_files: {
					type: 'number',
					description:
						'Files to show code detail for (default: 0 = compact summary only). Use max_files=5 to see code. Use max_files=-1 with file_pattern to show ALL matching files grouped by file, sorted by match count — respects .gitignore, skips binaries.',
				},
				exclude_pattern: {
					type: 'string',
					description:
						'Glob pattern to exclude files (e.g. "*.md", "docs/**"). Comma-separated for multiple patterns.',
				},
			},
			required: ['pattern'],
		},
	},
	{
		name: 'list_files',
		description: 'List files/dirs. Respects .gitignore.',
		inputSchema: {
			type: 'object',
			properties: {
				path: {type: 'string', description: 'Dir path (default: root)'},
				pattern: {type: 'string', description: 'Glob filter'},
				max_depth: {type: 'number', description: 'Depth (default: 3)'},
			},
			required: [],
		},
	},
	{
		name: 'generate_project_docs',
		description: 'Regenerate .reposynapse/ docs. Usually automatic.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'get_diagnostics',
		description:
			'Run project diagnostics and return ONLY fatal errors. Auto-detects language (TypeScript, Rust, Go, Python, .NET, Java, Ruby, Swift, PHP) and runs the appropriate checker. Spelling errors and warnings are filtered out to save tokens.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'search_symbol',
		description:
			'Search for a symbol (function, class, interface, type, const, enum) across project files. Returns file location, type, signature, and exported status. Supports fuzzy matching and regex (e.g. "get.*Context"). Use path_filter to limit search scope. Use context_filter to find symbols by return type or param type.',
		inputSchema: {
			type: 'object',
			properties: {
				name: {type: 'string', description: 'Symbol name(s) to search for. Comma-separated for multi-search: "handleDelete,handleEdit". Supports fuzzy matching and regex: "get.*Context", "handle(Create|Update)".'},
				type: {
					type: 'string',
					description: 'Filter by symbol type',
					enum: ['function', 'class', 'interface', 'type', 'const', 'enum', 'method', 'export'],
				},
				exported_only: {
					type: 'boolean',
					description: 'Only return exported symbols (default: false)',
				},
				context_filter: {
					type: 'object',
					description: 'Filter symbols by signature content. Useful to find "all async functions" or "all functions that take a User param" without writing regex.',
					properties: {
						returns_type: {type: 'string', description: 'Filter symbols whose return type contains this string (e.g. "Promise", "string[]", "void")'},
						has_param_type: {type: 'string', description: 'Filter symbols that have a parameter of this type (e.g. "User", "Request", "number")'},
					},
				},
				context_lines: {
					type: 'number',
					description: 'Show the first N lines of each matched symbol body. Useful to preview code without reading the full file. Default: 0 (no preview).',
				},
				path_filter: {
					type: 'string',
					description: 'Filter files by path pattern. Supports glob ("src/**/*.ts") or substring ("src/tools"). Comma-separated for multiple patterns.',
				},
			},
			required: ['name'],
		},
	},
	{
		name: 'get_complexity',
		description:
			'List functions/methods above complexity thresholds (too many lines or params). Ultra-compact output to help prioritize what to refactor without reading every file.',
		inputSchema: {
			type: 'object',
			properties: {
				file_pattern: {type: 'string', description: 'Glob pattern to limit analysis (e.g. "src/**/*.ts"). Omit to scan all source files.'},
				min_lines: {type: 'number', description: 'Minimum lines in function body to flag (default: 30)'},
				min_params: {type: 'number', description: 'Minimum parameter count to flag (default: 4)'},
			},
		},
	},
	{
		name: 'patch_file',
		description:
			'Apply a unified diff patch to a file. The AI only sends changed lines, not the full file — saves tokens on large files.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {type: 'string', description: 'Relative file path to patch'},
				patch: {type: 'string', description: 'Unified diff string (hunks starting with @@ -L,N +L,N @@)'},
			},
			required: ['file', 'patch'],
		},
	},
	{
		name: 'replace_symbol',
		description:
			'Replace the full body of a named function, class, or interface. The AI sends only the new implementation — no need to read the full file first.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {type: 'string', description: 'Relative file path'},
				symbol: {type: 'string', description: 'Exact name of the function, class, or interface to replace'},
				new_body: {type: 'string', description: 'Complete new implementation (including the function signature line)'},
			},
			required: ['file', 'symbol', 'new_body'],
		},
	},
	{
		name: 'insert_after_symbol',
		description:
			'Insert code immediately after a named function or class. Useful for adding a new method or helper next to a related one.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {type: 'string', description: 'Relative file path'},
				symbol: {type: 'string', description: 'Name of the symbol to insert after'},
				code: {type: 'string', description: 'Code to insert (will be placed after the closing line of the symbol)'},
			},
			required: ['file', 'symbol', 'code'],
		},
	},
	{
		name: 'batch_rename',
		description:
			'Rename a symbol (word-boundary match) across all source files in the project. Returns a list of modified files and replacement count.',
		inputSchema: {
			type: 'object',
			properties: {
				old_name: {type: 'string', description: 'Current symbol name to find'},
				new_name: {type: 'string', description: 'New name to replace it with'},
				file_pattern: {type: 'string', description: 'Optional path substring to limit scope (e.g. "src/components")'},
			},
			required: ['old_name', 'new_name'],
		},
	},
	{
		name: 'add_import',
		description:
			'Add an import statement to a file. Automatically checks for duplicates and inserts after the last existing import.',
		inputSchema: {
			type: 'object',
			properties: {
				file: {type: 'string', description: 'Relative file path'},
				import_statement: {type: 'string', description: 'Full import statement to add (e.g. "import { useState } from \'react\'")'},
			},
			required: ['file', 'import_statement'],
		},
	},
	{
		name: 'remove_dead_code',
		description:
			'Find exported symbols that are never imported by any other file in the project. dry_run=true (default) reports only; dry_run=false deletes them.',
		inputSchema: {
			type: 'object',
			properties: {
				file_pattern: {type: 'string', description: 'Limit analysis to files matching this path substring'},
				dry_run: {type: 'boolean', description: 'If true (default), only report — do not delete'},
			},
		},
	},
];
