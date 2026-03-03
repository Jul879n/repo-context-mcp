import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Target Definitions ───────────────────────────────────────────────

export interface TargetConfig {
	id: string;
	name: string;
	/** Key inside the JSON where MCP servers live */
	configKey: string;
	/** Some targets nest mcpServers under a parent key */
	parentKey?: string;
	/** Config format */
	format: 'json' | 'toml';
	/** Get config path per platform */
	getPath: (platform: NodeJS.Platform) => string | null;
	/** The MCP server entry to inject */
	serverEntry: Record<string, unknown>;
}

const HOME = os.homedir();

function joinHome(...parts: string[]): string {
	return path.join(HOME, ...parts);
}

/**
 * All supported IDE/AI targets with their config paths.
 * Order matters — shown in this order in the wizard.
 */
export const TARGETS: TargetConfig[] = [
	{
		id: 'claude-desktop',
		name: 'Claude Desktop',
		configKey: 'mcpServers',
		format: 'json',
		getPath: (platform) => {
			if (platform === 'darwin')
				return joinHome(
					'Library',
					'Application Support',
					'Claude',
					'claude_desktop_config.json'
				);
			if (platform === 'win32')
				return path.join(
					process.env.APPDATA || joinHome('AppData', 'Roaming'),
					'Claude',
					'claude_desktop_config.json'
				);
			if (platform === 'linux')
				return joinHome('.config', 'claude', 'claude_desktop_config.json');
			return null;
		},
		serverEntry: {
			command: 'npx',
			args: ['repo-context-mcp'],
		},
	},
	{
		id: 'cursor',
		name: 'Cursor',
		configKey: 'mcpServers',
		format: 'json',
		getPath: (platform) => {
			if (platform === 'win32')
				return path.join(
					process.env.APPDATA || joinHome('AppData', 'Roaming'),
					'Cursor',
					'mcp.json'
				);
			return joinHome('.cursor', 'mcp.json');
		},
		serverEntry: {
			command: 'npx',
			args: ['repo-context-mcp'],
		},
	},
	{
		id: 'windsurf',
		name: 'Windsurf',
		configKey: 'mcpServers',
		format: 'json',
		getPath: () => joinHome('.codeium', 'windsurf', 'mcp_config.json'),
		serverEntry: {
			command: 'npx',
			args: ['repo-context-mcp'],
		},
	},
	{
		id: 'vscode',
		name: 'VS Code',
		configKey: 'servers',
		format: 'json',
		getPath: (platform) => {
			if (platform === 'darwin')
				return joinHome(
					'Library',
					'Application Support',
					'Code',
					'User',
					'mcp.json'
				);
			if (platform === 'win32')
				return path.join(
					process.env.APPDATA || joinHome('AppData', 'Roaming'),
					'Code',
					'User',
					'mcp.json'
				);
			return joinHome('.config', 'Code', 'User', 'mcp.json');
		},
		serverEntry: {
			type: 'stdio',
			command: 'npx',
			args: ['repo-context-mcp'],
		},
	},
	{
		id: 'cline',
		name: 'Cline (VS Code ext)',
		configKey: 'mcpServers',
		format: 'json',
		getPath: (platform) => {
			const base =
				platform === 'darwin'
					? joinHome('Library', 'Application Support', 'Code', 'User')
					: platform === 'win32'
					? path.join(
							process.env.APPDATA || joinHome('AppData', 'Roaming'),
							'Code',
							'User'
					  )
					: joinHome('.config', 'Code', 'User');
			return path.join(
				base,
				'globalStorage',
				'saoudrizwan.claude-dev',
				'settings',
				'cline_mcp_settings.json'
			);
		},
		serverEntry: {
			command: 'npx',
			args: ['repo-context-mcp'],
			disabled: false,
		},
	},
	{
		id: 'zed',
		name: 'Zed Editor',
		configKey: 'context_servers',
		format: 'json',
		getPath: (platform) => {
			if (platform === 'win32')
				return path.join(
					process.env.APPDATA || joinHome('AppData', 'Roaming'),
					'Zed',
					'settings.json'
				);
			return joinHome('.config', 'zed', 'settings.json');
		},
		serverEntry: {
			command: {
				path: 'npx',
				args: ['repo-context-mcp'],
			},
		},
	},
	{
		id: 'opencode',
		name: 'OpenCode',
		configKey: 'mcpServers',
		parentKey: 'mcp',
		format: 'json',
		getPath: (platform) => {
			if (platform === 'win32')
				return joinHome('.config', 'opencode', 'opencode.json');
			return joinHome('.config', 'opencode', 'opencode.json');
		},
		serverEntry: {
			command: 'npx',
			args: ['repo-context-mcp'],
		},
	},
	{
		id: 'codex',
		name: 'Codex CLI (OpenAI)',
		configKey: 'mcp_servers',
		format: 'toml',
		getPath: () => joinHome('.codex', 'config.toml'),
		serverEntry: {
			command: 'npx',
			args: ['repo-context-mcp'],
		},
	},
	{
		id: 'antigravity',
		name: 'Antigravity (Google)',
		configKey: 'mcpServers',
		format: 'json',
		getPath: (platform) => {
			if (platform === 'win32')
				return joinHome('.gemini', 'antigravity', 'mcp_config.json');
			return joinHome('.gemini', 'antigravity', 'mcp_config.json');
		},
		serverEntry: {
			command: 'npx',
			args: ['repo-context-mcp'],
		},
	},
];

// ─── Detection & Status ───────────────────────────────────────────────

export interface TargetStatus {
	target: TargetConfig;
	installed: boolean;
	configured: boolean;
	configPath: string | null;
}

/**
 * Detect which IDEs/AIs are installed and whether repo-context is already configured.
 */
export function detectAll(): TargetStatus[] {
	const platform = process.platform;
	return TARGETS.map((target) => {
		const configPath = target.getPath(platform);
		const installed = configPath ? isInstalled(target, configPath) : false;
		const configured = configPath ? isConfigured(target, configPath) : false;
		return {target, installed, configured, configPath};
	});
}

/**
 * Check if the IDE/AI appears to be installed (config dir exists or config file exists).
 */
function isInstalled(target: TargetConfig, configPath: string): boolean {
	// Check if the config file OR its parent directory exists
	if (fs.existsSync(configPath)) return true;
	const dir = path.dirname(configPath);
	return fs.existsSync(dir);
}

/**
 * Check if repo-context-mcp is already configured in a target.
 */
function isConfigured(target: TargetConfig, configPath: string): boolean {
	if (!fs.existsSync(configPath)) return false;

	try {
		if (target.format === 'toml') {
			const content = fs.readFileSync(configPath, 'utf-8');
			return content.includes('repo-context');
		}

		const content = fs.readFileSync(configPath, 'utf-8');
		const json = JSON.parse(content);

		if (target.parentKey) {
			return !!json[target.parentKey]?.[target.configKey]?.['repo-context'];
		}
		return !!json[target.configKey]?.['repo-context'];
	} catch {
		return false;
	}
}

/**
 * List all targets where repo-context is currently configured.
 */
export function listConfigured(): TargetStatus[] {
	return detectAll().filter((s) => s.configured);
}
