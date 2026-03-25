import * as fs from 'fs/promises';
import * as path from 'path';
import {getFileOutline, getAllOutlines} from './file-reader.js';

// ─── SHARED UTILS ───

const SRC_EXTENSIONS = new Set([
	'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
	'.py', '.go', '.rs', '.java', '.kt', '.cs',
	'.php', '.rb', '.swift', '.dart',
]);

const SKIP_DIRS = new Set([
	'node_modules', 'vendor', 'venv', '.venv', 'dist', 'build',
	'out', '.git', '__pycache__', '.next', '.nuxt', 'coverage',
	'.cache', '.reposynapse',
]);

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolvePath(projectRoot: string, filePath: string): string {
	if (path.isAbsolute(filePath)) {
		if (!filePath.startsWith(projectRoot)) {
			throw new Error(`File path outside project root: '${filePath}'`);
		}
		return filePath;
	}
	return path.join(projectRoot, filePath);
}

// ─── PATCH FILE ───

interface PatchHunk {
	oldStart: number;
	oldCount: number;
	lines: string[];
}

function parsePatch(patch: string): PatchHunk[] {
	const hunks: PatchHunk[] = [];
	const lines = patch.split('\n');
	let i = 0;
	while (i < lines.length) {
		const m = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
		if (m) {
			const hunk: PatchHunk = {
				oldStart: parseInt(m[1]),
				oldCount: parseInt(m[2] ?? '1'),
				lines: [],
			};
			i++;
			while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff ')) {
				hunk.lines.push(lines[i]);
				i++;
			}
			hunks.push(hunk);
		} else {
			i++;
		}
	}
	return hunks;
}

/**
 * Apply a unified diff patch to a file.
 * Lets the AI send only the changed lines instead of the full file.
 */
export async function patchFile(
	projectRoot: string,
	filePath: string,
	patch: string
): Promise<string> {
	const fullPath = resolvePath(projectRoot, filePath);
	const content = await fs.readFile(fullPath, 'utf-8').catch((e: NodeJS.ErrnoException) => {
		if (e.code === 'ENOENT') throw new Error(`File not found: '${fullPath}'. Use list_files to browse available files.`);
		throw e;
	});
	const lines = content.split('\n');

	const hunks = parsePatch(patch);
	if (hunks.length === 0) return 'No valid hunks found in patch. Expected format: @@ -L,N +L,N @@ ...';

	// Apply hunks in reverse order to preserve line numbers
	hunks.sort((a, b) => b.oldStart - a.oldStart);
	for (const hunk of hunks) {
		const start = hunk.oldStart - 1;
		const newLines = hunk.lines
			.filter((l) => l.startsWith('+') || l.startsWith(' '))
			.map((l) => l.slice(1));
		lines.splice(start, hunk.oldCount, ...newLines);
	}

	await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
	const rel = path.relative(projectRoot, fullPath);
	return `Patched ${rel}: ${hunks.length} hunk(s) applied.`;
}

// ─── REPLACE SYMBOL ───

/**
 * Replace the full body of a function/class/interface by name.
 * Avoids reading the entire file — the AI only sends the new body.
 */
export async function replaceSymbol(
	projectRoot: string,
	filePath: string,
	symbolName: string,
	newBody: string
): Promise<string> {
	const outline = await getFileOutline(projectRoot, filePath);
	const sym = outline.symbols.find((s) => s.name === symbolName);
	if (!sym) {
		const available = outline.symbols.map((s) => s.name).join(', ');
		return `Symbol "${symbolName}" not found in ${filePath}. Available: ${available || '(none)'}`;
	}

	const fullPath = resolvePath(projectRoot, filePath);
	const content = await fs.readFile(fullPath, 'utf-8');
	const lines = content.split('\n');

	lines.splice(sym.startLine - 1, sym.endLine - sym.startLine + 1, ...newBody.split('\n'));
	await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');

	return `Replaced [${sym.type}] "${symbolName}" in ${filePath} (was L${sym.startLine}-${sym.endLine}, now ${newBody.split('\n').length} lines).`;
}

// ─── INSERT AFTER SYMBOL ───

/**
 * Insert code immediately after a named function/class.
 * Useful for adding a new function next to a related one.
 */
export async function insertAfterSymbol(
	projectRoot: string,
	filePath: string,
	symbolName: string,
	code: string
): Promise<string> {
	const outline = await getFileOutline(projectRoot, filePath);
	const sym = outline.symbols.find((s) => s.name === symbolName);
	if (!sym) {
		const available = outline.symbols.map((s) => s.name).join(', ');
		return `Symbol "${symbolName}" not found in ${filePath}. Available: ${available || '(none)'}`;
	}

	const fullPath = resolvePath(projectRoot, filePath);
	const content = await fs.readFile(fullPath, 'utf-8');
	const lines = content.split('\n');

	// Insert after endLine (splice at endLine index since array is 0-based)
	lines.splice(sym.endLine, 0, ...code.split('\n'));
	await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');

	return `Inserted ${code.split('\n').length} line(s) after [${sym.type}] "${symbolName}" (after L${sym.endLine}) in ${filePath}.`;
}

// ─── BATCH RENAME ───

/**
 * Rename a symbol (word-boundary match) across all source files in the project.
 * Returns a list of modified files and total replacement count.
 */
export async function batchRename(
	projectRoot: string,
	oldName: string,
	newName: string,
	filePattern?: string
): Promise<string> {
	const regex = new RegExp(`\\b${escapeRegex(oldName)}\\b`, 'g');
	const modified: string[] = [];
	let totalReplacements = 0;

	async function scanDir(dir: string): Promise<void> {
		const entries = await fs.readdir(dir, {withFileTypes: true}).catch(() => [] as import('fs').Dirent[]);
		for (const entry of entries) {
			if (entry.name.startsWith('.') && dir !== projectRoot) continue;
			const fullPath = path.join(dir, entry.name);
			const relPath = path.relative(projectRoot, fullPath);

			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) await scanDir(fullPath);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (!SRC_EXTENSIONS.has(ext)) continue;
				if (filePattern && !relPath.includes(filePattern.replace(/\*/g, ''))) continue;

				const fileContent = await fs.readFile(fullPath, 'utf-8').catch(() => null);
				if (fileContent === null) continue;

				let count = 0;
				const newContent = fileContent.replace(regex, () => {
					count++;
					return newName;
				});
				if (count > 0) {
					await fs.writeFile(fullPath, newContent, 'utf-8');
					modified.push(`  ${relPath} (${count}×)`);
					totalReplacements += count;
				}
			}
		}
	}

	await scanDir(projectRoot);

	if (modified.length === 0) return `No occurrences of "${oldName}" found in source files.`;
	return `Renamed "${oldName}" → "${newName}": ${totalReplacements} replacements in ${modified.length} files:\n${modified.join('\n')}`;
}

// ─── ADD IMPORT ───

/**
 * Add an import statement to a file without duplicating if it already exists.
 * Inserts after the last existing import block.
 */
export async function addImport(
	projectRoot: string,
	filePath: string,
	importStatement: string
): Promise<string> {
	const fullPath = resolvePath(projectRoot, filePath);
	const content = await fs.readFile(fullPath, 'utf-8').catch((e: NodeJS.ErrnoException) => {
		if (e.code === 'ENOENT') throw new Error(`File not found: '${fullPath}'. Use list_files to browse available files.`);
		throw e;
	});

	const normalizedImport = importStatement.trim();

	// Duplicate check: look for the core import path
	if (content.includes(normalizedImport)) {
		return `Import already exists in ${filePath}.`;
	}

	const lines = content.split('\n');

	// Find last import/require line
	let lastImportIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (
			trimmed.startsWith('import ') ||
			(trimmed.startsWith('const ') && trimmed.includes('require(')) ||
			(trimmed.startsWith('var ') && trimmed.includes('require('))
		) {
			lastImportIdx = i;
		} else if (
			lastImportIdx >= 0 &&
			trimmed.length > 0 &&
			!trimmed.startsWith('//')  &&
			!trimmed.startsWith('*') &&
			!trimmed.startsWith('/*')
		) {
			break;
		}
	}

	const insertAt = lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
	lines.splice(insertAt, 0, normalizedImport);

	await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
	return `Added import to ${filePath} at line ${insertAt + 1}.`;
}

// ─── REMOVE DEAD CODE ───

/**
 * Find exported symbols that are never imported elsewhere in the project.
 * dry_run=true (default): report only. dry_run=false: remove them.
 */
export async function removeDeadCode(
	projectRoot: string,
	filePattern?: string,
	dryRun = true
): Promise<string> {
	const allOutlines = await getAllOutlines(projectRoot);

	// Collect all exported symbols
	const exportedSymbols: Array<{
		name: string;
		file: string;
		startLine: number;
		endLine: number;
		type: string;
	}> = [];

	for (const [file, {symbols}] of allOutlines) {
		if (filePattern && !file.includes(filePattern.replace(/\*/g, ''))) continue;
		for (const sym of symbols) {
			if (sym.exported) {
				exportedSymbols.push({name: sym.name, file, startLine: sym.startLine, endLine: sym.endLine, type: sym.type});
			}
		}
	}

	if (exportedSymbols.length === 0) return 'No exported symbols found to analyze.';

	// Read ALL source files (not just those with outlines) so consumer-only files are included
	const fileContents = new Map<string, string>();
	async function collectContents(dir: string): Promise<void> {
		const entries = await fs.readdir(dir, {withFileTypes: true}).catch(() => [] as import('fs').Dirent[]);
		for (const entry of entries) {
			if (entry.name.startsWith('.') && dir !== projectRoot) continue;
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) await collectContents(fullPath);
			} else if (entry.isFile() && SRC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
				const rel = path.relative(projectRoot, fullPath);
				const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
				fileContents.set(rel, content);
			}
		}
	}
	await collectContents(projectRoot);

	// For each exported symbol, check if it's referenced in any OTHER file
	const dead = exportedSymbols.filter((sym) => {
		const wordRegex = new RegExp(`\\b${escapeRegex(sym.name)}\\b`);
		for (const [file, content] of fileContents) {
			if (file === sym.file) continue;
			if (wordRegex.test(content)) return false;
		}
		return true;
	});

	if (dead.length === 0) return `No dead exports found (analyzed ${exportedSymbols.length} exported symbols).`;

	if (dryRun) {
		const rows = dead.map((d) => `  ${d.file}:${d.startLine} [${d.type}] ${d.name}`);
		return `Dead exports — ${dead.length} found (dry run, not deleted):\n${rows.join('\n')}\n\nRun with dry_run=false to remove.`;
	}

	// Group by file and remove from bottom up
	const grouped = new Map<string, typeof dead>();
	for (const d of dead) {
		if (!grouped.has(d.file)) grouped.set(d.file, []);
		grouped.get(d.file)!.push(d);
	}

	const removed: string[] = [];
	for (const [file, syms] of grouped) {
		const fullPath = path.join(projectRoot, file);
		const fileContent = fileContents.get(file) ?? (await fs.readFile(fullPath, 'utf-8'));
		const lines = fileContent.split('\n');

		syms.sort((a, b) => b.startLine - a.startLine);
		for (const sym of syms) {
			lines.splice(sym.startLine - 1, sym.endLine - sym.startLine + 1);
			removed.push(`  ${file}:${sym.startLine} [${sym.type}] ${sym.name}`);
		}

		await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
	}

	return `Removed ${removed.length} dead exports:\n${removed.join('\n')}`;
}
