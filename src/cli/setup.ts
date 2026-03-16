#!/usr/bin/env node

import * as readline from 'readline';
import {detectAll, listConfigured, TargetStatus} from './config-manager.js';
import {writeConfig, removeConfig} from './config-writers.js';

// ─── Colors (ANSI) ────────────────────────────────────────────────────

const C = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m',
	red: '\x1b[31m',
	magenta: '\x1b[35m',
	bgCyan: '\x1b[46m\x1b[30m',
};

// ─── Readline Helper ──────────────────────────────────────────────────

function createRL(): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
}

function ask(rl: readline.Interface, question: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(question, (answer) => resolve(answer.trim()));
	});
}

// ─── Banner ───────────────────────────────────────────────────────────

function printBanner(): void {
	console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════╗
║       reposynapse  ·  Setup Wizard      ║
╚══════════════════════════════════════════════╝${C.reset}
`);
}

// ─── Main Menu ────────────────────────────────────────────────────────

async function mainMenu(rl: readline.Interface): Promise<void> {
	const configured = listConfigured();

	console.log(`${C.bold}What would you like to do?${C.reset}\n`);
	console.log(`  ${C.cyan}1${C.reset})  Configure new IDE/AI`);
	console.log(`  ${C.cyan}2${C.reset})  View current configuration`);
	console.log(`  ${C.cyan}3${C.reset})  Remove configuration from IDE/AI`);
	console.log(`  ${C.cyan}4${C.reset})  Reconfigure all`);
	console.log(`  ${C.cyan}0${C.reset})  Exit\n`);

	if (configured.length > 0) {
		console.log(
			`${C.dim}Currently configured in: ${configured
				.map((s) => s.target.name)
				.join(', ')}${C.reset}\n`
		);
	}

	const choice = await ask(rl, `${C.bold}Choose [0-4]: ${C.reset}`);

	switch (choice) {
		case '1':
			await configureNew(rl);
			break;
		case '2':
			viewConfiguration();
			break;
		case '3':
			await removeConfiguration(rl);
			break;
		case '4':
			await configureAll(rl);
			break;
		case '0':
			console.log(`\n${C.green}✨ Done! Happy coding!${C.reset}\n`);
			return;
		default:
			console.log(`\n${C.yellow}Invalid choice. Try again.${C.reset}\n`);
	}

	// Loop back to menu
	await mainMenu(rl);
}

// ─── Configure New ────────────────────────────────────────────────────

async function configureNew(rl: readline.Interface): Promise<void> {
	const allStatus = detectAll();

	console.log(`\n${C.bold}Available IDEs/AIs:${C.reset}\n`);

	allStatus.forEach((s, i) => {
		const status = s.configured
			? `${C.green}✓ configured${C.reset}`
			: s.installed
			? `${C.yellow}detected${C.reset}`
			: `${C.dim}not detected${C.reset}`;
		console.log(
			`  ${C.cyan}${i + 1}${C.reset})  ${s.target.name.padEnd(22)} ${status}`
		);
	});

	console.log(
		`\n${C.dim}Enter numbers separated by commas (e.g. 1,3,5) or 'all' for all detected${C.reset}`
	);
	const input = await ask(rl, `\n${C.bold}Select targets: ${C.reset}`);

	let selected: TargetStatus[];

	if (input.toLowerCase() === 'all') {
		selected = allStatus.filter((s) => s.installed || s.configured);
	} else {
		const indices = input
			.split(',')
			.map((s) => parseInt(s.trim(), 10) - 1)
			.filter((i) => i >= 0 && i < allStatus.length);
		selected = indices.map((i) => allStatus[i]);
	}

	if (selected.length === 0) {
		console.log(`\n${C.yellow}No targets selected.${C.reset}`);
		return;
	}

	// Check for already configured targets
	const alreadyConfigured = selected.filter((s) => s.configured);
	let overwrite = false;
	if (alreadyConfigured.length > 0) {
		const names = alreadyConfigured.map((s) => s.target.name).join(', ');
		const answer = await ask(
			rl,
			`\n${C.yellow}⚠ ${names} already configured. Overwrite? [y/N]: ${C.reset}`
		);
		overwrite = answer.toLowerCase() === 'y';
	}

	// Write configs
	console.log(`\n${C.bold}Configuring...${C.reset}\n`);
	for (const status of selected) {
		const result = writeConfig(status, overwrite);
		const icon = result.success
			? result.action === 'skipped'
				? '⏭'
				: '✅'
			: '❌';
		const color = result.success ? C.green : C.red;
		console.log(
			`  ${icon} ${color}${status.target.name}${C.reset}: ${result.message}`
		);
		if (result.backupPath) {
			console.log(`     ${C.dim}Backup: ${result.backupPath}${C.reset}`);
		}
	}

	console.log('');
}

// ─── View Configuration ───────────────────────────────────────────────

function viewConfiguration(): void {
	const allStatus = detectAll();

	console.log(`\n${C.bold}Configuration Status:${C.reset}\n`);

	for (const s of allStatus) {
		const icon = s.configured ? '✅' : s.installed ? '○' : '·';
		const status = s.configured
			? `${C.green}configured${C.reset}`
			: s.installed
			? `${C.yellow}detected, not configured${C.reset}`
			: `${C.dim}not installed${C.reset}`;
		const pathInfo = s.configPath
			? `\n     ${C.dim}${s.configPath}${C.reset}`
			: '';
		console.log(`  ${icon} ${s.target.name.padEnd(22)} ${status}${pathInfo}`);
	}

	console.log('');
}

// ─── Remove Configuration ─────────────────────────────────────────────

async function removeConfiguration(rl: readline.Interface): Promise<void> {
	const configured = listConfigured();

	if (configured.length === 0) {
		console.log(`\n${C.yellow}No configurations found to remove.${C.reset}\n`);
		return;
	}

	console.log(`\n${C.bold}Currently configured in:${C.reset}\n`);

	configured.forEach((s, i) => {
		console.log(`  ${C.cyan}${i + 1}${C.reset})  ${s.target.name}`);
	});

	console.log(
		`\n${C.dim}Enter numbers separated by commas (e.g. 1,2) or 'all'${C.reset}`
	);
	const input = await ask(rl, `\n${C.bold}Select to remove: ${C.reset}`);

	let selected: TargetStatus[];

	if (input.toLowerCase() === 'all') {
		selected = configured;
	} else {
		const indices = input
			.split(',')
			.map((s) => parseInt(s.trim(), 10) - 1)
			.filter((i) => i >= 0 && i < configured.length);
		selected = indices.map((i) => configured[i]);
	}

	if (selected.length === 0) {
		console.log(`\n${C.yellow}No targets selected.${C.reset}`);
		return;
	}

	const confirm = await ask(
		rl,
		`\n${C.red}Remove config from ${selected
			.map((s) => s.target.name)
			.join(', ')}? [y/N]: ${C.reset}`
	);

	if (confirm.toLowerCase() !== 'y') {
		console.log(`\n${C.yellow}Cancelled.${C.reset}\n`);
		return;
	}

	console.log(`\n${C.bold}Removing...${C.reset}\n`);
	for (const status of selected) {
		const result = removeConfig(status);
		const icon = result.success ? '✅' : '❌';
		const color = result.success ? C.green : C.red;
		console.log(
			`  ${icon} ${color}${status.target.name}${C.reset}: ${result.message}`
		);
	}

	console.log('');
}

// ─── Configure All (Quick Setup) ──────────────────────────────────────

async function configureAll(rl: readline.Interface): Promise<void> {
	const allStatus = detectAll();
	const detected = allStatus.filter((s) => s.installed);

	if (detected.length === 0) {
		console.log(`\n${C.yellow}No IDEs/AIs detected on this system.${C.reset}`);
		console.log(
			`${C.dim}You can still configure manually with option 1.${C.reset}\n`
		);
		return;
	}

	console.log(`\n${C.bold}Detected IDEs/AIs:${C.reset}\n`);
	for (const s of detected) {
		const state = s.configured ? `${C.green}(already configured)${C.reset}` : '';
		console.log(`  • ${s.target.name} ${state}`);
	}

	const confirm = await ask(
		rl,
		`\n${C.bold}Configure all detected? [Y/n]: ${C.reset}`
	);

	if (confirm.toLowerCase() === 'n') {
		return;
	}

	console.log(`\n${C.bold}Configuring all...${C.reset}\n`);
	for (const status of detected) {
		const result = writeConfig(status, true);
		const icon = result.success ? '✅' : '❌';
		const color = result.success ? C.green : C.red;
		console.log(
			`  ${icon} ${color}${status.target.name}${C.reset}: ${result.message}`
		);
		if (result.backupPath) {
			console.log(`     ${C.dim}Backup: ${result.backupPath}${C.reset}`);
		}
	}

	console.log('');
}

// ─── Auto Mode (postinstall) ──────────────────────────────────────────

function autoMode(): void {
	console.log(`
${C.cyan}${C.bold}reposynapse${C.reset} installed successfully! 🎉

${C.bold}Quick setup:${C.reset}
  ${C.cyan}reposynapse-setup${C.reset}         Interactive wizard
  ${C.cyan}reposynapse --setup${C.reset}   Same thing

${C.bold}Or add manually to your IDE config:${C.reset}
  ${C.dim}{
    "mcpServers": {
      "reposynapse": {
        "command": "npx",
        "args": ["reposynapse"]
      }
    }
  }${C.reset}
`);
}

// ─── Entry Point ──────────────────────────────────────────────────────

async function main(): Promise<void> {
	// Auto mode (postinstall) — just show info message
	if (process.argv.includes('--auto')) {
		autoMode();
		return;
	}

	// Help
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		console.log(`
Usage: reposynapse-setup [options]

Options:
  --help, -h     Show this help
  --status       Show current config status (non-interactive)
  --auto         Show quick setup info (used by postinstall)

Interactive wizard to configure reposynapse in your IDEs and AI tools.
Supports: Claude Desktop, Cursor, Windsurf, VS Code, Cline, Zed, OpenCode, Codex, Antigravity
`);
		return;
	}

	// Status (non-interactive)
	if (process.argv.includes('--status')) {
		printBanner();
		viewConfiguration();
		return;
	}

	// Interactive wizard
	printBanner();

	const rl = createRL();
	try {
		await mainMenu(rl);
	} finally {
		rl.close();
	}
}

main().catch((err) => {
	console.error(`${C.red}Error: ${err.message || err}${C.reset}`);
	process.exit(1);
});
