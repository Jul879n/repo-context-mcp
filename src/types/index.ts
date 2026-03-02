/**
 * Core types for repo-context-mcp
 */

// Supported languages
export type Language =
	| 'javascript'
	| 'typescript'
	| 'python'
	| 'rust'
	| 'go'
	| 'java'
	| 'kotlin'
	| 'csharp'
	| 'php'
	| 'ruby'
	| 'swift'
	| 'dart'
	| 'unknown';

// Framework detection
export interface Framework {
	name: string;
	version?: string;
	category:
		| 'frontend'
		| 'backend'
		| 'fullstack'
		| 'mobile'
		| 'cli'
		| 'library'
		| 'other';
}

// Dependency info
export interface Dependency {
	name: string;
	version: string;
	dev: boolean;
}

// Stack information
export interface StackInfo {
	languages: Language[];
	primaryLanguage: Language;
	frameworks: Framework[];
	dependencies: Dependency[];
	packageManager?: string;
	runtime?: string;
}

// Folder structure
export interface FolderInfo {
	path: string;
	description: string;
	fileCount: number;
	mainFiles?: string[];
	largestFile?: {name: string; lines: number};
}

export interface StructureInfo {
	rootFiles: string[];
	folders: FolderInfo[];
	entryPoints: string[];
	configFiles: string[];
}

// API Endpoints
export type HttpMethod =
	| 'GET'
	| 'POST'
	| 'PUT'
	| 'PATCH'
	| 'DELETE'
	| 'HEAD'
	| 'OPTIONS'
	| 'ALL';

export interface Endpoint {
	method: HttpMethod;
	path: string;
	handler?: string;
	file: string;
	line: number;
	params?: string[];
	description?: string;
}

export interface EndpointsInfo {
	type: 'rest' | 'graphql' | 'grpc' | 'websocket' | 'mixed';
	baseUrl?: string;
	endpoints: Endpoint[];
}

// Models/Schemas
export interface ModelField {
	name: string;
	type: string;
	required: boolean;
	description?: string;
}

export interface Model {
	name: string;
	type: 'interface' | 'type' | 'class' | 'schema' | 'model' | 'struct' | 'enum';
	file: string;
	line: number;
	fields: ModelField[];
	description?: string;
}

export interface ModelsInfo {
	models: Model[];
	ormUsed?: string;
}

// Architecture patterns
export type ArchitecturePattern =
	| 'mvc'
	| 'mvvm'
	| 'clean-architecture'
	| 'hexagonal'
	| 'layered'
	| 'microservices'
	| 'monolith'
	| 'serverless'
	| 'event-driven'
	| 'unknown';

export interface ArchitectureInfo {
	pattern: ArchitecturePattern;
	layers: string[];
	description: string;
}

// Project status
export interface TodoItem {
	text: string;
	file: string;
	line: number;
	priority?: 'high' | 'medium' | 'low';
}

export interface TestInfo {
	framework?: string;
	testFiles: number;
	hasConfig: boolean;
}

export interface StatusInfo {
	todos: TodoItem[];
	tests: TestInfo;
	hasCI: boolean;
	ciPlatform?: string;
	hasDocker: boolean;
	hasDocumentation: boolean;
}

// Full project context
export interface ProjectContext {
	name: string;
	description?: string;
	version?: string;
	stack: StackInfo;
	structure: StructureInfo;
	endpoints?: EndpointsInfo;
	models?: ModelsInfo;
	architecture: ArchitectureInfo;
	status: StatusInfo;
	analyzedAt: string;
	hotFiles?: HotFilesInfo;
	importGraph?: ImportGraphInfo;
	annotations?: Annotations;
}

// Hot files — files that need special attention
export interface HotFile {
	file: string;
	lines: number;
	reason: string; // "oversized" | "high-imports" | "todo-dense" | "high-exports"
	imports?: number;
	exports?: number;
	todoCount?: number;
}

export interface HotFilesInfo {
	files: HotFile[];
	thresholds: {lines: number; imports: number};
}

// Import graph — internal dependency map
export interface ImportNode {
	file: string;
	imports: string[]; // files this file imports
	importedBy: number; // how many files import this one
}

export interface ImportGraphInfo {
	nodes: ImportNode[];
	mostImported: string[]; // top 5 most imported files
	orphans: string[]; // files nobody imports (possible dead code)
}

// Annotations — human knowledge managed via MCP tools
export interface Annotations {
	businessRules: string[];
	gotchas: string[];
	warnings: string[];
}

// File symbols — extracted from source files for smart reading
export interface FileSymbol {
	name: string;
	type:
		| 'function'
		| 'class'
		| 'interface'
		| 'type'
		| 'const'
		| 'enum'
		| 'method'
		| 'export';
	startLine: number;
	endLine: number;
	signature: string;
	exported: boolean;
}

// Cache structure
export interface CacheData {
	version: string;
	context: ProjectContext;
	generatedAt: string;
	projectRoot: string;
	fileHash?: string;
	ttl?: number;
}

// Analyzer interface
export interface Analyzer {
	name: string;
	languages: Language[];
	analyze(projectRoot: string): Promise<Partial<ProjectContext>>;
}

// Detector interface
export interface Detector<T> {
	name: string;
	detect(projectRoot: string, context?: Partial<ProjectContext>): Promise<T>;
}
