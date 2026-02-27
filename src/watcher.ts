import * as fs from 'fs';
import * as path from 'path';
import {generateDocs} from './tools/docs-generator.js';

// Directories to skip watching
const SKIP_DIRS = new Set([
	'node_modules',
	'vendor',
	'venv',
	'.venv',
	'env',
	'.env',
	'target',
	'build',
	'dist',
	'out',
	'.git',
	'__pycache__',
	'.next',
	'.nuxt',
	'.svelte-kit',
	'coverage',
	'.cache',
	'.repo-context', // Don't watch our own output
]);

// Debounce timer
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 5000; // 5 seconds

/**
 * Start watching the project root for file changes.
 * When changes are detected, regenerates auto-docs after a debounce period.
 * Uses native fs.watch — no external dependencies.
 */
export function startWatcher(projectRoot: string): void {
	const watchers: fs.FSWatcher[] = [];

	function onFileChange(_event: string, filename: string | null): void {
		// Ignore non-source changes
		if (filename && shouldIgnore(filename)) return;

		// Debounce: wait 5s after last change before regenerating
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(async () => {
			try {
				console.error(`[repo-context] Changes detected, regenerating docs...`);
				await generateDocs(projectRoot);
			} catch (error) {
				console.error(`[repo-context] Watcher error:`, error);
			}
		}, DEBOUNCE_MS);
	}

	// Watch project root (non-recursive for top-level changes)
	try {
		const rootWatcher = fs.watch(projectRoot, {persistent: false}, onFileChange);
		watchers.push(rootWatcher);
	} catch {
		// Ignore errors
	}

	// Watch source directories recursively
	try {
		const entries = fs.readdirSync(projectRoot, {withFileTypes: true});
		for (const entry of entries) {
			if (
				entry.isDirectory() &&
				!SKIP_DIRS.has(entry.name) &&
				!entry.name.startsWith('.')
			) {
				try {
					const dirPath = path.join(projectRoot, entry.name);
					const watcher = fs.watch(
						dirPath,
						{recursive: true, persistent: false},
						onFileChange
					);
					watchers.push(watcher);
				} catch {
					// Some dirs can't be watched, skip
				}
			}
		}
	} catch {
		// Ignore errors
	}

	console.error(
		`[repo-context] File watcher started (${watchers.length} watchers, ${
			DEBOUNCE_MS / 1000
		}s debounce)`
	);

	// Cleanup on process exit
	const cleanup = () => {
		for (const w of watchers) {
			try {
				w.close();
			} catch {
				/* ignore */
			}
		}
		if (debounceTimer) clearTimeout(debounceTimer);
	};

	process.on('SIGINT', cleanup);
	process.on('SIGTERM', cleanup);
}

function shouldIgnore(filename: string): boolean {
	// Ignore hidden files, lock files, cache files
	if (filename.startsWith('.')) return true;
	if (filename.endsWith('.lock')) return true;
	if (filename === 'package-lock.json') return true;
	if (filename === '.repo-context.json') return true;

	// Ignore common non-source files
	const ext = path.extname(filename).toLowerCase();
	const ignoreExts = new Set(['.map', '.d.ts', '.min.js', '.min.css', '.log']);
	if (ignoreExts.has(ext)) return true;

	return false;
}
