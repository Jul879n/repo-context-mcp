import {Prompt, Resource} from '@modelcontextprotocol/sdk/types.js';

// MCP Prompts — inject context WITHOUT tool calls (0 extra tokens per message)
export function getPrompts(): Prompt[] {
	return [
		{
			name: 'project-context',
			description: 'Injects project context into conversation. Use at start.',
			arguments: [
				{
					name: 'format',
					description: 'Output format: minimal, ultra, compact (default)',
					required: false,
				},
			],
		},
		{
			name: 'project-summary',
			description: 'Ultra-minimal project summary (~50 tokens)',
		},
		{
			name: 'file-reader-guide',
			description:
				'Injects instructions for efficient file reading. Use for large files.',
		},
	];
}

// MCP Resources — FREE (no tool call tokens), embedded directly into context
export function getResources(): Resource[] {
	return [
		{
			uri: 'reposynapse://context/summary',
			name: 'Project Summary',
			description:
				'Ultra-compact project summary (~50 tokens). Embed this for instant context.',
			mimeType: 'text/plain',
		},
		{
			uri: 'reposynapse://context/full',
			name: 'Full Project Context',
			description: 'Complete project analysis in compact format.',
			mimeType: 'text/plain',
		},
		{
			uri: 'reposynapse://context/stack',
			name: 'Tech Stack',
			description: 'Languages, frameworks, and dependencies.',
			mimeType: 'text/plain',
		},
		{
			uri: 'reposynapse://context/structure',
			name: 'Project Structure',
			description: 'Folder layout and entry points.',
			mimeType: 'text/plain',
		},
		{
			uri: 'reposynapse://context/api',
			name: 'API Endpoints',
			description: 'REST/GraphQL endpoints if detected.',
			mimeType: 'text/plain',
		},
		{
			uri: 'reposynapse://context/models',
			name: 'Data Models',
			description: 'Schemas, types, and interfaces.',
			mimeType: 'text/plain',
		},
		{
			uri: 'reposynapse://context/hotfiles',
			name: 'Hot Files',
			description: 'Large/complex files that need special attention.',
			mimeType: 'text/plain',
		},
		{
			uri: 'reposynapse://context/annotations',
			name: 'Project Annotations',
			description: 'Human-written business rules, gotchas, and warnings.',
			mimeType: 'text/plain',
		},
		{
			uri: 'reposynapse://context/imports',
			name: 'Import Graph',
			description: 'Internal dependency graph: hub files, orphan files.',
			mimeType: 'text/plain',
		},
		{
			uri: 'reposynapse://context.json',
			name: 'Project Context (JSON)',
			description: 'Full context in JSON format for programmatic use.',
			mimeType: 'application/json',
		},
		{
			uri: 'reposynapse://context/outlines',
			name: 'File Outlines',
			description:
				'All source file outlines: functions, classes, interfaces with line ranges. Use to navigate large files.',
			mimeType: 'text/plain',
		},
	];
}
