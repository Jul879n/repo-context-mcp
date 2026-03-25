import {describe, it, before, after} from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const {getComplexityReport} = await import('../dist/tools/complexity.js');
const {searchSymbolInProject} = await import('../dist/tools/file-reader.js');
const {
	patchFile,
	replaceSymbol,
	insertAfterSymbol,
	batchRename,
	addImport,
	removeDeadCode,
} = await import('../dist/tools/file-editor.js');

const TEMP_DIR = path.join(PROJECT_ROOT, 'tests', '_temp_features');

// ─── Setup/Teardown ───────────────────────────────────────────────────────────

before(async () => {
	await fs.mkdir(TEMP_DIR, {recursive: true});

	// File with complex functions (many lines / params)
	await fs.writeFile(
		path.join(TEMP_DIR, 'complex.ts'),
		[
			'export function simpleFunc(a: number): number {',
			'  return a + 1;',
			'}',
			'',
			'/** Heavy function: 35 lines */',
			'export function heavyFunc(a: string, b: number, c: boolean, d: string, e: number): string {',
			...Array.from({length: 33}, (_, i) => `  const x${i} = ${i};`),
			'  return a;',
			'}',
			'',
			'export interface User {',
			'  id: number;',
			'  name: string;',
			'}',
		].join('\n')
	);

	// File for patch/replace/insert tests
	await fs.writeFile(
		path.join(TEMP_DIR, 'edit-target.ts'),
		[
			'export function add(a: number, b: number): number {',
			'  return a + b;',
			'}',
			'',
			'export function multiply(a: number, b: number): number {',
			'  return a * b;',
			'}',
		].join('\n')
	);

	// File for batch rename
	await fs.writeFile(
		path.join(TEMP_DIR, 'rename-a.ts'),
		'export function oldName() { return 1; }\n'
	);
	await fs.writeFile(
		path.join(TEMP_DIR, 'rename-b.ts'),
		'import { oldName } from "./rename-a";\nconst x = oldName();\n'
	);

	// File for add_import
	await fs.writeFile(
		path.join(TEMP_DIR, 'imports.ts'),
		[
			"import { readFile } from 'fs/promises';",
			'',
			'export async function load(p: string) {',
			'  return readFile(p, "utf-8");',
			'}',
		].join('\n')
	);

	// File for remove_dead_code
	await fs.writeFile(
		path.join(TEMP_DIR, 'dead-code.ts'),
		[
			'export function usedFn() { return 1; }',
			'export function deadFn() { return 2; }',
		].join('\n')
	);
	await fs.writeFile(
		path.join(TEMP_DIR, 'dead-code-consumer.ts'),
		"import { usedFn } from './dead-code';\nconsole.log(usedFn());\n"
	);
});

after(async () => {
	await fs.rm(TEMP_DIR, {recursive: true, force: true});
});

// ─── get_complexity ───────────────────────────────────────────────────────────

describe('getComplexityReport', () => {
	it('detects heavy function by line count', async () => {
		const result = await getComplexityReport(TEMP_DIR, undefined, 30, 99);
		assert.ok(result.includes('heavyFunc'), `Expected heavyFunc in:\n${result}`);
	});

	it('detects heavy function by param count', async () => {
		const result = await getComplexityReport(TEMP_DIR, undefined, 999, 4);
		assert.ok(result.includes('heavyFunc'), `Expected heavyFunc in:\n${result}`);
	});

	it('excludes simple functions below threshold', async () => {
		const result = await getComplexityReport(TEMP_DIR, undefined, 30, 4);
		assert.ok(!result.includes('simpleFunc'), `simpleFunc should not appear:\n${result}`);
	});

	it('output is compact (no excess tokens)', async () => {
		const result = await getComplexityReport(TEMP_DIR, undefined, 30, 4);
		// Should be format: "file:line name (XL, Yp)"
		assert.ok(/\w+:\d+ \w+ \(\d+L, \d+p\)/.test(result), `Unexpected format:\n${result}`);
	});

	it('returns message when nothing found', async () => {
		const result = await getComplexityReport(TEMP_DIR, undefined, 9999, 99);
		assert.ok(result.includes('No complex'), `Expected 'No complex' in:\n${result}`);
	});
});

// ─── search_symbol context_filter ────────────────────────────────────────────

describe('searchSymbolInProject context_filter', () => {
	it('filters by has_param_type', async () => {
		const result = await searchSymbolInProject(
			TEMP_DIR,
			'heavyFunc',
			undefined,
			undefined,
			{has_param_type: 'boolean'}
		);
		assert.ok(result.includes('heavyFunc'), `Expected heavyFunc in:\n${result}`);
	});

	it('filters out symbols that do not match param type', async () => {
		const result = await searchSymbolInProject(
			TEMP_DIR,
			'simpleFunc',
			undefined,
			undefined,
			{has_param_type: 'boolean'}
		);
		// simpleFunc(a: number) doesn't have a boolean param
		assert.ok(
			result.includes('No symbols') || !result.includes('simpleFunc'),
			`simpleFunc should not match boolean filter:\n${result}`
		);
	});

	it('context_lines shows preview of function body', async () => {
		const result = await searchSymbolInProject(
			TEMP_DIR,
			'add',
			'function',
			undefined,
			undefined,
			3
		);
		// Should include function body lines
		assert.ok(result.includes('return a + b'), `Expected body preview in:\n${result}`);
	});
});

// ─── patch_file ───────────────────────────────────────────────────────────────

describe('patchFile', () => {
	it('applies a unified diff patch', async () => {
		// Copy edit-target to avoid contaminating other tests
		const target = path.join(TEMP_DIR, 'patch-target.ts');
		await fs.copyFile(path.join(TEMP_DIR, 'edit-target.ts'), target);

		const patch = [
			'@@ -1,3 +1,3 @@',
			' export function add(a: number, b: number): number {',
			'-  return a + b;',
			'+  return a + b + 0; // patched',
			' }',
		].join('\n');

		const result = await patchFile(TEMP_DIR, 'patch-target.ts', patch);
		assert.ok(result.includes('hunk'), `Expected hunk confirmation:\n${result}`);

		const content = await fs.readFile(target, 'utf-8');
		assert.ok(content.includes('// patched'), `Patch not applied:\n${content}`);
	});

	it('returns error for invalid patch', async () => {
		const result = await patchFile(TEMP_DIR, 'patch-target.ts', 'no hunks here');
		assert.ok(result.includes('No valid hunks'), `Expected hunk error:\n${result}`);
	});
});

// ─── replace_symbol ───────────────────────────────────────────────────────────

describe('replaceSymbol', () => {
	it('replaces a function body by name', async () => {
		const target = path.join(TEMP_DIR, 'replace-target.ts');
		await fs.copyFile(path.join(TEMP_DIR, 'edit-target.ts'), target);

		const newBody = [
			'export function add(a: number, b: number): number {',
			'  // replaced implementation',
			'  return (a + b) * 1;',
			'}',
		].join('\n');

		const result = await replaceSymbol(TEMP_DIR, 'replace-target.ts', 'add', newBody);
		assert.ok(result.includes('Replaced'), `Expected Replaced in:\n${result}`);

		const content = await fs.readFile(target, 'utf-8');
		assert.ok(content.includes('// replaced implementation'), `Replace not applied:\n${content}`);
		// Original body should be gone
		assert.ok(!content.includes('return a + b;'), `Original body still present:\n${content}`);
	});

	it('returns error for unknown symbol', async () => {
		const result = await replaceSymbol(TEMP_DIR, 'replace-target.ts', 'nonExistent', 'function nonExistent() {}');
		assert.ok(result.includes('not found'), `Expected not found:\n${result}`);
	});
});

// ─── insert_after_symbol ─────────────────────────────────────────────────────

describe('insertAfterSymbol', () => {
	it('inserts code after a named function', async () => {
		const target = path.join(TEMP_DIR, 'insert-target.ts');
		await fs.copyFile(path.join(TEMP_DIR, 'edit-target.ts'), target);

		const code = '\nexport function newHelper() { return 42; }';
		const result = await insertAfterSymbol(TEMP_DIR, 'insert-target.ts', 'add', code);
		assert.ok(result.includes('Inserted'), `Expected Inserted in:\n${result}`);

		const content = await fs.readFile(target, 'utf-8');
		assert.ok(content.includes('newHelper'), `Insert not applied:\n${content}`);
		// newHelper should appear after add
		const addIdx = content.indexOf('function add');
		const helperIdx = content.indexOf('newHelper');
		assert.ok(helperIdx > addIdx, 'newHelper should come after add');
	});
});

// ─── batch_rename ─────────────────────────────────────────────────────────────

describe('batchRename', () => {
	it('renames symbol across multiple files', async () => {
		const result = await batchRename(TEMP_DIR, 'oldName', 'newName');
		assert.ok(result.includes('newName'), `Expected newName in:\n${result}`);
		assert.ok(result.includes('rename-a.ts'), `Expected rename-a.ts:\n${result}`);
		assert.ok(result.includes('rename-b.ts'), `Expected rename-b.ts:\n${result}`);

		const fileA = await fs.readFile(path.join(TEMP_DIR, 'rename-a.ts'), 'utf-8');
		const fileB = await fs.readFile(path.join(TEMP_DIR, 'rename-b.ts'), 'utf-8');
		assert.ok(fileA.includes('newName'), `rename-a.ts not updated:\n${fileA}`);
		assert.ok(fileB.includes('newName'), `rename-b.ts not updated:\n${fileB}`);
		assert.ok(!fileA.includes('oldName'), `oldName still in rename-a.ts:\n${fileA}`);
	});

	it('returns message when symbol not found', async () => {
		const result = await batchRename(TEMP_DIR, 'doesNotExistXYZ', 'whatever');
		assert.ok(result.includes('No occurrences'), `Expected No occurrences:\n${result}`);
	});
});

// ─── add_import ───────────────────────────────────────────────────────────────

describe('addImport', () => {
	it('adds a new import after existing imports', async () => {
		const target = path.join(TEMP_DIR, 'add-import-target.ts');
		await fs.copyFile(path.join(TEMP_DIR, 'imports.ts'), target);

		const result = await addImport(
			TEMP_DIR,
			'add-import-target.ts',
			"import { writeFile } from 'fs/promises';"
		);
		assert.ok(result.includes('Added import'), `Expected Added import:\n${result}`);

		const content = await fs.readFile(target, 'utf-8');
		assert.ok(content.includes("import { writeFile }"), `Import not added:\n${content}`);
		// New import should be near other imports (within first 5 lines)
		const lines = content.split('\n');
		const importLine = lines.findIndex(l => l.includes('writeFile'));
		assert.ok(importLine < 5, `Import added too late (line ${importLine}):\n${content}`);
	});

	it('skips duplicate imports', async () => {
		const target = path.join(TEMP_DIR, 'add-import-target.ts');
		const result = await addImport(
			TEMP_DIR,
			'add-import-target.ts',
			"import { writeFile } from 'fs/promises';"
		);
		assert.ok(result.includes('already exists'), `Expected already exists:\n${result}`);
	});
});

// ─── remove_dead_code ────────────────────────────────────────────────────────

describe('removeDeadCode', () => {
	it('detects dead exports in dry_run mode', async () => {
		const result = await removeDeadCode(TEMP_DIR, undefined, true);
		assert.ok(result.includes('deadFn'), `Expected deadFn in dry run:\n${result}`);
		assert.ok(result.includes('dry run'), `Expected dry run notice:\n${result}`);

		// File should be unchanged in dry run
		const content = await fs.readFile(path.join(TEMP_DIR, 'dead-code.ts'), 'utf-8');
		assert.ok(content.includes('deadFn'), `deadFn should still exist in dry run:\n${content}`);
	});

	it('does not flag used exports', async () => {
		const result = await removeDeadCode(TEMP_DIR, undefined, true);
		// usedFn is imported by dead-code-consumer.ts, should not appear
		assert.ok(!result.includes('usedFn'), `usedFn should not be flagged:\n${result}`);
	});

	it('removes dead exports when dry_run=false', async () => {
		// Copy to avoid breaking other tests
		const deadFile = path.join(TEMP_DIR, 'dead-remove.ts');
		await fs.writeFile(deadFile, 'export function orphan() { return 99; }\n');

		const result = await removeDeadCode(TEMP_DIR, 'dead-remove', false);
		assert.ok(result.includes('orphan'), `Expected orphan in result:\n${result}`);

		const content = await fs.readFile(deadFile, 'utf-8').catch(() => '');
		assert.ok(!content.includes('function orphan'), `orphan should be removed:\n${content}`);
	});
});
