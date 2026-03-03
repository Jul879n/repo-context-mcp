import {exec} from 'child_process';
import {promisify} from 'util';
import {join} from 'path';
import {readFile, access} from 'fs/promises';
import {glob} from 'glob';

const execAsync = promisify(exec);

export interface DiagnosticResult {
	command: string;
	language: string;
	errorCount: number;
	output: string;
	filteredLines: number;
}

interface LangConfig {
	language: string;
	/** Files/globs whose presence indicates this language (first match wins) */
	indicators: string[];
	/** Shell command to run. Empty string means determined dynamically. */
	command: string;
	/** Lines matching these patterns are KEPT as real errors */
	errorPatterns: RegExp[];
	/** Lines matching these patterns are DISCARDED as noise */
	noisePatterns: RegExp[];
}

// ─── Noise common to every language ─────────────────────────────────────────
const COMMON_NOISE: RegExp[] = [
	/\b(cspell|spellcheck|spell-check)\b/i,
	/unknown word/i,
	/\bspelling\b/i,
	/^> /,             // npm run prefix
	/^> .*@\d/,        // npm package@version line
	/eslint-disable/i,
	/^npm warn/i,
	/^npm notice/i,
	/^\s*$/,           // blank-ish lines
];

// Lines that mean "everything is fine" → discard silently
const CLEAN_PATTERNS: RegExp[] = [
	/no issues found/i,
	/0 errors/i,
	/everything is fine/i,
	/^ok$/i,
	/^success$/i,
];

// ─── Per-language configs (checked in order) ─────────────────────────────────
const LANGUAGE_CONFIGS: LangConfig[] = [
	// Rust
	{
		language: 'rust',
		indicators: ['Cargo.toml'],
		command: 'cargo check 2>&1',
		errorPatterns: [
			/^error(\[E\d+\])?:/,
			/^error: aborting/,
		],
		noisePatterns: [
			/^warning:/,
			/^note:/,
			/^help:/,
			/^\s*= (note|help):/,
			/^Checking /,
			/^Compiling /,
			/^Finished /,
		],
	},
	// Go
	{
		language: 'go',
		indicators: ['go.mod'],
		command: 'go vet ./... 2>&1',
		errorPatterns: [
			/^#/,           // package header before errors
			/:\d+:\d+:/,    // file:line:col: message
			/^vet:/,
		],
		noisePatterns: [
			/^ok\s/,
			/^\?\s/,
		],
	},
	// Python — command resolved dynamically
	{
		language: 'python',
		indicators: ['pyproject.toml', '.mypy.ini', 'setup.cfg', 'Pipfile', 'setup.py', 'requirements.txt'],
		command: '',
		errorPatterns: [
			/: error:/i,
			/^Found \d+ error/i,
			/^\S+\.py:\d+: error/i,
			/^E\d{3,}/,         // pylint Exxx
			/^error:/i,
		],
		noisePatterns: [
			/^note:/i,
			/^Success:/i,
			/^\[mypy\]/i,
			/^Your code has been rated/i,
		],
	},
	// .NET / C# / F#
	{
		language: 'dotnet',
		indicators: ['*.csproj', '*.sln', '*.fsproj'],
		command: 'dotnet build --no-restore -v q 2>&1',
		errorPatterns: [
			/error [A-Z]+\d+:/i,
			/Error\(/i,
			/Build FAILED/i,
			/^\s*\d+ Error(s)?/i,
		],
		noisePatterns: [
			/warning [A-Z]+\d+:/i,
			/Build succeeded/i,
			/^\s*\d+ Warning(s)?/i,
			/^Time Elapsed/i,
		],
	},
	// Java — Maven
	{
		language: 'java-maven',
		indicators: ['pom.xml'],
		command: 'mvn compile -q 2>&1',
		errorPatterns: [
			/^\[ERROR\]/,
			/^error:/i,
			/BUILD FAILURE/,
		],
		noisePatterns: [
			/^\[WARNING\]/,
			/^\[INFO\]/,
			/BUILD SUCCESS/,
		],
	},
	// Java/Kotlin — Gradle
	{
		language: 'java-gradle',
		indicators: ['build.gradle', 'build.gradle.kts'],
		command: './gradlew compileJava 2>&1',
		errorPatterns: [
			/^error:/i,
			/FAILED/,
			/^\d+ error/i,
		],
		noisePatterns: [
			/^warning:/i,
			/^Note:/,
			/^> Task/,
			/^BUILD SUCCESSFUL/,
			/^\d+ actionable task/,
		],
	},
	// Ruby
	{
		language: 'ruby',
		indicators: ['Gemfile'],
		command: 'bundle exec rubocop --format progress 2>&1',
		errorPatterns: [
			/: [CEF]: /,        // Convention / Error / Fatal
			/\d+ offense/i,
		],
		noisePatterns: [
			/: [WR]: /,         // Warning / Refactor
			/Inspecting \d+ file/i,
			/no offenses detected/i,
		],
	},
	// Swift
	{
		language: 'swift',
		indicators: ['Package.swift'],
		command: 'swift build 2>&1',
		errorPatterns: [
			/: error: /,
			/Build complete with \d+ error/i,
		],
		noisePatterns: [
			/: warning: /,
			/: note: /,
			/Build complete!/,
			/Compiling /,
		],
	},
	// PHP
	{
		language: 'php',
		indicators: ['composer.json'],
		command: 'find . -name "*.php" -not -path "*/vendor/*" | xargs php -l 2>&1',
		errorPatterns: [
			/^Parse error:/i,
			/^Fatal error:/i,
			/^Errors parsing/i,
		],
		noisePatterns: [
			/^No syntax errors detected/i,
		],
	},
	// Node.js / TypeScript — last (package.json is very generic)
	{
		language: 'node',
		indicators: ['package.json'],
		command: '', // resolved dynamically
		errorPatterns: [
			/error TS\d+:/i,
			/^Error:/i,
			/Fatal:/i,
			/✖ \d+ problem/i,
			/failed with code/i,
			/^\S+\.\w+:\d+:\d+:/,
		],
		noisePatterns: [
			/^warning/i,
			/eslint-disable/i,
		],
	},
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function resolveNodeCommand(projectRoot: string): Promise<string> {
	try {
		const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf-8'));
		if (pkg.scripts?.typecheck) return 'npm run typecheck';
		if (pkg.scripts?.['type-check']) return 'npm run type-check';
		if (pkg.scripts?.lint) return 'npm run lint';
	} catch {}
	if (await fileExists(join(projectRoot, 'tsconfig.json'))) {
		return 'npx tsc --noEmit';
	}
	return 'node --check index.js 2>&1';
}

async function resolvePythonCommand(projectRoot: string): Promise<string> {
	const pyproject = join(projectRoot, 'pyproject.toml');
	if (await fileExists(pyproject)) {
		try {
			const content = await readFile(pyproject, 'utf-8');
			if (content.includes('[tool.ruff]')) return 'ruff check . 2>&1';
			if (content.includes('[tool.mypy]')) return 'python -m mypy . 2>&1';
		} catch {}
	}
	if (await fileExists(join(projectRoot, '.mypy.ini'))) {
		return 'python -m mypy . 2>&1';
	}
	return 'python -m mypy . 2>&1';
}

async function detectConfig(
	projectRoot: string,
): Promise<{config: LangConfig; command: string} | null> {
	for (const config of LANGUAGE_CONFIGS) {
		for (const indicator of config.indicators) {
			const found = indicator.includes('*')
				? (await glob(join(projectRoot, indicator))).length > 0
				: await fileExists(join(projectRoot, indicator));

			if (!found) continue;

			let command = config.command;
			if (config.language === 'node') command = await resolveNodeCommand(projectRoot);
			else if (config.language === 'python') command = await resolvePythonCommand(projectRoot);

			return {config, command};
		}
	}
	return null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function getDiagnostics(projectRoot: string): Promise<DiagnosticResult> {
	const detected = await detectConfig(projectRoot);

	if (!detected) {
		return {
			command: 'none',
			language: 'unknown',
			errorCount: 0,
			output:
				'Could not detect project language. No known config file found ' +
				'(package.json, Cargo.toml, go.mod, pyproject.toml, pom.xml, build.gradle, Gemfile, Package.swift, composer.json, *.csproj).',
			filteredLines: 0,
		};
	}

	const {config, command} = detected;
	console.log(`[repo-context] Diagnostics [${config.language}]: ${command}`);

	let rawOutput = '';
	try {
		const {stdout, stderr} = await execAsync(`cd "${projectRoot}" && ${command}`, {
			maxBuffer: 1024 * 1024 * 5,
		});
		rawOutput = stdout + '\n' + stderr;
	} catch (err: any) {
		rawOutput = (err.stdout ?? '') + '\n' + (err.stderr ?? '');
	}

	if (!rawOutput.trim()) {
		return {
			command,
			language: config.language,
			errorCount: 0,
			output: 'No issues found.',
			filteredLines: 0,
		};
	}

	const allNoise = [...COMMON_NOISE, ...config.noisePatterns];
	const fatalErrors: string[] = [];
	let filteredCount = 0;

	for (const line of rawOutput.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (CLEAN_PATTERNS.some((r) => r.test(trimmed))) {
			filteredCount++;
			continue;
		}
		if (allNoise.some((r) => r.test(trimmed))) {
			filteredCount++;
			continue;
		}

		if (config.errorPatterns.some((r) => r.test(trimmed))) {
			fatalErrors.push(trimmed);
		} else if (fatalErrors.length > 0 && (line.startsWith(' ') || line.startsWith('\t'))) {
			// Indented context line immediately after an error
			fatalErrors.push(line.trimEnd());
		} else {
			filteredCount++;
		}
	}

	// Cap output to save tokens
	const MAX_LINES = 50;
	if (fatalErrors.length > MAX_LINES) {
		const removed = fatalErrors.length - MAX_LINES;
		fatalErrors.length = MAX_LINES;
		fatalErrors.push(`... and ${removed} more lines truncated to save tokens.`);
	}

	return {
		command,
		language: config.language,
		errorCount: fatalErrors.length,
		output:
			fatalErrors.length > 0
				? fatalErrors.join('\n')
				: 'Command ran cleanly — all output filtered as non-fatal noise.',
		filteredLines: filteredCount,
	};
}
