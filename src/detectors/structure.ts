import * as fs from 'fs/promises';
import * as path from 'path';
import {StructureInfo, FolderInfo} from '../types/index.js';
import {FOLDER_PURPOSES} from './patterns.js';

// Directories to skip entirely
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
	'.idea',
	'.vscode',
	'.turbo',
	'.vercel',
	'.netlify',
]);

// Files that are typically entry points
const ENTRY_POINT_PATTERNS = [
	/^index\.(ts|js|tsx|jsx|py|go|rs|java|php|rb)$/,
	/^main\.(ts|js|tsx|jsx|py|go|rs|java|php|rb)$/,
	/^app\.(ts|js|tsx|jsx|py|go|rs|java|php|rb)$/,
	/^server\.(ts|js|tsx|jsx|py|go|rs|java|php|rb)$/,
	/^mod\.rs$/,
	/^lib\.rs$/,
	/^__init__\.py$/,
	/^__main__\.py$/,
];

// Config files to identify
const CONFIG_FILE_PATTERNS = [
	/^package\.json$/,
	/^tsconfig(\.\w+)?\.json$/,
	/^\.env(\.\w+)?$/,
	/^\.env\.example$/,
	/^docker-compose\.ya?ml$/,
	/^Dockerfile(\.\w+)?$/,
	/^\.dockerignore$/,
	/^\.gitignore$/,
	/^\.eslintrc(\.\w+)?$/,
	/^\.prettierrc(\.\w+)?$/,
	/^jest\.config\.(ts|js|mjs|cjs)$/,
	/^vitest\.config\.(ts|js|mjs|cjs)$/,
	/^vite\.config\.(ts|js|mjs|cjs)$/,
	/^next\.config\.(ts|js|mjs|cjs)$/,
	/^nuxt\.config\.(ts|js|mjs|cjs)$/,
	/^astro\.config\.(ts|js|mjs|cjs)$/,
	/^svelte\.config\.(ts|js|mjs|cjs)$/,
	/^tailwind\.config\.(ts|js|mjs|cjs)$/,
	/^postcss\.config\.(ts|js|mjs|cjs)$/,
	/^webpack\.config\.(ts|js|mjs|cjs)$/,
	/^rollup\.config\.(ts|js|mjs|cjs)$/,
	/^esbuild\.config\.(ts|js|mjs|cjs)$/,
	/^turbo\.json$/,
	/^pnpm-workspace\.yaml$/,
	/^lerna\.json$/,
	/^nx\.json$/,
	/^sst\.config\.ts$/,
	/^serverless\.ya?ml$/,
	/^netlify\.toml$/,
	/^vercel\.json$/,
	/^fly\.toml$/,
	/^render\.yaml$/,
	/^Cargo\.toml$/,
	/^go\.mod$/,
	/^pyproject\.toml$/,
	/^requirements\.txt$/,
	/^Pipfile$/,
	/^Gemfile$/,
	/^composer\.json$/,
	/^pubspec\.yaml$/,
	/^Makefile$/,
	/^CMakeLists\.txt$/,
	/^build\.gradle(\.kts)?$/,
	/^pom\.xml$/,
	/^\.github$/,
	/^\.gitlab-ci\.yml$/,
	/^\.circleci$/,
	/^Jenkinsfile$/,
	/^bitbucket-pipelines\.yml$/,
	/^azure-pipelines\.yml$/,
];

export async function detectStructure(
	projectRoot: string
): Promise<StructureInfo> {
	const rootFiles: string[] = [];
	const folders: FolderInfo[] = [];
	const entryPoints: string[] = [];
	const configFiles: string[] = [];

	try {
		const entries = await fs.readdir(projectRoot, {withFileTypes: true});

		for (const entry of entries) {
			if (entry.name.startsWith('.') && !isImportantDotFile(entry.name)) {
				continue;
			}

			if (entry.isFile()) {
				rootFiles.push(entry.name);

				// Check if it's a config file
				for (const pattern of CONFIG_FILE_PATTERNS) {
					if (pattern.test(entry.name)) {
						configFiles.push(entry.name);
						break;
					}
				}

				// Check if it's an entry point
				for (const pattern of ENTRY_POINT_PATTERNS) {
					if (pattern.test(entry.name)) {
						entryPoints.push(entry.name);
						break;
					}
				}
			} else if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) {
					const folderInfo = await analyzeFolderShallow(
						path.join(projectRoot, entry.name),
						entry.name
					);
					folders.push(folderInfo);

					// Check for entry points in the folder
					for (const mainFile of folderInfo.mainFiles || []) {
						for (const pattern of ENTRY_POINT_PATTERNS) {
							if (pattern.test(mainFile)) {
								entryPoints.push(`${entry.name}/${mainFile}`);
								break;
							}
						}
					}
				}
			}
		}

		// Also scan common source directories for entry points
		const srcDirs = ['src', 'app', 'lib', 'packages', 'apps'];
		for (const srcDir of srcDirs) {
			const srcPath = path.join(projectRoot, srcDir);
			try {
				const srcEntries = await fs.readdir(srcPath, {withFileTypes: true});
				for (const entry of srcEntries) {
					if (entry.isFile()) {
						for (const pattern of ENTRY_POINT_PATTERNS) {
							if (pattern.test(entry.name)) {
								const entryPath = `${srcDir}/${entry.name}`;
								if (!entryPoints.includes(entryPath)) {
									entryPoints.push(entryPath);
								}
								break;
							}
						}
					}
				}
			} catch {
				// Directory doesn't exist
			}
		}
	} catch (error) {
		// Could not read directory
	}

	// Sort folders by importance
	folders.sort((a, b) => {
		const importantDirs = [
			'src',
			'app',
			'lib',
			'packages',
			'apps',
			'api',
			'pages',
			'components',
		];
		const aIndex = importantDirs.indexOf(a.path);
		const bIndex = importantDirs.indexOf(b.path);

		if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
		if (aIndex !== -1) return -1;
		if (bIndex !== -1) return 1;
		return a.path.localeCompare(b.path);
	});

	return {
		rootFiles,
		folders,
		entryPoints,
		configFiles,
	};
}

async function analyzeFolderShallow(
	folderPath: string,
	folderName: string
): Promise<FolderInfo> {
	let fileCount = 0;
	const mainFiles: string[] = [];
	let largestFile: {name: string; lines: number} | undefined;

	try {
		const entries = await fs.readdir(folderPath, {withFileTypes: true});

		for (const entry of entries) {
			if (entry.name.startsWith('.')) continue;

			if (entry.isFile()) {
				fileCount++;

				// Track important files
				if (entry.name.match(/^(index|main|app|mod|lib|__init__)\./)) {
					mainFiles.push(entry.name);
				}

				// Track largest file by counting newlines (cheap)
				try {
					const content = await fs.readFile(
						path.join(folderPath, entry.name),
						'utf-8'
					);
					const lineCount = content.split('\n').length;
					if (!largestFile || lineCount > largestFile.lines) {
						largestFile = {name: entry.name, lines: lineCount};
					}
				} catch {
					// Binary file or unreadable — skip
				}
			} else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
				// Count files in subdirectories (shallow)
				try {
					const subEntries = await fs.readdir(path.join(folderPath, entry.name));
					fileCount += subEntries.filter((e) => !e.startsWith('.')).length;
				} catch {
					// Ignore
				}
			}
		}
	} catch {
		// Could not read directory
	}

	// Get description
	const description =
		FOLDER_PURPOSES[folderName.toLowerCase()] || inferFolderPurpose(folderName);

	return {
		path: folderName,
		description,
		fileCount,
		mainFiles: mainFiles.length > 0 ? mainFiles : undefined,
		largestFile: largestFile && largestFile.lines > 200 ? largestFile : undefined,
	};
}

function inferFolderPurpose(name: string): string {
	const lower = name.toLowerCase();

	// Try to infer from common patterns
	if (lower.includes('component')) return 'UI components';
	if (lower.includes('util') || lower.includes('helper'))
		return 'Utility functions';
	if (lower.includes('service')) return 'Business logic/services';
	if (lower.includes('model') || lower.includes('entity')) return 'Data models';
	if (lower.includes('type') || lower.includes('interface'))
		return 'Type definitions';
	if (lower.includes('hook')) return 'Custom hooks';
	if (lower.includes('api') || lower.includes('route')) return 'API endpoints';
	if (lower.includes('config')) return 'Configuration';
	if (lower.includes('test') || lower.includes('spec')) return 'Tests';
	if (lower.includes('style') || lower.includes('css')) return 'Stylesheets';
	if (
		lower.includes('asset') ||
		lower.includes('static') ||
		lower.includes('public')
	)
		return 'Static assets';
	if (lower.includes('script')) return 'Utility scripts';
	if (lower.includes('doc')) return 'Documentation';
	if (lower.includes('migration')) return 'Database migrations';
	if (lower.includes('seed')) return 'Database seeds';
	if (lower.includes('middleware')) return 'Middleware';
	if (lower.includes('guard') || lower.includes('auth'))
		return 'Authentication/Authorization';
	if (lower.includes('store') || lower.includes('state'))
		return 'State management';
	if (lower.includes('context')) return 'Context providers';
	if (lower.includes('provider')) return 'Providers';
	if (lower.includes('layout')) return 'Layout components';
	if (lower.includes('page')) return 'Page components';
	if (lower.includes('feature')) return 'Feature modules';
	if (lower.includes('module')) return 'Application modules';
	if (lower.includes('domain')) return 'Domain logic';
	if (lower.includes('infra')) return 'Infrastructure';
	if (lower.includes('core')) return 'Core functionality';
	if (lower.includes('shared') || lower.includes('common')) return 'Shared code';

	return 'Project files';
}

function isImportantDotFile(name: string): boolean {
	const important = [
		'.env',
		'.env.example',
		'.env.local',
		'.env.development',
		'.env.production',
		'.gitignore',
		'.dockerignore',
		'.npmignore',
		'.eslintrc',
		'.eslintrc.js',
		'.eslintrc.json',
		'.eslintrc.cjs',
		'.prettierrc',
		'.prettierrc.js',
		'.prettierrc.json',
		'.editorconfig',
		'.github',
	];

	return important.some((f) => name.startsWith(f));
}
