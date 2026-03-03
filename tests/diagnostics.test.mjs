import {describe, it, before, after} from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(PROJECT_ROOT, 'tests', '_temp_diag');

const {getDiagnostics} = await import('../dist/tools/diagnostics.js');

// ─── Helper ───────────────────────────────────────────────────────────────────

async function makeProject(files) {
	const dir = path.join(TEMP_DIR, String(Date.now() + Math.random()));
	await fs.mkdir(dir, {recursive: true});
	for (const [name, content] of Object.entries(files)) {
		await fs.writeFile(path.join(dir, name), content);
	}
	return dir;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

before(async () => {
	await fs.mkdir(TEMP_DIR, {recursive: true});
});

after(async () => {
	await fs.rm(TEMP_DIR, {recursive: true, force: true});
});

// ─── Language detection ───────────────────────────────────────────────────────

describe('Language detection', () => {
	it('detects Node.js project via package.json', async () => {
		const dir = await makeProject({
			'package.json': JSON.stringify({name: 'test', scripts: {}}),
			'tsconfig.json': '{}',
		});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'node');
		assert.ok(
			result.command.includes('tsc') || result.command.includes('npm run'),
			`unexpected command: ${result.command}`,
		);
	});

	it('prefers npm run typecheck over tsc when script exists', async () => {
		const dir = await makeProject({
			'package.json': JSON.stringify({
				name: 'test',
				scripts: {typecheck: 'tsc --noEmit'},
			}),
		});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'node');
		assert.ok(result.command.includes('typecheck'), `expected typecheck, got: ${result.command}`);
	});

	it('detects Rust project via Cargo.toml', async () => {
		const dir = await makeProject({'Cargo.toml': '[package]\nname = "test"\nversion = "0.1.0"'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'rust');
		assert.ok(result.command.includes('cargo check'), `unexpected command: ${result.command}`);
	});

	it('detects Go project via go.mod', async () => {
		const dir = await makeProject({'go.mod': 'module example.com/test\ngo 1.21'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'go');
		assert.ok(result.command.includes('go vet'), `unexpected command: ${result.command}`);
	});

	it('detects Python project via pyproject.toml (ruff)', async () => {
		const dir = await makeProject({'pyproject.toml': '[tool.ruff]\nline-length = 88'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'python');
		assert.ok(result.command.includes('ruff'), `unexpected command: ${result.command}`);
	});

	it('detects Python project via pyproject.toml (mypy)', async () => {
		const dir = await makeProject({'pyproject.toml': '[tool.mypy]\nstrict = true'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'python');
		assert.ok(result.command.includes('mypy'), `unexpected command: ${result.command}`);
	});

	it('detects Python project via .mypy.ini', async () => {
		const dir = await makeProject({'.mypy.ini': '[mypy]'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'python');
		assert.ok(result.command.includes('mypy'), `unexpected command: ${result.command}`);
	});

	it('detects Java Maven project via pom.xml', async () => {
		const dir = await makeProject({'pom.xml': '<project/>'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'java-maven');
		assert.ok(result.command.includes('mvn'), `unexpected command: ${result.command}`);
	});

	it('detects Gradle project via build.gradle', async () => {
		const dir = await makeProject({'build.gradle': 'plugins { id "java" }'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'java-gradle');
		assert.ok(result.command.includes('gradlew'), `unexpected command: ${result.command}`);
	});

	it('detects Ruby project via Gemfile', async () => {
		const dir = await makeProject({'Gemfile': 'source "https://rubygems.org"'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'ruby');
		assert.ok(result.command.includes('rubocop'), `unexpected command: ${result.command}`);
	});

	it('detects Swift project via Package.swift', async () => {
		const dir = await makeProject({'Package.swift': '// swift-tools-version:5.5'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'swift');
		assert.ok(result.command.includes('swift build'), `unexpected command: ${result.command}`);
	});

	it('detects PHP project via composer.json', async () => {
		const dir = await makeProject({'composer.json': '{"name": "test/test"}'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'php');
		assert.ok(result.command.includes('php -l'), `unexpected command: ${result.command}`);
	});

	it('returns unknown when no indicator files exist', async () => {
		const dir = await makeProject({'README.md': '# nothing'});
		const result = await getDiagnostics(dir);
		assert.strictEqual(result.language, 'unknown');
		assert.strictEqual(result.errorCount, 0);
	});
});

// ─── Output filtering ─────────────────────────────────────────────────────────

describe('Output filtering', () => {
	it('integration: runs on this repo (node) without throwing', async () => {
		const result = await getDiagnostics(PROJECT_ROOT);
		assert.ok(result, 'should return a result');
		assert.strictEqual(result.language, 'node');
		assert.ok(typeof result.errorCount === 'number');
		assert.ok(typeof result.filteredLines === 'number');
		console.log(`  command: ${result.command}`);
		console.log(`  errors: ${result.errorCount} | filtered: ${result.filteredLines}`);
	});
});
