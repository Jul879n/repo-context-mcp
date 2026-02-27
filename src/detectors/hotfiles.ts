import * as fs from 'fs/promises';
import * as path from 'path';
import {HotFile, HotFilesInfo, Language} from '../types/index.js';

// Thresholds for hot file detection
const THRESHOLDS = {
	lines: 300,
	imports: 15,
	exports: 20,
	todos: 3,
};

// Source file extensions per language
const EXTENSIONS: Record<Language, string[]> = {
	typescript: ['.ts', '.tsx'],
	javascript: ['.js', '.jsx', '.mjs', '.cjs'],
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

// Skip directories
const SKIP_DIRS = new Set([
	'node_modules',
	'vendor',
	'venv',
	'.venv',
	'env',
	'.env',
	'target',
	'build',
	'dist',
	'out',
	'.git',
	'__pycache__',
	'.next',
	'.nuxt',
	'.svelte-kit',
	'coverage',
	'.cache',
]);

// Import patterns per language
const IMPORT_PATTERNS: Record<string, RegExp[]> = {
	typescript: [/^import\s/gm, /^import\(/gm, /require\(/gm],
	javascript: [/^import\s/gm, /require\(/gm],
	python: [/^import\s/gm, /^from\s+\S+\s+import/gm],
	rust: [/^use\s/gm],
	go: [/^\s*"[^"]+"/gm],
	java: [/^import\s/gm],
	kotlin: [/^import\s/gm],
	csharp: [/^using\s/gm],
	php: [/^use\s/gm],
	ruby: [/^require/gm],
	swift: [/^import\s/gm],
	dart: [/^import\s/gm],
};

// Export patterns
const EXPORT_PATTERNS: Record<string, RegExp[]> = {
	typescript: [/^export\s/gm, /^export\s*\{/gm, /^export\s+default/gm],
	javascript: [/^export\s/gm, /module\.exports/gm],
	python: [/^def\s/gm, /^class\s/gm],
	rust: [/^pub\s/gm],
	go: [/^func\s+[A-Z]/gm],
	java: [/^public\s/gm],
	kotlin: [/^fun\s/gm, /^class\s/gm],
	csharp: [/^public\s/gm],
	php: [/^public\s+function/gm],
	ruby: [/^def\s/gm],
	swift: [/^public\s/gm, /^func\s/gm],
	dart: [/^class\s/gm],
};

// TODO patterns
const TODO_PATTERN = /\/\/\s*(TODO|FIXME|HACK|BUG|XXX):?\s/gi;

export async function detectHotFiles(
	projectRoot: string,
	language: Language
): Promise<HotFilesInfo> {
	const hotFiles: HotFile[] = [];
	const extensions = EXTENSIONS[language] || [];

	if (extensions.length === 0) {
		return {files: [], thresholds: THRESHOLDS};
	}

	await scanDirectory(projectRoot, extensions, language, hotFiles, projectRoot);

	// Sort by lines descending (most problematic first)
	hotFiles.sort((a, b) => b.lines - a.lines);

	return {
		files: hotFiles.slice(0, 10), // Top 10
		thresholds: THRESHOLDS,
	};
}

async function scanDirectory(
	dir: string,
	extensions: string[],
	language: Language,
	hotFiles: HotFile[],
	projectRoot: string,
	depth = 0
): Promise<void> {
	if (depth > 8) return;

	try {
		const entries = await fs.readdir(dir, {withFileTypes: true});

		for (const entry of entries) {
			if (entry.name.startsWith('.')) continue;

			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) {
					await scanDirectory(
						fullPath,
						extensions,
						language,
						hotFiles,
						projectRoot,
						depth + 1
					);
				}
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (extensions.includes(ext)) {
					await analyzeFile(fullPath, language, hotFiles, projectRoot);
				}
			}
		}
	} catch {
		// Ignore errors
	}
}

async function analyzeFile(
	filePath: string,
	language: Language,
	hotFiles: HotFile[],
	projectRoot: string
): Promise<void> {
	try {
		const content = await fs.readFile(filePath, 'utf-8');
		const lines = content.split('\n').length;
		const relativePath = path.relative(projectRoot, filePath);

		// Count imports
		const importPatterns = IMPORT_PATTERNS[language] || [];
		let imports = 0;
		for (const pattern of importPatterns) {
			pattern.lastIndex = 0;
			const matches = content.match(pattern);
			imports += matches?.length || 0;
		}

		// Count exports
		const exportPatterns = EXPORT_PATTERNS[language] || [];
		let exports = 0;
		for (const pattern of exportPatterns) {
			pattern.lastIndex = 0;
			const matches = content.match(pattern);
			exports += matches?.length || 0;
		}

		// Count TODOs
		TODO_PATTERN.lastIndex = 0;
		const todoMatches = content.match(TODO_PATTERN);
		const todoCount = todoMatches?.length || 0;

		// Determine reasons for being "hot"
		const reasons: string[] = [];
		if (lines > THRESHOLDS.lines) reasons.push('oversized');
		if (imports > THRESHOLDS.imports) reasons.push('high-imports');
		if (exports > THRESHOLDS.exports) reasons.push('high-exports');
		if (todoCount > THRESHOLDS.todos) reasons.push('todo-dense');

		// Only add if at least one reason
		if (reasons.length > 0) {
			hotFiles.push({
				file: relativePath,
				lines,
				reason: reasons.join(','),
				imports: imports > 0 ? imports : undefined,
				exports: exports > 0 ? exports : undefined,
				todoCount: todoCount > 0 ? todoCount : undefined,
			});
		}
	} catch {
		// Ignore errors
	}
}
