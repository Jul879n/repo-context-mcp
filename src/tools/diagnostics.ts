import {exec} from 'child_process';
import {promisify} from 'util';
import {join} from 'path';
import {readFile} from 'fs/promises';

const execAsync = promisify(exec);

export interface DiagnosticResult {
	command: string;
	errorCount: number;
	output: string;
	filteredLines: number;
}

/**
 * Executes a diagnostic command (typecheck or lint) and aggressively filters out
 * non-fatal errors (spelling, style warnings) to save context tokens.
 */
export async function getDiagnostics(
	projectRoot: string
): Promise<DiagnosticResult> {
	let commandToRun = 'npx tsc --noEmit'; // Default fallback

	try {
		// Read package.json to find a better specific command
		const pkgPath = join(projectRoot, 'package.json');
		const pkgContent = await readFile(pkgPath, 'utf-8');
		const pkg = JSON.parse(pkgContent);

		if (pkg.scripts) {
			if (pkg.scripts.typecheck) {
				commandToRun = 'npm run typecheck';
			} else if (pkg.scripts.lint) {
				// Prefer a lint command if it exists and typecheck doesn't
				commandToRun = 'npm run lint';
			} else if (
				pkg.scripts.build &&
				typeof pkg.scripts.build === 'string' &&
				pkg.scripts.build.includes('tsc')
			) {
				// If build uses tsc, we can safely just run tsc --noEmit
				commandToRun = 'npx tsc --noEmit';
			}
		}
	} catch (error) {
		// Ignore if package.json doesn't exist or isn't parseable
	}

	let rawOutput = '';
	try {
		console.log(`[repo-context] Running diagnostics command: ${commandToRun}`);
		// Run the command. We use maxBuffer to prevent it from crashing on large outputs.
		// npm run lint/tsc will exit with code > 0 if there are errors, which throws in exec.
		const {stdout, stderr} = await execAsync(
			`cd "${projectRoot}" && ${commandToRun}`,
			{
				maxBuffer: 1024 * 1024 * 5, // 5MB limit
			}
		);
		rawOutput = stdout + '\n' + stderr;
	} catch (error: any) {
		// exec throws if exit code != 0, which is exactly what we want for diagnostics
		rawOutput = (error.stdout || '') + '\n' + (error.stderr || '');
	}

	if (!rawOutput.trim()) {
		return {
			command: commandToRun,
			errorCount: 0,
			output: 'No issues found. Everything is clean!',
			filteredLines: 0,
		};
	}

	// Filter the output aggressively
	const lines = rawOutput.split('\n');
	const fatalErrors: string[] = [];
	let filteredCount = 0;

	// Common noise patterns to ignore
	const ignorePatterns = [
		/warning/i,
		/cspell/i,
		/spellcheck/i,
		/unknown word/i,
		/^> /i, // npm run prefixes
		/^> .*@.*/i, // npm run package info
		/eslint-disable/i,
	];

	// Strong indicators of a real error
	const keepPatterns = [
		/error TS\d+:/i, // TypeScript error
		/Error:/i,
		/Fatal:/i,
		/✖ \d+ problem/i, // ESLint summary
		/failed with code/i,
	];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		// 1. Check if we should explicitly ignore it
		const shouldIgnore = ignorePatterns.some((regex) => regex.test(trimmed));
		if (shouldIgnore) {
			filteredCount++;
			continue;
		}

		// 2. Check if it's explicitly a severe error
		const isExplicitError = keepPatterns.some((regex) => regex.test(trimmed));

		// 3. Fallback: if it's not noise, we might want to keep it
		// For example, file paths in ESLint output: "src/file.ts"
		// or TS error contexts: "  const a = 1;"
		// We'll keep lines if they start with a path/line format or spaces (context)
		// and we are accumulating errors.

		// To be extremely strict as requested, we will ONLY keep strong errors
		// and immediate context.

		if (isExplicitError || /^[/\w.-]+:\d+:\d+/i.test(trimmed)) {
			fatalErrors.push(trimmed); // Keep the trimmed explicit error
		} else if (fatalErrors.length > 0 && line.startsWith(' ')) {
			// Keep original indentation for context lines immediately following an error
			fatalErrors.push(line);
		} else {
			// Unclassified noise
			filteredCount++;
		}
	}

	// Limit massive outputs to save tokens
	const MAX_ERRORS = 50;
	if (fatalErrors.length > MAX_ERRORS) {
		const removed = fatalErrors.length - MAX_ERRORS;
		fatalErrors.length = MAX_ERRORS;
		fatalErrors.push(
			`... and ${removed} more error lines truncated to save context.`
		);
	}

	return {
		command: commandToRun,
		errorCount: fatalErrors.length,
		output:
			fatalErrors.length > 0
				? fatalErrors.join('\n')
				: 'Command executed, but all issues were filtered out as non-fatal noise.',
		filteredLines: filteredCount,
	};
}
