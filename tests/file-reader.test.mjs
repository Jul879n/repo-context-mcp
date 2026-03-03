import {describe, it, before, after} from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Dynamic import of dist (ESM)
const {
	getFileOutline,
	readFileLines,
	readFileSymbol,
	searchInFile,
	searchInProject,
	listFiles,
	readFile,
} = await import('../dist/tools/file-reader.js');

// ─── Helper: create temp test files ───
const TEMP_DIR = path.join(PROJECT_ROOT, 'tests', '_temp');

async function setupTempFiles() {
	await fs.mkdir(TEMP_DIR, {recursive: true});

	// Small file (< 200 lines)
	await fs.writeFile(
		path.join(TEMP_DIR, 'small.ts'),
		[
			'export function greet(name: string): string {',
			'  return `Hello, ${name}!`;',
			'}',
			'',
			'export const add = (a: number, b: number) => a + b;',
			'',
			'export interface User {',
			'  id: number;',
			'  name: string;',
			'  email: string;',
			'}',
			'',
			'export type Status = "active" | "inactive";',
			'',
			'// TODO: add more functions',
			'export function farewell(name: string): string {',
			'  return `Goodbye, ${name}!`;',
			'}',
		].join('\n')
	);

	// Large file (> 200 lines)
	const largeLines = [
		'export function firstFunction() {',
		'  console.log("first");',
		'}',
		'',
	];
	for (let i = 0; i < 60; i++) {
		largeLines.push(`export function func${i}() {`);
		largeLines.push(`  // Implementation ${i}`);
		largeLines.push(`  return ${i};`);
		largeLines.push('}');
		largeLines.push('');
	}
	await fs.writeFile(path.join(TEMP_DIR, 'large.ts'), largeLines.join('\n'));

	// Nested structure for search/list tests
	await fs.mkdir(path.join(TEMP_DIR, 'sub'), {recursive: true});
	await fs.writeFile(
		path.join(TEMP_DIR, 'sub', 'nested.ts'),
		[
			'export function nestedFunction() {',
			'  return "nested";',
			'}',
			'',
			'export const MAGIC_PATTERN = "findme_123";',
			'',
			'export function anotherNestedFn() {',
			'  const MAGIC_PATTERN = "findme_456";',
			'  return MAGIC_PATTERN;',
			'}',
		].join('\n')
	);

	// ── Fixtures for searchInProject "better than CLI grep" tests ──
	// Reproduces the exact failure mode: one "hot" file with many matches
	// caused sparse files to be silently skipped in the old implementation.
	const SEARCH_DIR = path.join(TEMP_DIR, 'search-coverage');
	await fs.mkdir(SEARCH_DIR, {recursive: true});

	// hot-file: 20 occurrences of TARGET — used to exhaust the old match budget
	const hotLines = [];
	for (let i = 1; i <= 20; i++) {
		hotLines.push(`const TARGET_${i} = "value_${i}"; // TARGET occurrence`);
	}
	await fs.writeFile(path.join(SEARCH_DIR, 'hot-file.ts'), hotLines.join('\n'));

	// 6 sparse files — each has exactly 1 match; old code skipped these
	for (const letter of ['a', 'b', 'c', 'd', 'e', 'f']) {
		await fs.writeFile(
			path.join(SEARCH_DIR, `sparse-${letter}.ts`),
			`export const UNIQUE_${letter.toUpperCase()} = "data";\n// TARGET found here\nexport function fn${letter}() {}\n`
		);
	}

	// Ignored directory — must never appear in results
	const ignoredDir = path.join(SEARCH_DIR, 'node_modules', 'pkg');
	await fs.mkdir(ignoredDir, {recursive: true});
	await fs.writeFile(
		path.join(ignoredDir, 'index.ts'),
		'// TARGET should be ignored\n'
	);
}

async function cleanupTempFiles() {
	try {
		await fs.rm(TEMP_DIR, {recursive: true, force: true});
	} catch {
		// ignore
	}
}

// ─────────────────────────────────────────

describe('file-reader tools v1.6.0', async () => {
	before(async () => {
		await setupTempFiles();
	});

	after(async () => {
		await cleanupTempFiles();
	});

	// ─── getFileOutline ───

	describe('getFileOutline', () => {
		it('should extract symbols from a TS file', async () => {
			const outline = await getFileOutline(PROJECT_ROOT, 'tests/_temp/small.ts');
			assert.ok(
				outline.symbols.length >= 4,
				`Expected >=4 symbols, got ${outline.symbols.length}`
			);
			assert.ok(outline.totalLines > 0);

			const names = outline.symbols.map((s) => s.name);
			assert.ok(names.includes('greet'), 'Should find "greet"');
			assert.ok(names.includes('User'), 'Should find "User"');
			assert.ok(names.includes('farewell'), 'Should find "farewell"');
		});

		it('should return compact formatted output', async () => {
			const outline = await getFileOutline(PROJECT_ROOT, 'tests/_temp/small.ts');
			assert.ok(outline.formatted.includes('function:greet'));
			assert.ok(outline.formatted.includes('interface:User'));
			assert.ok(/L\d+-\d+/.test(outline.formatted), 'Should have Lstart-end');
		});
	});

	// ─── readFileLines ───

	describe('readFileLines', () => {
		it('should read a specific line range', async () => {
			const result = await readFileLines(
				PROJECT_ROOT,
				'tests/_temp/small.ts',
				1,
				3
			);
			assert.ok(result.includes('Lines 1-3'));
			assert.ok(result.includes('greet'));
		});

		it('should cap at 200 lines max', async () => {
			const result = await readFileLines(
				PROJECT_ROOT,
				'tests/_temp/large.ts',
				1,
				999
			);
			assert.ok(result.includes('Lines 1-200'));
		});
	});

	// ─── readFileSymbol (fuzzy matching) ───

	describe('readFileSymbol', () => {
		it('should find by exact name', async () => {
			const result = await readFileSymbol(
				PROJECT_ROOT,
				'tests/_temp/small.ts',
				'greet'
			);
			assert.ok(result.includes('[function]'));
			assert.ok(result.includes('Hello'));
		});

		it('should find case-insensitively', async () => {
			const result = await readFileSymbol(
				PROJECT_ROOT,
				'tests/_temp/small.ts',
				'GREET'
			);
			assert.ok(result.includes('[function]'));
		});

		it('should find by substring', async () => {
			const result = await readFileSymbol(
				PROJECT_ROOT,
				'tests/_temp/small.ts',
				'fare'
			);
			assert.ok(result.includes('farewell'));
		});

		it('should suggest similar when not found', async () => {
			const result = await readFileSymbol(
				PROJECT_ROOT,
				'tests/_temp/small.ts',
				'xyz_nonexistent'
			);
			assert.ok(result.includes('not found'));
			assert.ok(result.includes('Similar:'));
		});
	});

	// ─── searchInFile (optimized) ───

	describe('searchInFile', () => {
		it('should find matches with compact output', async () => {
			const result = await searchInFile(
				PROJECT_ROOT,
				'tests/_temp/small.ts',
				'function'
			);
			assert.ok(result.includes('matches'));
			assert.ok(
				!result.includes('--- Match'),
				'Should NOT use old verbose format'
			);
		});

		it('should respect max_matches parameter', async () => {
			const result = await searchInFile(
				PROJECT_ROOT,
				'tests/_temp/large.ts',
				'function',
				2,
				5
			);
			assert.ok(result.includes('5 matches'));
			assert.ok(result.includes('truncated'));
		});

		it('should support context_lines=0 (ultra-compact)', async () => {
			const result = await searchInFile(
				PROJECT_ROOT,
				'tests/_temp/small.ts',
				'function',
				0
			);
			const matchLines = result.split('\n').filter((l) => l.startsWith('L'));
			assert.ok(matchLines.length >= 2);
		});

		it('should support regex patterns', async () => {
			const result = await searchInFile(
				PROJECT_ROOT,
				'tests/_temp/small.ts',
				'greet|farewell'
			);
			assert.ok(result.includes('2 matches'));
		});

		it('should return no-match message when nothing found', async () => {
			const result = await searchInFile(
				PROJECT_ROOT,
				'tests/_temp/small.ts',
				'ZZZZNOTHERE'
			);
			assert.ok(result.includes('No matches'));
		});
	});

	// ─── searchInProject ───

	describe('searchInProject', () => {
		const SEARCH_DIR = path.join(TEMP_DIR, 'search-coverage');

		// ── Basic correctness ──

		it('should find matches across multiple files', async () => {
			const result = await searchInProject(PROJECT_ROOT, 'MAGIC_PATTERN');
			assert.ok(result.includes('matches'), 'Should report matches');
			assert.ok(result.includes('nested.ts'), 'Should find nested.ts');
		});

		it('should return no-match message when nothing found', async () => {
			const result = await searchInProject(
				SEARCH_DIR,
				'ZZZNOMATCH_XYZ_9999'
			);
			assert.ok(result.includes('No matches'), `Got: ${result}`);
		});

		it('should support regex patterns', async () => {
			const result = await searchInProject(SEARCH_DIR, 'TARGET_1[0-9]');
			assert.ok(result.includes('hot-file.ts'), 'Should find regex matches');
		});

		it('should filter by file_pattern glob', async () => {
			const result = await searchInProject(
				SEARCH_DIR,
				'TARGET',
				'sparse-*.ts'
			);
			assert.ok(!result.includes('hot-file.ts'), 'hot-file.ts should be excluded');
			assert.ok(result.includes('sparse-'), 'Sparse files should be found');
		});

		// ── Output format ──

		it('should start with a summary line listing all matching files', async () => {
			const result = await searchInProject(SEARCH_DIR, 'TARGET');
			const firstLine = result.split('\n')[0];
			assert.match(
				firstLine,
				/\d+ matches in \d+ files/,
				`First line should be summary, got: "${firstLine}"`
			);
		});

		it('should list each matching file in the summary line', async () => {
			const result = await searchInProject(SEARCH_DIR, 'TARGET');
			// New format: all files (≤10) appear inline in the first summary line
			const firstLine = result.split('\n')[0];
			const foundFiles = ['hot-file.ts', 'sparse-a.ts', 'sparse-b.ts', 'sparse-c.ts'].filter(
				(f) => firstLine.includes(f)
			);
			assert.ok(
				foundFiles.length >= 4,
				`Expected files in summary line, got: "${firstLine}"`
			);
		});

		// ── Complete coverage: the core "better than CLI grep" guarantee ──

		it('never misses a file — all 7 matching files listed even with max_results=2', async () => {
			// Old bug: hot-file.ts had 20 matches, exhausting a budget of 10.
			// Files sparse-a..f (1 match each) were silently skipped.
			// New behavior: all files always appear in the header regardless of max_results.
			const result = await searchInProject(SEARCH_DIR, 'TARGET', undefined, 2);

			assert.ok(result.includes('hot-file.ts'), 'hot-file.ts must be listed');
			for (const letter of ['a', 'b', 'c', 'd', 'e', 'f']) {
				assert.ok(
					result.includes(`sparse-${letter}.ts`),
					`sparse-${letter}.ts must be listed`
				);
			}
		});

		it('reports correct total file count in summary', async () => {
			const result = await searchInProject(SEARCH_DIR, 'TARGET', undefined, 2);
			const firstLine = result.split('\n')[0];
			// 7 files: hot-file + 6 sparse (node_modules excluded)
			assert.match(
				firstLine,
				/in 7 files/,
				`Expected "in 7 files" in summary, got: "${firstLine}"`
			);
		});

		it('excludes node_modules from results', async () => {
			const result = await searchInProject(SEARCH_DIR, 'TARGET');
			const lines = result.split('\n');
			const nodeModulesLines = lines.filter((l) => l.includes('node_modules'));
			assert.strictEqual(
				nodeModulesLines.length,
				0,
				'node_modules should never appear in results'
			);
		});

		// ── Per-file detail truncation ──

		it('truncates detail when a file exceeds max_results matches', async () => {
			// hot-file.ts has 20 matches; max_results=3, max_files=1 → show 3 + truncation note
			const result = await searchInProject(SEARCH_DIR, 'TARGET', undefined, 3, 0, 1);
			assert.ok(
				result.includes('more'),
				`Should show truncation note. Got:\n${result}`
			);
		});

		it('still shows all sparse files in detail when max_files is high enough', async () => {
			const result = await searchInProject(SEARCH_DIR, 'TARGET', undefined, 3, 0, 7);
			// Each sparse file has 1 match which is <= max_results=3, so all get full detail
			for (const letter of ['a', 'b', 'c', 'd', 'e', 'f']) {
				assert.ok(
					result.includes(`sparse-${letter}.ts:`),
					`sparse-${letter}.ts detail section should appear`
				);
			}
		});

		it('context_lines=0 produces compact line:content format', async () => {
			const result = await searchInProject(
				SEARCH_DIR,
				'TARGET',
				'hot-file.ts',
				30,
				0,
				1
			);
			// With ctx=0, each match line is "  N: content" (no surrounding context)
			const matchLines = result.split('\n').filter((l) => /^\s+\d+:/.test(l));
			assert.ok(matchLines.length > 0, 'Should have compact match lines');
		});

		it('context_lines=2 includes surrounding lines', async () => {
			const result = await searchInProject(
				SEARCH_DIR,
				'fn[abc]',
				'sparse-a.ts',
				30,
				2,
				1
			);
			// With context, output should include lines before/after match
			assert.ok(result.includes('>'), 'Should mark matched line with >');
		});
	});

	// ─── listFiles (new) ───

	describe('listFiles', () => {
		it('should list files in a directory', async () => {
			const result = await listFiles(PROJECT_ROOT, 'tests/_temp');
			assert.ok(result.includes('small.ts'));
			assert.ok(result.includes('large.ts'));
			assert.ok(result.includes('sub/'));
		});

		it('should show file sizes', async () => {
			const result = await listFiles(PROJECT_ROOT, 'tests/_temp');
			assert.ok(/\d+[BKM]/.test(result), 'Should show sizes');
		});

		it('should respect max_depth=0', async () => {
			const shallow = await listFiles(PROJECT_ROOT, 'tests/_temp', undefined, 0);
			assert.ok(!shallow.includes('nested.ts'), 'Depth 0 should not show nested');
		});
	});

	// ─── readFile smart (new) ───

	describe('readFile (smart)', () => {
		it('should return full content for small files', async () => {
			const result = await readFile(PROJECT_ROOT, 'tests/_temp/small.ts');
			assert.ok(result.includes('(full)'));
			assert.ok(result.includes('greet'));
			assert.ok(result.includes('farewell'));
		});

		it('should return outline for large files', async () => {
			const result = await readFile(PROJECT_ROOT, 'tests/_temp/large.ts');
			assert.ok(result.includes('outline') || result.includes('large'));
			assert.ok(result.includes('read_file_symbol'));
		});

		it('should read specific range when lines given', async () => {
			const result = await readFile(PROJECT_ROOT, 'tests/_temp/small.ts', 1, 3);
			assert.ok(result.includes('Lines 1-3'));
			assert.ok(result.includes('greet'));
		});
	});
});
