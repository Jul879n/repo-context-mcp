import * as fs from 'fs/promises';
import * as path from 'path';
import {ImportGraphInfo, ImportNode, Language} from '../types/index.js';

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

// Extensions per language
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

// Import extraction patterns — capture the imported path
const IMPORT_PATH_PATTERNS: Record<string, RegExp[]> = {
	typescript: [
		/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
		/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/import\s+['"]([^'"]+)['"]/g,
	],
	javascript: [
		/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
		/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/import\s+['"]([^'"]+)['"]/g,
	],
	python: [/^from\s+(\S+)\s+import/gm, /^import\s+(\S+)/gm],
	rust: [/^use\s+(crate::\S+)/gm, /^use\s+super::/gm],
	go: [/^\s*"([^"]+)"/gm],
	java: [/^import\s+([\w.]+)/gm],
	kotlin: [/^import\s+([\w.]+)/gm],
	csharp: [/^using\s+([\w.]+)/gm],
	php: [/^use\s+([\w\\]+)/gm],
	ruby: [/require(?:_relative)?\s+['"]([^'"]+)['"]/g],
	swift: [/^import\s+(\w+)/gm],
	dart: [/^import\s+['"]([^'"]+)['"]/gm],
};

/**
 * Checks if an import path is internal (relative or project-local)
 */
function isInternalImport(importPath: string, language: Language): boolean {
	if (language === 'typescript' || language === 'javascript') {
		return importPath.startsWith('.') || importPath.startsWith('/');
	}
	if (language === 'python') {
		return importPath.startsWith('.');
	}
	if (language === 'rust') {
		return importPath.startsWith('crate::') || importPath.startsWith('super::');
	}
	// For other languages, consider relative paths as internal
	return importPath.startsWith('.');
}

/**
 * Resolve an import path to a relative file path from project root
 */
function resolveImportPath(
	importPath: string,
	sourceFile: string,
	projectRoot: string,
	language: Language
): string | null {
	try {
		if (language === 'typescript' || language === 'javascript') {
			const sourceDir = path.dirname(path.join(projectRoot, sourceFile));
			let resolved = path.resolve(sourceDir, importPath);
			// Remove extension if present and normalize
			resolved = path.relative(projectRoot, resolved);
			// Remove common extensions for matching
			resolved = resolved.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
			// Remove /index suffix
			resolved = resolved.replace(/\/index$/, '');
			return resolved;
		}
		return importPath;
	} catch {
		return null;
	}
}

export async function detectImportGraph(
	projectRoot: string,
	language: Language
): Promise<ImportGraphInfo> {
	const extensions = EXTENSIONS[language] || [];

	if (extensions.length === 0) {
		return {nodes: [], mostImported: [], orphans: []};
	}

	// Phase 1: Collect all source files and their imports
	const fileImports: Map<string, string[]> = new Map();
	await collectImports(
		projectRoot,
		extensions,
		language,
		fileImports,
		projectRoot
	);

	// Phase 2: Calculate importedBy counts
	const importedByCount: Map<string, number> = new Map();
	const allSourceFiles = new Set(fileImports.keys());

	for (const [sourceFile, imports] of fileImports) {
		for (const imp of imports) {
			// Try to match the import to a source file
			const matchedFile = findMatchingFile(imp, allSourceFiles);
			if (matchedFile) {
				importedByCount.set(
					matchedFile,
					(importedByCount.get(matchedFile) || 0) + 1
				);
			}
		}
	}

	// Phase 3: Build nodes (only significant ones)
	const nodes: ImportNode[] = [];
	for (const [file, imports] of fileImports) {
		const importedBy = importedByCount.get(file) || 0;
		// Only include significant nodes (many imports OR imported by many)
		if (imports.length > 2 || importedBy > 2) {
			nodes.push({
				file,
				imports: imports.slice(0, 10), // Limit imports shown
				importedBy,
			});
		}
	}

	// Sort by importedBy descending
	nodes.sort((a, b) => b.importedBy - a.importedBy);

	// Top 5 most imported files
	const mostImported = nodes
		.filter((n) => n.importedBy > 0)
		.slice(0, 5)
		.map((n) => n.file);

	// Orphan files (nobody imports them, and they're not entry points)
	const orphans: string[] = [];
	for (const file of allSourceFiles) {
		const importedBy = importedByCount.get(file) || 0;
		if (importedBy === 0 && !isLikelyEntryPoint(file)) {
			orphans.push(file);
		}
	}

	return {
		nodes: nodes.slice(0, 15), // Top 15 nodes
		mostImported,
		orphans: orphans.slice(0, 10), // Top 10 orphans
	};
}

function isLikelyEntryPoint(file: string): boolean {
	const basename = path.basename(file);
	return /^(index|main|app|server|mod|lib|__init__|__main__)\./i.test(basename);
}

function findMatchingFile(
	importRef: string,
	sourceFiles: Set<string>
): string | null {
	// Direct match
	if (sourceFiles.has(importRef)) return importRef;

	// Try with common extensions
	const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go'];
	for (const ext of extensions) {
		if (sourceFiles.has(importRef + ext)) return importRef + ext;
	}

	// Try with /index
	for (const ext of extensions) {
		if (sourceFiles.has(importRef + '/index' + ext))
			return importRef + '/index' + ext;
	}

	return null;
}

async function collectImports(
	dir: string,
	extensions: string[],
	language: Language,
	fileImports: Map<string, string[]>,
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
					await collectImports(
						fullPath,
						extensions,
						language,
						fileImports,
						projectRoot,
						depth + 1
					);
				}
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (extensions.includes(ext)) {
					const relativePath = path.relative(projectRoot, fullPath);
					const imports = await extractImports(
						fullPath,
						language,
						relativePath,
						projectRoot
					);
					fileImports.set(relativePath, imports);
				}
			}
		}
	} catch {
		// Ignore errors
	}
}

async function extractImports(
	filePath: string,
	language: Language,
	sourceFile: string,
	projectRoot: string
): Promise<string[]> {
	const imports: string[] = [];

	try {
		const content = await fs.readFile(filePath, 'utf-8');
		const patterns = IMPORT_PATH_PATTERNS[language] || [];

		for (const pattern of patterns) {
			pattern.lastIndex = 0;
			let match;
			while ((match = pattern.exec(content)) !== null) {
				const importPath = match[1];
				if (importPath && isInternalImport(importPath, language)) {
					const resolved = resolveImportPath(
						importPath,
						sourceFile,
						projectRoot,
						language
					);
					if (resolved && !imports.includes(resolved)) {
						imports.push(resolved);
					}
				}
			}
		}
	} catch {
		// Ignore errors
	}

	return imports;
}

/**
 * Format import graph as a mermaid diagram for visual rendering
 */
export function formatImportGraphMermaid(graph: ImportGraphInfo): string {
	const lines: string[] = ['graph LR'];

	// Sanitize node IDs for mermaid (replace special chars)
	const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_');
	const shorten = (s: string) => {
		const parts = s.split('/');
		return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : s;
	};

	// Add most imported files as highlighted nodes
	for (const file of graph.mostImported) {
		const id = sanitize(file);
		lines.push(`  ${id}["⭐ ${shorten(file)}"]`);
		lines.push(`  style ${id} fill:#f9f,stroke:#333,stroke-width:2px`);
	}

	// Add edges from significant nodes
	for (const node of graph.nodes.slice(0, 10)) {
		const sourceId = sanitize(node.file);
		if (!graph.mostImported.includes(node.file)) {
			lines.push(`  ${sourceId}["${shorten(node.file)}"]`);
		}
		for (const imp of node.imports.slice(0, 5)) {
			const targetId = sanitize(imp);
			lines.push(`  ${sourceId} --> ${targetId}`);
		}
	}

	// Add orphans
	if (graph.orphans.length > 0) {
		lines.push(`  subgraph Orphans`);
		for (const orphan of graph.orphans.slice(0, 5)) {
			const id = sanitize(orphan);
			lines.push(`    ${id}["🔴 ${shorten(orphan)}"]`);
			lines.push(`    style ${id} fill:#fdd,stroke:#c00`);
		}
		lines.push(`  end`);
	}

	return lines.join('\n');
}
