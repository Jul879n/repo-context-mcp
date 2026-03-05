import * as fs from 'fs/promises';
import * as path from 'path';
import {FileSymbol} from '../types/index.js';
import ignore from 'ignore';

// ─── FILE CACHE ───
// In-memory cache to avoid redundant disk reads within the same MCP session.
// TTL: 10s — sufficient for multi-step AI workflows (outline → symbol → lines).

interface CacheEntry {
	content: string;
	lines: string[];
	mtime: number;
	cachedAt: number;
}

interface OutlineCacheEntry {
	symbols: FileSymbol[];
	totalLines: number;
	formatted: string;
	cachedAt: number;
}

const CACHE_TTL_MS = 10_000;
const fileCache = new Map<string, CacheEntry>();
const outlineCache = new Map<string, OutlineCacheEntry>();

async function getCachedFile(
	fullPath: string
): Promise<{content: string; lines: string[]}> {
	const now = Date.now();
	const cached = fileCache.get(fullPath);

	if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
		// Verify mtime hasn't changed
		try {
			const stat = await fs.stat(fullPath);
			if (stat.mtimeMs === cached.mtime) {
				return {content: cached.content, lines: cached.lines};
			}
		} catch {
			// If stat fails, fall through to re-read
		}
	}

	const content = await fs.readFile(fullPath, 'utf-8');
	const lines = content.split('\n');
	let mtime = 0;
	try {
		const stat = await fs.stat(fullPath);
		mtime = stat.mtimeMs;
	} catch {
		// ignore
	}

	fileCache.set(fullPath, {content, lines, mtime, cachedAt: now});
	return {content, lines};
}

function getCachedOutline(fullPath: string): OutlineCacheEntry | null {
	const cached = outlineCache.get(fullPath);
	if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
		return cached;
	}
	return null;
}

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

		// 10. Plain const/let/var variable: export const NAME = value (non-function)
		//     Catches: const TIMEOUT = 5000, const CONFIG = {...}, const ROUTES = [...]
		//     Does NOT catch destructuring (const { a } = ...) — regex requires simple identifier
		if (!sym) {
			m = trimmed.match(
				/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$]\w*)\s*(?::\s*[^=]+)?\s*=/
			);
			if (m && !SKIP_NAMES.has(m[1])) {
				sym = {name: m[1], type: 'const'};
			}
		}

		// 11. export default (no named function — just skip, not useful)

		if (sym) {
			// const variables: track all bracket types ({,[,() to avoid leaking into next function
			const endLine =
				sym.type === 'const' ? findConstEnd(lines, i) : findBlockEnd(lines, i, '.ts');
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

	// Check outline cache first
	const cachedOutline = getCachedOutline(fullPath);
	if (cachedOutline) {
		return {
			symbols: cachedOutline.symbols,
			totalLines: cachedOutline.totalLines,
			formatted: cachedOutline.formatted,
		};
	}

	const {lines} = await getCachedFile(fullPath);
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

	// Cache the result
	outlineCache.set(fullPath, {
		symbols,
		totalLines,
		formatted,
		cachedAt: Date.now(),
	});

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
	const {lines} = await getCachedFile(fullPath);
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
	const range = end - start + 1;

	// Compact header for small ranges (saves tokens)
	if (range <= 30) {
		return `L${start}-${end}/${total}\n${numbered}`;
	}
	return `[${path.relative(projectRoot, fullPath)}] L${start}-${end} of ${total}\n${numbered}`;
}

// ─── READ FILE SYMBOL ───

/**
 * Read a specific symbol (function, class, interface) from a file by name.
 * Uses fuzzy matching: exact → case-insensitive → substring → Levenshtein-like.
 */
export async function readFileSymbol(
	projectRoot: string,
	filePath: string,
	symbolName: string
): Promise<string> {
	const {symbols, totalLines} = await getFileOutline(projectRoot, filePath);

	// 1. Exact match
	let symbol = symbols.find((s) => s.name === symbolName);

	// 2. Case-insensitive
	if (!symbol) {
		const lower = symbolName.toLowerCase();
		symbol = symbols.find((s) => s.name.toLowerCase() === lower);
	}

	// 3. Substring match (symbolName is contained in or contains the symbol name)
	if (!symbol) {
		const lower = symbolName.toLowerCase();
		symbol = symbols.find(
			(s) =>
				s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase())
		);
	}

	// 4. Similarity-based: find top 3 most similar names
	if (!symbol) {
		const scored = symbols
			.map((s) => ({sym: s, score: similarity(symbolName, s.name)}))
			.sort((a, b) => b.score - a.score)
			.slice(0, 3);
		const suggestions = scored
			.map((s) => `${s.sym.type}:${s.sym.name} L${s.sym.startLine}`)
			.join(', ');
		return `Symbol "${symbolName}" not found. Similar: ${suggestions}`;
	}

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
 * Configurable max matches (default: 50).
 */
export async function searchInFile(
	projectRoot: string,
	filePath: string,
	pattern: string,
	contextLines: number = 2,
	maxMatches: number = 50
): Promise<string> {
	const fullPath = resolveFilePath(projectRoot, filePath);
	const {lines} = await getCachedFile(fullPath);
	const total = lines.length;
	const results: string[] = [];

	let regex: RegExp;
	try {
		regex = new RegExp(pattern, 'gi');
	} catch {
		regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
	}

	const ctx = Math.max(0, Math.min(contextLines, 10));
	const max = Math.max(1, Math.min(maxMatches, 100));
	let matchCount = 0;

	for (let i = 0; i < lines.length && matchCount < max; i++) {
		if (regex.test(lines[i])) {
			regex.lastIndex = 0;
			matchCount++;

			if (ctx === 0) {
				// Ultra-compact: just the matching line
				results.push(`L${i + 1}:${lines[i]}`);
			} else {
				const start = Math.max(0, i - ctx);
				const end = Math.min(lines.length - 1, i + ctx);
				results.push(`L${i + 1}:`);
				for (let j = start; j <= end; j++) {
					const marker = j === i ? '>' : ' ';
					results.push(`${marker}${j + 1}: ${lines[j]}`);
				}
			}
		}
	}

	if (matchCount === 0) {
		return `No matches for "${pattern}" in ${path.relative(
			projectRoot,
			fullPath
		)}`;
	}

	const truncated = matchCount >= max ? ` (truncated at ${max})` : '';
	return `[${path.relative(
		projectRoot,
		fullPath
	)}] ${matchCount} matches${truncated}\n${results.join('\n')}`;
}

// ─── SEARCH IN PROJECT ───

/**
 * Search for a pattern across all project files.
 * Replaces need for native grep/ripgrep.
 */
export async function searchInProject(
	projectRoot: string,
	pattern: string,
	filePattern?: string,
	maxResults: number = 30,
	contextLines: number = 0,
	maxDetailFiles: number = 0,
	excludePattern?: string
): Promise<string> {
	// max_results = max matches shown in detail per file (all files always listed)
	const maxDetailPerFile = Math.max(1, Math.min(maxResults, 100));
	// max_detail_files: 0 = summary only, N = top N files, -1 = all files (token-budgeted)
	const showAllFiles = maxDetailFiles === -1;
	const maxFilesWithDetail = showAllFiles ? Infinity : Math.max(0, maxDetailFiles);

	let regex: RegExp;
	try {
		regex = new RegExp(pattern, 'gi');
	} catch {
		regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
	}

	// Load gitignore
	const ig = ignore();
	try {
		const gitignoreContent = await fs.readFile(
			path.join(projectRoot, '.gitignore'),
			'utf-8'
		);
		ig.add(gitignoreContent);
	} catch {
		// No .gitignore
	}
	ig.add([
		'node_modules',
		'.git',
		'dist',
		'build',
		'.next',
		'coverage',
		'__pycache__',
		'.repo-context',
	]);

	const fileGlob = filePattern ? globToRegex(filePattern) : null;
	const excludeGlobs = excludePattern
		? excludePattern.split(',').map((p) => globToRegex(p.trim()))
		: [];
	const ctx = Math.max(0, Math.min(contextLines, 5));

	// Phase 1: Collect candidate files
	const candidateFiles: {fullPath: string; relativePath: string}[] = [];

	async function collectFiles(dir: string, depth = 0): Promise<void> {
		if (depth > 10) return;
		try {
			const entries = await fs.readdir(dir, {withFileTypes: true});
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				const relativePath = path.relative(projectRoot, fullPath);

				if (ig.ignores(relativePath)) continue;

				if (entry.isDirectory()) {
					await collectFiles(fullPath, depth + 1);
				} else if (entry.isFile()) {
					if (fileGlob && !fileGlob.test(entry.name) && !fileGlob.test(relativePath))
						continue;
					if (
						excludeGlobs.length > 0 &&
						excludeGlobs.some((eg) => eg.test(entry.name) || eg.test(relativePath))
					)
						continue;
					if (isBinaryExtension(entry.name)) continue;
					candidateFiles.push({fullPath, relativePath});
				}
			}
		} catch {
			// skip unreadable dirs
		}
	}

	await collectFiles(projectRoot);

	// Phase 2: Scan ALL files — no early exit, complete coverage
	interface FileResult {
		relativePath: string;
		fullPath: string;
		matchLineIndices: number[];
	}

	const fileResults: FileResult[] = [];

	const BATCH_SIZE = 20;
	for (let i = 0; i < candidateFiles.length; i += BATCH_SIZE) {
		const batch = candidateFiles.slice(i, i + BATCH_SIZE);
		const batchResults = await Promise.all(
			batch.map(async ({fullPath, relativePath}) => {
				try {
					const {lines} = await getCachedFile(fullPath);
					const localRegex = new RegExp(regex.source, regex.flags);
					const matchLineIndices: number[] = [];
					for (let j = 0; j < lines.length; j++) {
						if (localRegex.test(lines[j])) {
							localRegex.lastIndex = 0;
							matchLineIndices.push(j);
						}
					}
					if (matchLineIndices.length > 0) {
						return {relativePath, fullPath, matchLineIndices} satisfies FileResult;
					}
				} catch {
					// skip unreadable files
				}
				return null;
			})
		);
		for (const r of batchResults) {
			if (r) fileResults.push(r);
		}
	}

	if (fileResults.length === 0) {
		return `No matches for "${pattern}" in project (${candidateFiles.length} files searched)`;
	}

	// Sort: code files before docs/markdown, then by match count descending within each tier
	const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '.asciidoc']);
	const isDocFile = (p: string) => DOC_EXTENSIONS.has(path.extname(p).toLowerCase());
	fileResults.sort((a, b) => {
		const aIsDoc = isDocFile(a.relativePath) ? 1 : 0;
		const bIsDoc = isDocFile(b.relativePath) ? 1 : 0;
		if (aIsDoc !== bIsDoc) return aIsDoc - bIsDoc;
		return b.matchLineIndices.length - a.matchLineIndices.length;
	});

	const totalFiles = fileResults.length;
	const totalMatches = fileResults.reduce((sum, f) => sum + f.matchLineIndices.length, 0);

	// Phase 3: Build output
	// Always 1 line: counts + top files inline (hottest first)
	const INLINE_LIMIT = 10;
	const top10 = fileResults.slice(0, INLINE_LIMIT);
	// Show relative path when multiple files share the same basename (e.g. index.ts)
	const basenameCount = new Map<string, number>();
	for (const f of top10) {
		const b = path.basename(f.relativePath);
		basenameCount.set(b, (basenameCount.get(b) ?? 0) + 1);
	}
	const inlineStr = top10
		.map(f => {
			const basename = path.basename(f.relativePath);
			const label = (basenameCount.get(basename) ?? 0) > 1 ? f.relativePath : basename;
			return `${label}(${f.matchLineIndices.length})`;
		})
		.join(', ');
	const moreStr = totalFiles > INLINE_LIMIT ? ` +${totalFiles - INLINE_LIMIT}` : '';
	const summaryLine = `${totalMatches} matches in ${totalFiles} files: ${inlineStr}${moreStr}`;

	// Compact mode (default): return just the 1-line summary
	if (maxFilesWithDetail === 0) {
		return summaryLine;
	}

	// Detail mode: summary + code detail for top N files (or all if showAllFiles)
	const TOKEN_BUDGET_CHARS = 16000; // ~4000 tokens hard cap for -1 mode
	const output: string[] = [summaryLine, ''];
	let charCount = summaryLine.length;
	let filesShown = 0;

	const filesToDetail = showAllFiles ? fileResults : fileResults.slice(0, maxFilesWithDetail);
	for (const {relativePath, fullPath, matchLineIndices} of filesToDetail) {
		if (showAllFiles && charCount >= TOKEN_BUDGET_CHARS) {
			output.push(`(+${totalFiles - filesShown} more files — token budget reached)`);
			break;
		}

		const {lines: fileLines} = await getCachedFile(fullPath);
		const showCount = Math.min(matchLineIndices.length, maxDetailPerFile);
		const matchSet = new Set(matchLineIndices.slice(0, showCount));
		const fileLines_out: string[] = [`${relativePath}:`];

		if (ctx === 0) {
			for (let m = 0; m < showCount; m++) {
				const lineIdx = matchLineIndices[m];
				fileLines_out.push(`  ${lineIdx + 1}: ${fileLines[lineIdx].trim()}`);
			}
		} else {
			// Merge overlapping context ranges to avoid printing duplicate lines
			const ranges: Array<{start: number; end: number}> = [];
			for (let m = 0; m < showCount; m++) {
				const idx = matchLineIndices[m];
				const s = Math.max(0, idx - ctx);
				const e = Math.min(fileLines.length - 1, idx + ctx);
				if (ranges.length > 0 && s <= ranges[ranges.length - 1].end + 1) {
					ranges[ranges.length - 1].end = Math.max(ranges[ranges.length - 1].end, e);
				} else {
					ranges.push({start: s, end: e});
				}
			}
			for (let r = 0; r < ranges.length; r++) {
				if (r > 0) fileLines_out.push('  ---');
				const {start, end} = ranges[r];
				for (let k = start; k <= end; k++) {
					const marker = matchSet.has(k) ? '>' : ' ';
					fileLines_out.push(`  ${marker}${k + 1}: ${fileLines[k].trimEnd()}`);
				}
			}
		}
		if (matchLineIndices.length > showCount) {
			fileLines_out.push(`  ... (${matchLineIndices.length - showCount} more)`);
		}

		const block = fileLines_out.join('\n');
		output.push(block);
		charCount += block.length;
		filesShown++;
	}
	if (!showAllFiles && totalFiles > maxFilesWithDetail) {
		output.push(`(+${totalFiles - maxFilesWithDetail} more files)`);
	}

	return output.join('\n');
}

// ─── LIST FILES ───

/**
 * List files and directories in the project.
 * Replaces need for native list_dir / find_by_name.
 */
export async function listFiles(
	projectRoot: string,
	dirPath: string = '.',
	pattern?: string,
	maxDepth: number = 3
): Promise<string> {
	const fullPath = resolveFilePath(projectRoot, dirPath);
	const results: string[] = [];

	// Load gitignore
	const ig = ignore();
	try {
		const gitignoreContent = await fs.readFile(
			path.join(projectRoot, '.gitignore'),
			'utf-8'
		);
		ig.add(gitignoreContent);
	} catch {
		// No .gitignore
	}
	ig.add([
		'node_modules',
		'.git',
		'dist',
		'build',
		'.next',
		'coverage',
		'__pycache__',
		'.repo-context',
	]);

	const fileGlob = pattern ? globToRegex(pattern) : null;

	async function scan(
		dir: string,
		depth: number,
		prefix: string
	): Promise<void> {
		if (depth > maxDepth) return;
		try {
			const entries = await fs.readdir(dir, {withFileTypes: true});
			const sorted = entries.sort((a, b) => {
				// Dirs first, then files
				if (a.isDirectory() && !b.isDirectory()) return -1;
				if (!a.isDirectory() && b.isDirectory()) return 1;
				return a.name.localeCompare(b.name);
			});

			for (const entry of sorted) {
				const entryPath = path.join(dir, entry.name);
				const relativePath = path.relative(projectRoot, entryPath);

				if (ig.ignores(relativePath + (entry.isDirectory() ? '/' : ''))) continue;

				if (entry.isDirectory()) {
					// Count children
					let childCount = 0;
					try {
						const children = await fs.readdir(entryPath);
						childCount = children.length;
					} catch {
						/* skip */
					}
					results.push(`${prefix}📁 ${entry.name}/ (${childCount})`);
					await scan(entryPath, depth + 1, prefix + '  ');
				} else if (entry.isFile()) {
					if (fileGlob && !fileGlob.test(entry.name)) continue;
					try {
						const stat = await fs.stat(entryPath);
						const size = formatSize(stat.size);
						results.push(`${prefix}📄 ${entry.name} ${size}`);
					} catch {
						results.push(`${prefix}📄 ${entry.name}`);
					}
				}
			}
		} catch {
			// skip unreadable dirs
		}
	}

	const relativeDirPath = path.relative(projectRoot, fullPath) || '.';
	results.push(`📁 ${relativeDirPath}/`);
	await scan(fullPath, 0, '  ');

	return results.join('\n');
}

// ─── READ FILE (SMART) ───

/**
 * Smart file reader:
 * - With line range → reads that range (like readFileLines)
 * - File ≤200 lines → returns full content
 * - File >200 lines → returns outline with hint to use read_file_symbol
 */
export async function readFile(
	projectRoot: string,
	filePath: string,
	startLine?: number,
	endLine?: number
): Promise<string> {
	const fullPath = resolveFilePath(projectRoot, filePath);
	const {lines} = await getCachedFile(fullPath);
	const total = lines.length;
	const relPath = path.relative(projectRoot, fullPath);

	// If line range specified, use it
	if (startLine !== undefined && endLine !== undefined) {
		return readFileLines(projectRoot, filePath, startLine, endLine);
	}

	// Small file: return complete content
	if (total <= 200) {
		const numbered = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
		return `[${relPath}] ${total} lines (full)\n${numbered}`;
	}

	// Large file: return outline + hint
	const outline = await getFileOutline(projectRoot, filePath);
	return `[${relPath}] ${total} lines (large — showing outline)\n${outline.formatted}\n\nUse read_file_symbol(file, symbolName) to read specific symbols, or read_file(file, startLine, endLine) for a range.`;
}

// ─── HELPERS ───

/**
 * Simple string similarity (0 to 1) based on longest common subsequence ratio.
 */
function similarity(a: string, b: string): number {
	const al = a.toLowerCase();
	const bl = b.toLowerCase();
	if (al === bl) return 1;
	const maxLen = Math.max(al.length, bl.length);
	if (maxLen === 0) return 1;

	// LCS length
	const m = al.length;
	const n = bl.length;
	const dp: number[][] = Array.from({length: m + 1}, () =>
		new Array(n + 1).fill(0)
	);
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				al[i - 1] === bl[j - 1]
					? dp[i - 1][j - 1] + 1
					: Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}
	return dp[m][n] / maxLen;
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports * (any chars), ? (single char), and ** (recursive).
 */
function globToRegex(glob: string): RegExp {
	// Support comma-separated multi-glob: "*.ts,*.tsx" or brace expansion "*.{ts,tsx}"
	const expandBraces = (g: string): string[] => {
		const braceMatch = g.match(/^(.*?)\{([^}]+)\}(.*)$/);
		if (!braceMatch) return [g];
		const [, prefix, options, suffix] = braceMatch;
		return options.split(',').map((opt) => `${prefix}${opt.trim()}${suffix}`);
	};

	// Split by comma but not inside braces
	const splitGlobs = (input: string): string[] => {
		const parts: string[] = [];
		let depth = 0;
		let current = '';
		for (const ch of input) {
			if (ch === '{') depth++;
			else if (ch === '}') depth--;
			if (ch === ',' && depth === 0) {
				parts.push(current.trim());
				current = '';
			} else {
				current += ch;
			}
		}
		if (current.trim()) parts.push(current.trim());
		return parts;
	};

	const patterns = splitGlobs(glob)
		.flatMap((g) => expandBraces(g))
		.map((g) => {
			const escaped = g
				.replace(/[.+^${}()|[\]\\]/g, '\\$&')
				.replace(/\*\*/g, '§DOUBLE§')
				.replace(/\*/g, '[^/]*')
				.replace(/\?/g, '.')
				.replace(/§DOUBLE§/g, '.*');
			return `(?:^${escaped}$|${escaped}$)`;
		});
	return new RegExp(patterns.join('|'), 'i');
}

/**
 * Check if a file has a binary extension (skip during search).
 */
function isBinaryExtension(filename: string): boolean {
	const binaryExts = new Set([
		'.png',
		'.jpg',
		'.jpeg',
		'.gif',
		'.bmp',
		'.ico',
		'.svg',
		'.webp',
		'.mp3',
		'.mp4',
		'.avi',
		'.mov',
		'.mkv',
		'.flac',
		'.wav',
		'.zip',
		'.tar',
		'.gz',
		'.bz2',
		'.7z',
		'.rar',
		'.pdf',
		'.doc',
		'.docx',
		'.xls',
		'.xlsx',
		'.ppt',
		'.pptx',
		'.woff',
		'.woff2',
		'.ttf',
		'.eot',
		'.otf',
		'.exe',
		'.dll',
		'.so',
		'.dylib',
		'.bin',
		'.lock',
		'.map',
	]);
	const ext = path.extname(filename).toLowerCase();
	return binaryExts.has(ext);
}

/**
 * Format file size in human-readable form.
 */
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

/**
 * Find the end of a const/let/var statement by tracking ALL bracket types
 * ({}, [], ()) and stopping when depth reaches 0 and a semicolon is found.
 * Prevents const symbols from "leaking" into subsequent function bodies.
 */
function findConstEnd(lines: string[], startIndex: number): number {
	let depth = 0;
	for (let i = startIndex; i < Math.min(startIndex + 100, lines.length); i++) {
		for (const ch of lines[i]) {
			if (ch === '{' || ch === '[' || ch === '(') depth++;
			else if (ch === '}' || ch === ']' || ch === ')') depth--;
		}
		if (lines[i].includes(';') && depth <= 0) {
			return i + 1;
		}
	}
	return startIndex + 1;
}

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

// ─── SEARCH SYMBOL IN PROJECT ───

/**
 * Search for a symbol across all project files.
 * Returns matching symbols with file, type, signature, and export status.
 */
export async function searchSymbolInProject(
	projectRoot: string,
	symbolName: string,
	symbolType?: string,
	exportedOnly?: boolean
): Promise<string> {
	const allOutlines = await getAllOutlines(projectRoot);

	interface SymbolMatch {
		file: string;
		symbol: FileSymbol;
		score: number;
	}

	const matches: SymbolMatch[] = [];
	const lowerName = symbolName.toLowerCase();

	for (const [file, {symbols}] of allOutlines) {
		for (const sym of symbols) {
			if (symbolType && sym.type !== symbolType) continue;
			if (exportedOnly && !sym.exported) continue;

			const symLower = sym.name.toLowerCase();

			// Exact match
			if (sym.name === symbolName) {
				matches.push({file, symbol: sym, score: 1.0});
			}
			// Case-insensitive exact
			else if (symLower === lowerName) {
				matches.push({file, symbol: sym, score: 0.95});
			}
			// Substring match (query contained in symbol name, min 4 chars to avoid noise)
			else if (lowerName.length >= 4 && symLower.includes(lowerName)) {
				matches.push({file, symbol: sym, score: 0.7});
			}
			// Fuzzy similarity (only for names of similar length)
			else if (Math.min(symLower.length, lowerName.length) >= 4) {
				const score = similarity(symbolName, sym.name);
				if (score >= 0.7) {
					matches.push({file, symbol: sym, score});
				}
			}
		}
	}

	if (matches.length === 0) {
		return `No symbols matching "${symbolName}" found in project.`;
	}

	// Sort by score desc, then by file
	matches.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

	// Cap at 30 results
	const shown = matches.slice(0, 30);
	const lines: string[] = [];
	lines.push(`${matches.length} symbol${matches.length > 1 ? 's' : ''} matching "${symbolName}":`);
	lines.push('');

	for (const m of shown) {
		const exp = m.symbol.exported ? 'export ' : '';
		lines.push(
			`${m.file}:${m.symbol.startLine} ${exp}[${m.symbol.type}] ${m.symbol.name} (L${m.symbol.startLine}-${m.symbol.endLine})`
		);
	}

	if (matches.length > 30) {
		lines.push(`... +${matches.length - 30} more`);
	}

	return lines.join('\n');
}
