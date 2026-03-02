import * as fs from 'fs/promises';
import * as path from 'path';
import {FileSymbol} from '../types/index.js';

// ─── SYMBOL PATTERNS ───
// Regex patterns per language to extract symbols (functions, classes, interfaces, etc.)

interface SymbolPattern {
	pattern: RegExp;
	type: FileSymbol['type'];
}

const TS_JS_PATTERNS: SymbolPattern[] = [
	// export interface Name { / interface Name {
	{pattern: /^(export\s+)?interface\s+(\w+)/gm, type: 'interface'},
	// export type Name = / type Name =
	{pattern: /^(export\s+)?type\s+(\w+)\s*[=<]/gm, type: 'type'},
	// export enum Name { / enum Name {
	{pattern: /^(export\s+)?enum\s+(\w+)/gm, type: 'enum'},
	// export class Name / class Name
	{pattern: /^(export\s+)?(abstract\s+)?class\s+(\w+)/gm, type: 'class'},
	// export function name( / function name( / export async function name(
	{
		pattern: /^(export\s+)?(async\s+)?function\s+(\w+)\s*[\(<]/gm,
		type: 'function',
	},
	// export const name = / const name =
	{
		pattern: /^(export\s+)?const\s+(\w+)\s*[=:]/gm,
		type: 'const',
	},
	// Method inside class: name(, async name(, public name(, private name(
	{
		pattern:
			/^\s+(public|private|protected|static|async|readonly|\s)*(\w+)\s*\([^)]*\)\s*[:{]/gm,
		type: 'method',
	},
];

const PYTHON_PATTERNS: SymbolPattern[] = [
	{pattern: /^class\s+(\w+)/gm, type: 'class'},
	{pattern: /^def\s+(\w+)/gm, type: 'function'},
	{pattern: /^\s+def\s+(\w+)/gm, type: 'method'},
];

const GO_PATTERNS: SymbolPattern[] = [
	{pattern: /^type\s+(\w+)\s+struct/gm, type: 'class'},
	{pattern: /^type\s+(\w+)\s+interface/gm, type: 'interface'},
	{pattern: /^func\s+(\w+)/gm, type: 'function'},
	{pattern: /^func\s+\([^)]+\)\s+(\w+)/gm, type: 'method'},
];

const RUST_PATTERNS: SymbolPattern[] = [
	{pattern: /^(pub\s+)?struct\s+(\w+)/gm, type: 'class'},
	{pattern: /^(pub\s+)?enum\s+(\w+)/gm, type: 'enum'},
	{pattern: /^(pub\s+)?trait\s+(\w+)/gm, type: 'interface'},
	{pattern: /^(pub\s+)?(async\s+)?fn\s+(\w+)/gm, type: 'function'},
	{pattern: /^\s+(pub\s+)?(async\s+)?fn\s+(\w+)/gm, type: 'method'},
];

function getPatternsForFile(filePath: string): SymbolPattern[] {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case '.ts':
		case '.tsx':
		case '.js':
		case '.jsx':
		case '.mjs':
		case '.cjs':
			return TS_JS_PATTERNS;
		case '.py':
			return PYTHON_PATTERNS;
		case '.go':
			return GO_PATTERNS;
		case '.rs':
			return RUST_PATTERNS;
		default:
			return TS_JS_PATTERNS; // fallback
	}
}

// ─── RESOLVE FILE PATH ───

function resolveFilePath(projectRoot: string, filePath: string): string {
	// If already absolute and within project, use as-is
	if (path.isAbsolute(filePath)) {
		if (filePath.startsWith(projectRoot)) return filePath;
		throw new Error(`File path outside project root: ${filePath}`);
	}
	return path.join(projectRoot, filePath);
}

// ─── GET FILE OUTLINE ───

/**
 * Extract all symbols from a file with their line ranges.
 * Returns a compact representation: name(params):type L45-L89
 */
export async function getFileOutline(
	projectRoot: string,
	filePath: string
): Promise<{symbols: FileSymbol[]; totalLines: number; formatted: string}> {
	const fullPath = resolveFilePath(projectRoot, filePath);
	const content = await fs.readFile(fullPath, 'utf-8');
	const lines = content.split('\n');
	const totalLines = lines.length;
	const patterns = getPatternsForFile(filePath);
	const symbols: FileSymbol[] = [];

	// Find all symbol starts
	for (const {pattern, type} of patterns) {
		pattern.lastIndex = 0;
		let match;
		while ((match = pattern.exec(content)) !== null) {
			const lineIndex = content.substring(0, match.index).split('\n').length - 1;
			const startLine = lineIndex + 1;
			const line = lines[lineIndex];

			// Extract name: last capture group is the name
			const groups = match.filter((g, i) => i > 0 && g && /^\w+$/.test(g));
			const name = groups[groups.length - 1] || match[0].trim();

			// Skip common false positives
			if (
				[
					'if',
					'for',
					'while',
					'switch',
					'catch',
					'return',
					'new',
					'throw',
					'import',
					'from',
					'require',
				].includes(name)
			) {
				continue;
			}

			// Determine if exported
			const exported = line.trimStart().startsWith('export');

			// Find end line by counting braces/indentation
			const endLine = findBlockEnd(lines, lineIndex, filePath);

			// Build signature from the first line(s)
			let signature = line.trim();
			// Trim to a reasonable length
			if (signature.length > 120) {
				signature = signature.substring(0, 117) + '...';
			}

			symbols.push({
				name,
				type,
				startLine,
				endLine,
				signature,
				exported,
			});
		}
	}

	// Deduplicate: keep the one with the larger range if same name+startLine
	const seen = new Map<string, FileSymbol>();
	for (const sym of symbols) {
		const key = `${sym.name}:${sym.startLine}`;
		const existing = seen.get(key);
		if (
			!existing ||
			sym.endLine - sym.startLine > existing.endLine - existing.startLine
		) {
			seen.set(key, sym);
		}
	}

	const uniqueSymbols = [...seen.values()].sort(
		(a, b) => a.startLine - b.startLine
	);

	// Format compactly
	const formatted = uniqueSymbols
		.map((s) => {
			const exp = s.exported ? '⬆' : ' ';
			return `${exp}${s.type}:${s.name} L${s.startLine}-${s.endLine}`;
		})
		.join('\n');

	return {symbols: uniqueSymbols, totalLines, formatted};
}

// ─── READ FILE LINES ───

/**
 * Read specific line range from a file.
 * Max 200 lines per call to control token usage.
 */
export async function readFileLines(
	projectRoot: string,
	filePath: string,
	startLine: number,
	endLine: number
): Promise<string> {
	const fullPath = resolveFilePath(projectRoot, filePath);
	const content = await fs.readFile(fullPath, 'utf-8');
	const lines = content.split('\n');
	const total = lines.length;

	// Clamp values
	const start = Math.max(1, startLine);
	let end = Math.min(total, endLine);

	// Max 200 lines
	if (end - start + 1 > 200) {
		end = start + 199;
	}

	const selected = lines.slice(start - 1, end);
	const numbered = selected.map((line, i) => `${start + i}: ${line}`).join('\n');

	return `[${path.relative(
		projectRoot,
		fullPath
	)}] Lines ${start}-${end} of ${total}\n${numbered}`;
}

// ─── READ FILE SYMBOL ───

/**
 * Read a specific symbol (function, class, interface) from a file by name.
 * Returns the complete code block.
 */
export async function readFileSymbol(
	projectRoot: string,
	filePath: string,
	symbolName: string
): Promise<string> {
	const {symbols, totalLines} = await getFileOutline(projectRoot, filePath);

	// Find the symbol
	const symbol = symbols.find(
		(s) =>
			s.name === symbolName || s.name.toLowerCase() === symbolName.toLowerCase()
	);

	if (!symbol) {
		const available = symbols
			.map((s) => `${s.type}:${s.name} L${s.startLine}`)
			.join(', ');
		return `Symbol "${symbolName}" not found.\nAvailable: ${available}`;
	}

	// Read the lines
	const result = await readFileLines(
		projectRoot,
		filePath,
		symbol.startLine,
		symbol.endLine
	);

	return `[${symbol.type}] ${symbol.signature}\n${result}`;
}

// ─── SEARCH IN FILE ───

/**
 * Search for a pattern in a file, return matches with ±N lines of context.
 * Max 10 matches.
 */
export async function searchInFile(
	projectRoot: string,
	filePath: string,
	pattern: string,
	contextLines: number = 3
): Promise<string> {
	const fullPath = resolveFilePath(projectRoot, filePath);
	const content = await fs.readFile(fullPath, 'utf-8');
	const lines = content.split('\n');
	const total = lines.length;
	const results: string[] = [];

	// Try as regex first, fallback to literal
	let regex: RegExp;
	try {
		regex = new RegExp(pattern, 'gi');
	} catch {
		regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
	}

	const ctx = Math.max(0, Math.min(contextLines, 10));
	let matchCount = 0;

	for (let i = 0; i < lines.length && matchCount < 10; i++) {
		if (regex.test(lines[i])) {
			regex.lastIndex = 0; // reset for global flag
			matchCount++;
			const start = Math.max(0, i - ctx);
			const end = Math.min(lines.length - 1, i + ctx);

			results.push(`--- Match ${matchCount} at L${i + 1} ---`);
			for (let j = start; j <= end; j++) {
				const marker = j === i ? '>' : ' ';
				results.push(`${marker}${j + 1}: ${lines[j]}`);
			}
			results.push('');
		}
	}

	if (results.length === 0) {
		return `No matches for "${pattern}" in ${path.relative(
			projectRoot,
			fullPath
		)}`;
	}

	return `[${path.relative(
		projectRoot,
		fullPath
	)}] ${matchCount} matches (${total} lines total)\n${results.join('\n')}`;
}

// ─── HELPERS ───

/**
 * Find the end of a code block starting at a given line.
 * Uses brace counting for C-like languages, indentation for Python.
 */
function findBlockEnd(
	lines: string[],
	startIndex: number,
	filePath: string
): number {
	const ext = path.extname(filePath).toLowerCase();
	const totalLines = lines.length;

	if (ext === '.py') {
		// Python: use indentation
		const startLine = lines[startIndex];
		const baseIndent = startLine.match(/^\s*/)?.[0].length || 0;

		for (let i = startIndex + 1; i < totalLines; i++) {
			const line = lines[i];
			if (line.trim() === '') continue; // skip blank lines
			const indent = line.match(/^\s*/)?.[0].length || 0;
			if (indent <= baseIndent && line.trim() !== '') {
				return i; // line before the un-indented line
			}
		}
		return totalLines;
	}

	// Brace-based languages (TS, JS, Go, Rust, Java, etc.)
	let braceCount = 0;
	let foundOpen = false;

	for (let i = startIndex; i < totalLines; i++) {
		const line = lines[i];
		for (const ch of line) {
			if (ch === '{') {
				braceCount++;
				foundOpen = true;
			} else if (ch === '}') {
				braceCount--;
			}
		}
		if (foundOpen && braceCount <= 0) {
			return i + 1; // include closing brace line
		}
	}

	// If no braces found (e.g., single-line type alias), return start + 1
	if (!foundOpen) {
		// Look for semicolon or end of statement
		for (let i = startIndex; i < Math.min(startIndex + 5, totalLines); i++) {
			if (lines[i].includes(';') || lines[i].trim().endsWith(',')) {
				return i + 1;
			}
		}
		return startIndex + 1;
	}

	return totalLines;
}

// ─── BULK OUTLINE FOR AUTO-DOCS ───

/**
 * Generate outlines for all source files in a directory.
 * Used by docs-generator to create OUTLINES.md
 */
export async function getAllOutlines(
	projectRoot: string
): Promise<Map<string, {symbols: FileSymbol[]; totalLines: number}>> {
	const results = new Map<string, {symbols: FileSymbol[]; totalLines: number}>();
	const srcExtensions = new Set([
		'.ts',
		'.tsx',
		'.js',
		'.jsx',
		'.mjs',
		'.cjs',
		'.py',
		'.go',
		'.rs',
		'.java',
		'.kt',
		'.cs',
		'.php',
		'.rb',
		'.swift',
		'.dart',
	]);
	const skipDirs = new Set([
		'node_modules',
		'vendor',
		'venv',
		'.venv',
		'dist',
		'build',
		'out',
		'.git',
		'__pycache__',
		'.next',
		'.nuxt',
		'coverage',
		'.cache',
		'.repo-context',
	]);

	async function scan(dir: string, depth = 0): Promise<void> {
		if (depth > 8) return;
		try {
			const entries = await fs.readdir(dir, {withFileTypes: true});
			for (const entry of entries) {
				if (entry.name.startsWith('.') && depth > 0) continue;
				const fullPath = path.join(dir, entry.name);

				if (entry.isDirectory()) {
					if (!skipDirs.has(entry.name)) {
						await scan(fullPath, depth + 1);
					}
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name).toLowerCase();
					if (srcExtensions.has(ext)) {
						try {
							const relativePath = path.relative(projectRoot, fullPath);
							const outline = await getFileOutline(projectRoot, relativePath);
							if (outline.symbols.length > 0) {
								results.set(relativePath, {
									symbols: outline.symbols,
									totalLines: outline.totalLines,
								});
							}
						} catch {
							// skip files that can't be read
						}
					}
				}
			}
		} catch {
			// skip dirs that can't be read
		}
	}

	await scan(projectRoot);
	return results;
}
