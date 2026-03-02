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

	// ─── searchInProject (new) ───

	describe('searchInProject', () => {
		it('should search across multiple files', async () => {
			const result = await searchInProject(PROJECT_ROOT, 'MAGIC_PATTERN');
			assert.ok(result.includes('matches'));
			assert.ok(result.includes('nested.ts'));
		});

		it('should respect max_results', async () => {
			const result = await searchInProject(PROJECT_ROOT, 'function', undefined, 3);
			assert.ok(result.includes('3 matches'));
		});

		it('should use compact output format', async () => {
			const result = await searchInProject(
				PROJECT_ROOT,
				'greet',
				undefined,
				10,
				0
			);
			// Format: file:line:content
			assert.ok(result.includes(':'));
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
