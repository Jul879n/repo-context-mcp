import * as fs from 'fs';
import * as path from 'path';
import {TargetConfig, TargetStatus} from './config-manager.js';

// ─── JSON Config Writing ──────────────────────────────────────────────

export interface WriteResult {
	success: boolean;
	action: 'created' | 'merged' | 'skipped' | 'error';
	message: string;
	backupPath?: string;
}

/**
 * Write (or merge) the reposynapse MCP server config into a target's config file.
 */
export function writeConfig(
	status: TargetStatus,
	overwrite: boolean = false
): WriteResult {
	const {target, configPath, configured} = status;

	if (!configPath) {
		return {success: false, action: 'error', message: 'No config path available'};
	}

	if (configured && !overwrite) {
		return {success: true, action: 'skipped', message: 'Already configured'};
	}

	try {
		if (target.format === 'toml') {
			return writeToml(target, configPath);
		}
		return writeJson(target, configPath);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {success: false, action: 'error', message: msg};
	}
}

/**
 * Remove reposynapse config from a target.
 */
export function removeConfig(status: TargetStatus): WriteResult {
	const {target, configPath, configured} = status;

	if (!configPath || !configured) {
		return {success: true, action: 'skipped', message: 'Not configured'};
	}

	try {
		if (target.format === 'toml') {
			return removeFromToml(target, configPath);
		}
		return removeFromJson(target, configPath);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {success: false, action: 'error', message: msg};
	}
}

// ─── JSON Operations ──────────────────────────────────────────────────

function writeJson(target: TargetConfig, configPath: string): WriteResult {
	// Ensure directory exists
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}

	let json: Record<string, unknown> = {};
	let action: 'created' | 'merged' = 'created';
	let backupPath: string | undefined;

	// Read existing file if present
	if (fs.existsSync(configPath)) {
		const raw = fs.readFileSync(configPath, 'utf-8');
		try {
			json = JSON.parse(raw);
		} catch {
			// If unparseable, backup and start fresh
			backupPath = configPath + '.bak';
			fs.copyFileSync(configPath, backupPath);
		}
		action = 'merged';
	}

	// Backup before modifying
	if (action === 'merged' && !backupPath) {
		backupPath = configPath + '.bak';
		fs.copyFileSync(configPath, backupPath);
	}

	// Navigate to the correct nesting level
	if (target.parentKey) {
		if (!json[target.parentKey] || typeof json[target.parentKey] !== 'object') {
			json[target.parentKey] = {};
		}
		const parent = json[target.parentKey] as Record<string, unknown>;
		if (
			!parent[target.configKey] ||
			typeof parent[target.configKey] !== 'object'
		) {
			parent[target.configKey] = {};
		}
		const servers = parent[target.configKey] as Record<string, unknown>;
		servers['reposynapse'] = target.serverEntry;
	} else {
		if (!json[target.configKey] || typeof json[target.configKey] !== 'object') {
			json[target.configKey] = {};
		}
		const servers = json[target.configKey] as Record<string, unknown>;
		servers['reposynapse'] = target.serverEntry;
	}

	fs.writeFileSync(configPath, JSON.stringify(json, null, '\t'), 'utf-8');

	return {
		success: true,
		action,
		message:
			action === 'created' ? `Created ${configPath}` : `Merged into ${configPath}`,
		backupPath,
	};
}

function removeFromJson(target: TargetConfig, configPath: string): WriteResult {
	if (!fs.existsSync(configPath)) {
		return {success: true, action: 'skipped', message: 'File not found'};
	}

	const raw = fs.readFileSync(configPath, 'utf-8');
	const json = JSON.parse(raw);

	// Backup
	const backupPath = configPath + '.bak';
	fs.copyFileSync(configPath, backupPath);

	if (target.parentKey) {
		delete json[target.parentKey]?.[target.configKey]?.['reposynapse'];
	} else {
		delete json[target.configKey]?.['reposynapse'];
	}

	fs.writeFileSync(configPath, JSON.stringify(json, null, '\t'), 'utf-8');

	return {
		success: true,
		action: 'merged',
		message: `Removed from ${configPath}`,
		backupPath,
	};
}

// ─── TOML Operations (simple append) ──────────────────────────────────

function writeToml(target: TargetConfig, configPath: string): WriteResult {
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}

	let content = '';
	let action: 'created' | 'merged' = 'created';
	let backupPath: string | undefined;

	if (fs.existsSync(configPath)) {
		content = fs.readFileSync(configPath, 'utf-8');
		action = 'merged';
		backupPath = configPath + '.bak';
		fs.copyFileSync(configPath, backupPath);

		// Remove existing reposynapse block if present
		content = content.replace(/\n?\[mcp_servers\.reposynapse\][^\[]*/g, '');
	}

	// Append the TOML block
	const tomlBlock = `
[mcp_servers.reposynapse]
command = "npx"
args = ["reposynapse"]
`;

	content = content.trimEnd() + '\n' + tomlBlock;
	fs.writeFileSync(configPath, content, 'utf-8');

	return {
		success: true,
		action,
		message:
			action === 'created' ? `Created ${configPath}` : `Merged into ${configPath}`,
		backupPath,
	};
}

function removeFromToml(
	_target: TargetConfig,
	configPath: string
): WriteResult {
	if (!fs.existsSync(configPath)) {
		return {success: true, action: 'skipped', message: 'File not found'};
	}

	const backupPath = configPath + '.bak';
	fs.copyFileSync(configPath, backupPath);

	let content = fs.readFileSync(configPath, 'utf-8');
	content = content.replace(/\n?\[mcp_servers\.reposynapse\][^\[]*/g, '');
	fs.writeFileSync(configPath, content.trimEnd() + '\n', 'utf-8');

	return {
		success: true,
		action: 'merged',
		message: `Removed from ${configPath}`,
		backupPath,
	};
}
