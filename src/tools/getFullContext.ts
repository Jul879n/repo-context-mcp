import * as fs from 'fs/promises';
import * as path from 'path';
import {execFile} from 'child_process';
import {promisify} from 'util';
import {ProjectContext, HotFile} from '../types/index.js';

const execFileAsync = promisify(execFile);
import {CacheManager, FastCache} from '../cache/manager.js';
import {
	detectStack,
	detectEndpoints,
	detectModels,
	detectArchitecture,
	detectStructure,
	detectStatus,
	detectHotFiles,
	detectImportGraph,
	readAnnotations,
} from '../detectors/index.js';

export async function getFullContext(
	projectRoot: string,
	forceRefresh = false
): Promise<ProjectContext> {
	// 1. Check in-memory cache first (fastest)
	if (!forceRefresh) {
		const memoryCached = FastCache.get(projectRoot);
		if (memoryCached) {
			return memoryCached;
		}
	}

	const cache = new CacheManager(projectRoot);

	// 2. Check disk cache
	if (!forceRefresh) {
		const cached = await cache.get();
		if (cached) {
			// Store in memory for future fast access
			FastCache.set(projectRoot, cached);
			return cached;
		}
	}

	// 3. Analyze project (only if cache miss)
	const context = await analyzeProject(projectRoot);

	// 4. Save to both caches
	await cache.set(context, projectRoot);
	FastCache.set(projectRoot, context);

	return context;
}

export async function analyzeProject(
	projectRoot: string
): Promise<ProjectContext> {
	// Get project name from package.json, Cargo.toml, etc. or folder name
	const name = await getProjectName(projectRoot);
	const description = await getProjectDescription(projectRoot);
	const version = await getProjectVersion(projectRoot);

	// Run all detectors in parallel for speed
	const [stack, structure, architecture, status] = await Promise.all([
		detectStack(projectRoot),
		detectStructure(projectRoot),
		detectArchitecture(projectRoot),
		detectStatus(projectRoot),
	]);

	// These depend on stack info - run in parallel
	const frameworkNames = stack.frameworks.map((f) => f.name);
	const [endpoints, models, hotFiles, importGraph, annotations] =
		await Promise.all([
			detectEndpoints(projectRoot, stack.primaryLanguage, frameworkNames),
			detectModels(projectRoot, stack.primaryLanguage),
			detectHotFiles(projectRoot, stack.primaryLanguage),
			detectImportGraph(projectRoot, stack.primaryLanguage),
			readAnnotations(projectRoot),
		]);

	// Enrich hot files with git-modified files
	const modifiedFiles = await getGitModifiedFiles(projectRoot);
	if (modifiedFiles.size > 0) {
		const existingPaths = new Set(hotFiles.files.map((f) => f.file));
		// Mark existing hot files as modified
		for (const hf of hotFiles.files) {
			if (modifiedFiles.has(hf.file)) {
				hf.reason = 'modified,' + hf.reason;
			}
		}
		// Add modified files that aren't already hot
		for (const mf of modifiedFiles) {
			if (!existingPaths.has(mf)) {
				let lineCount = 0;
				try {
					const content = await fs.readFile(path.join(projectRoot, mf), 'utf-8');
					lineCount = content.split('\n').length;
				} catch {
					// ignore unreadable files
				}
				hotFiles.files.unshift({
					file: mf,
					lines: lineCount,
					reason: 'modified',
				});
			}
		}
	}

	// Check if annotations has any content
	const hasAnnotations =
		annotations.businessRules.length > 0 ||
		annotations.gotchas.length > 0 ||
		annotations.warnings.length > 0;

	return {
		name,
		description,
		version,
		stack,
		structure,
		endpoints: endpoints.endpoints.length > 0 ? endpoints : undefined,
		models: models.models.length > 0 ? models : undefined,
		architecture,
		status,
		analyzedAt: new Date().toISOString(),
		hotFiles: hotFiles.files.length > 0 ? hotFiles : undefined,
		importGraph:
			importGraph.nodes.length > 0 || importGraph.orphans.length > 0
				? importGraph
				: undefined,
		annotations: hasAnnotations ? annotations : undefined,
	};
}

async function getProjectName(projectRoot: string): Promise<string> {
	// Try package.json
	try {
		const pkgPath = path.join(projectRoot, 'package.json');
		const content = await fs.readFile(pkgPath, 'utf-8');
		const pkg = JSON.parse(content);
		if (pkg.name) return pkg.name;
	} catch {}

	// Try Cargo.toml
	try {
		const cargoPath = path.join(projectRoot, 'Cargo.toml');
		const content = await fs.readFile(cargoPath, 'utf-8');
		const match = content.match(/name\s*=\s*"([^"]+)"/);
		if (match) return match[1];
	} catch {}

	// Try pyproject.toml
	try {
		const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
		const content = await fs.readFile(pyprojectPath, 'utf-8');
		const match = content.match(/name\s*=\s*"([^"]+)"/);
		if (match) return match[1];
	} catch {}

	// Try go.mod
	try {
		const goModPath = path.join(projectRoot, 'go.mod');
		const content = await fs.readFile(goModPath, 'utf-8');
		const match = content.match(/module\s+(\S+)/);
		if (match) {
			// Return last part of module path
			const parts = match[1].split('/');
			return parts[parts.length - 1];
		}
	} catch {}

	// Fallback to folder name
	return path.basename(projectRoot);
}

async function getProjectDescription(
	projectRoot: string
): Promise<string | undefined> {
	// Try package.json
	try {
		const pkgPath = path.join(projectRoot, 'package.json');
		const content = await fs.readFile(pkgPath, 'utf-8');
		const pkg = JSON.parse(content);
		if (pkg.description) return pkg.description;
	} catch {}

	// Try README (first paragraph only)
	try {
		const readmePath = path.join(projectRoot, 'README.md');
		const content = await fs.readFile(readmePath, 'utf-8');

		const lines = content.split('\n');
		let foundTitle = false;
		let description = '';

		for (const line of lines) {
			if (line.startsWith('#')) {
				foundTitle = true;
				continue;
			}
			if (foundTitle && line.trim()) {
				description = line.trim();
				break;
			}
		}

		// Truncate long descriptions
		if (description && description.length < 200) {
			return description;
		}
	} catch {}

	return undefined;
}

async function getProjectVersion(
	projectRoot: string
): Promise<string | undefined> {
	// Try package.json
	try {
		const pkgPath = path.join(projectRoot, 'package.json');
		const content = await fs.readFile(pkgPath, 'utf-8');
		const pkg = JSON.parse(content);
		if (pkg.version) return pkg.version;
	} catch {}

	// Try Cargo.toml
	try {
		const cargoPath = path.join(projectRoot, 'Cargo.toml');
		const content = await fs.readFile(cargoPath, 'utf-8');
		const match = content.match(/version\s*=\s*"([^"]+)"/);
		if (match) return match[1];
	} catch {}

	return undefined;
}

export async function getGitModifiedFiles(projectRoot: string): Promise<Set<string>> {
	try {
		const {stdout} = await execFileAsync('git', ['diff', '--name-only', 'HEAD'], {
			cwd: projectRoot,
			timeout: 5000,
		});
		const files = stdout
			.trim()
			.split('\n')
			.filter((f) => f.length > 0);
		return new Set(files);
	} catch {
		return new Set();
	}
}

export async function refreshContext(
	projectRoot: string
): Promise<ProjectContext> {
	const cache = new CacheManager(projectRoot);
	await cache.invalidate();
	FastCache.clear(projectRoot);
	return getFullContext(projectRoot, true);
}
