import * as fs from 'fs/promises';
import * as path from 'path';
import {FileSymbol} from '../types/index.js';

// ─── LINE-BY-LINE SYMBOL EXTRACTOR ───
// Instead of multi-line regex, we scan each line for symbol definitions.
// This handles indented code, arrow functions, export default, etc.

const SKIP_NAMES = new Set([
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
	'else',
	'try',
	'finally',
	'do',
	'await',
	'typeof',
	'instanceof',
	'void',
	'delete',
	'in',
	'of',
	'case',
	'break',
	'continue',
	'with',
	'yield',
	'super',
	'this',
	'true',
	'false',
	'null',
	'undefined',
	'let',
	'var',
	'const',
	'function',
	'class',
	'extends',
]);

/**
 * Extract symbols from a TS/JS/TSX/JSX file, line by line.
 */
function extractTsJsSymbols(lines: string[]): FileSymbol[] {
	const symbols: FileSymbol[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (
			!trimmed ||
			trimmed.startsWith('//') ||
			trimmed.startsWith('*') ||
			trimmed.startsWith('/*')
		)
			continue;

		const isExported = trimmed.startsWith('export');
		let sym: {name: string; type: FileSymbol['type']} | null = null;

		// 1. export default function Name(
		let m = trimmed.match(/^export\s+default\s+function\s+(\w+)/);
		if (m) {
			sym = {name: m[1], type: 'function'};
		}

		// 2. export function / async function / function (any indent)
		if (!sym) {
			m = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
			if (m && !SKIP_NAMES.has(m[1])) {
				sym = {name: m[1], type: 'function'};
			}
		}

		// 3. export default class / export class / class
		if (!sym) {
			m = trimmed.match(
				/^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)/
			);
			if (m) {
				sym = {name: m[1], type: 'class'};
			}
		}

		// 4. interface
		if (!sym) {
			m = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
			if (m) {
				sym = {name: m[1], type: 'interface'};
			}
		}

		// 5. type alias
		if (!sym) {
			m = trimmed.match(/^(?:export\s+)?type\s+(\w+)\s*[=<]/);
			if (m && !SKIP_NAMES.has(m[1])) {
				sym = {name: m[1], type: 'type'};
			}
		}

		// 6. enum
		if (!sym) {
			m = trimmed.match(/^(?:export\s+)?enum\s+(\w+)/);
			if (m) {
				sym = {name: m[1], type: 'enum'};
			}
		}

		// 7. Arrow function: const/let/var name = (...) => { or = async (...) => {
		//    Also catches: const name = useCallback( / useMemo(
		if (!sym) {
			m = trimmed.match(
				/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*(?::\s*[^=]+)?\s*=>/
			);
			if (m && !SKIP_NAMES.has(m[1])) {
				sym = {name: m[1], type: 'function'};
			}
		}

		// 8. Arrow function assigned with useCallback/useMemo: const name = useCallback((...) => {
		if (!sym) {
			m = trimmed.match(
				/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:useCallback|useMemo|useRef|React\.memo)\s*\(/
			);
			if (m && !SKIP_NAMES.has(m[1])) {
				sym = {name: m[1], type: 'function'};
			}
		}

		// 9. General const/let with arrow or function expression (fallback):
		//    const name = (...) => or const name = function(
		if (!sym) {
			m = trimmed.match(
				/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:function|\()/
			);
			if (m && !SKIP_NAMES.has(m[1])) {
				sym = {name: m[1], type: 'function'};
			}
		}

		// 10. export default (no named function — just skip, not useful)

		if (sym) {
			const endLine = findBlockEnd(lines, i, '.ts');
			let signature = trimmed;
			if (signature.length > 120) signature = signature.substring(0, 117) + '...';

			symbols.push({
				name: sym.name,
				type: sym.type,
				startLine: i + 1,
				endLine,
				signature,
				exported: isExported,
			});
		}
	}

	return symbols;
}

/**
 * Extract symbols from Python files.
 */
function extractPythonSymbols(lines: string[]): FileSymbol[] {
	const symbols: FileSymbol[] = [];
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		const indent = lines[i].match(/^\s*/)?.[0].length || 0;
		let m: RegExpMatchArray | null;

		m = trimmed.match(/^class\s+(\w+)/);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'class',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.py'),
				signature: trimmed,
				exported: true,
			});
			continue;
		}
		m = trimmed.match(/^(?:async\s+)?def\s+(\w+)/);
		if (m) {
			const type: FileSymbol['type'] = indent > 0 ? 'method' : 'function';
			symbols.push({
				name: m[1],
				type,
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.py'),
				signature: trimmed,
				exported: indent === 0,
			});
		}
	}
	return symbols;
}

/**
 * Extract symbols from Go files.
 */
function extractGoSymbols(lines: string[]): FileSymbol[] {
	const symbols: FileSymbol[] = [];
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		let m: RegExpMatchArray | null;

		m = trimmed.match(/^type\s+(\w+)\s+struct/);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'class',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.go'),
				signature: trimmed,
				exported: m[1][0] === m[1][0].toUpperCase(),
			});
			continue;
		}

		m = trimmed.match(/^type\s+(\w+)\s+interface/);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'interface',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.go'),
				signature: trimmed,
				exported: m[1][0] === m[1][0].toUpperCase(),
			});
			continue;
		}

		m = trimmed.match(/^func\s+\([^)]+\)\s+(\w+)/);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'method',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.go'),
				signature: trimmed,
				exported: m[1][0] === m[1][0].toUpperCase(),
			});
			continue;
		}

		m = trimmed.match(/^func\s+(\w+)/);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'function',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.go'),
				signature: trimmed,
				exported: m[1][0] === m[1][0].toUpperCase(),
			});
		}
	}
	return symbols;
}

/**
 * Extract symbols from Rust files.
 */
function extractRustSymbols(lines: string[]): FileSymbol[] {
	const symbols: FileSymbol[] = [];
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		let m: RegExpMatchArray | null;
		const isPub = trimmed.startsWith('pub');

		m = trimmed.match(/^(?:pub\s+)?struct\s+(\w+)/);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'class',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.rs'),
				signature: trimmed,
				exported: isPub,
			});
			continue;
		}

		m = trimmed.match(/^(?:pub\s+)?enum\s+(\w+)/);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'enum',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.rs'),
				signature: trimmed,
				exported: isPub,
			});
			continue;
		}

		m = trimmed.match(/^(?:pub\s+)?trait\s+(\w+)/);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'interface',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.rs'),
				signature: trimmed,
				exported: isPub,
			});
			continue;
		}

		m = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
		if (m) {
			const indent = lines[i].match(/^\s*/)?.[0].length || 0;
			const type: FileSymbol['type'] = indent > 0 ? 'method' : 'function';
			symbols.push({
				name: m[1],
				type,
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, '.rs'),
				signature: trimmed,
				exported: isPub,
			});
		}
	}
	return symbols;
}

/**
 * Extract symbols from Java/Kotlin/C#/PHP/Ruby/Swift/Dart (generic patterns).
 */
function extractGenericSymbols(lines: string[], ext: string): FileSymbol[] {
	const symbols: FileSymbol[] = [];
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		let m: RegExpMatchArray | null;
		const isPublic = /^(?:public|export|open)\s/.test(trimmed);

		// Class
		m = trimmed.match(
			/^(?:(?:public|private|protected|internal|abstract|final|open|sealed|data|export)\s+)*class\s+(\w+)/
		);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'class',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, ext),
				signature: trimmed.substring(0, 120),
				exported: isPublic,
			});
			continue;
		}

		// Interface / protocol / trait
		m = trimmed.match(
			/^(?:(?:public|private|protected|internal|export)\s+)?(?:interface|protocol|trait)\s+(\w+)/
		);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'interface',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, ext),
				signature: trimmed.substring(0, 120),
				exported: isPublic,
			});
			continue;
		}

		// Enum
		m = trimmed.match(
			/^(?:(?:public|private|protected|internal|export)\s+)?enum\s+(\w+)/
		);
		if (m) {
			symbols.push({
				name: m[1],
				type: 'enum',
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, ext),
				signature: trimmed.substring(0, 120),
				exported: isPublic,
			});
			continue;
		}

		// Function/method (Java/Kotlin/C#/Swift/Dart)
		m = trimmed.match(
			/^(?:(?:public|private|protected|internal|static|final|override|abstract|async|suspend|open)\s+)*(?:fun|func|def|function|void|int|string|bool|double|float|var|val|let|Task|async)\s+(\w+)\s*[\(<]/
		);
		if (m && !SKIP_NAMES.has(m[1])) {
			const indent = lines[i].match(/^\s*/)?.[0].length || 0;
			const type: FileSymbol['type'] = indent > 4 ? 'method' : 'function';
			symbols.push({
				name: m[1],
				type,
				startLine: i + 1,
				endLine: findBlockEnd(lines, i, ext),
				signature: trimmed.substring(0, 120),
				exported: isPublic,
			});
		}

		// Ruby def
		if (ext === '.rb') {
			m = trimmed.match(/^(?:def)\s+(\w+)/);
			if (m) {
				const indent = lines[i].match(/^\s*/)?.[0].length || 0;
				symbols.push({
					name: m[1],
					type: indent > 0 ? 'method' : 'function',
					startLine: i + 1,
					endLine: findBlockEnd(lines, i, ext),
					signature: trimmed,
					exported: true,
				});
			}
		}
	}
	return symbols;
}

function extractSymbolsForFile(
	lines: string[],
	filePath: string
): FileSymbol[] {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case '.ts':
		case '.tsx':
		case '.js':
		case '.jsx':
		case '.mjs':
		case '.cjs':
			return extractTsJsSymbols(lines);
		case '.py':
			return extractPythonSymbols(lines);
		case '.go':
			return extractGoSymbols(lines);
		case '.rs':
			return extractRustSymbols(lines);
		case '.java':
		case '.kt':
		case '.cs':
		case '.php':
		case '.rb':
		case '.swift':
		case '.dart':
			return extractGenericSymbols(lines, ext);
		default:
			return extractTsJsSymbols(lines); // fallback
	}
}

// ─── RESOLVE FILE PATH ───

function resolveFilePath(projectRoot: string, filePath: string): string {
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

	const rawSymbols = extractSymbolsForFile(lines, filePath);

	// Deduplicate: keep the one with the larger range if same name+startLine
	const seen = new Map<string, FileSymbol>();
	for (const sym of rawSymbols) {
		const key = `${sym.name}:${sym.startLine}`;
		const existing = seen.get(key);
		if (
			!existing ||
			sym.endLine - sym.startLine > existing.endLine - existing.startLine
		) {
			seen.set(key, sym);
		}
	}

	const symbols = [...seen.values()].sort((a, b) => a.startLine - b.startLine);

	// Format compactly
	const formatted = symbols
		.map((s) => {
			const exp = s.exported ? '⬆' : ' ';
			return `${exp}${s.type}:${s.name} L${s.startLine}-${s.endLine}`;
		})
		.join('\n');

	return {symbols, totalLines, formatted};
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
