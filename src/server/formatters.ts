import {ProjectContext} from '../types/index.js';
import {
	formatUltraCompact,
	formatCompact,
	formatMinimal,
	formatJSON,
} from '../formatters/index.js';

export type OutputFormat = 'ultra' | 'compact' | 'normal' | 'minimal' | 'json';

export function formatByType(context: ProjectContext, format: OutputFormat): string {
	switch (format) {
		case 'ultra':
			return formatUltraCompact(context);
		case 'compact':
			return formatCompact(context);
		case 'minimal':
			return formatMinimal(context);
		case 'json':
			return formatJSON(context);
		case 'normal':
		default:
			return formatContextNormal(context);
	}
}

// Original "normal" format (kept for backwards compatibility)
export function formatContextNormal(context: ProjectContext): string {
	const sections: string[] = [];

	// Header
	sections.push(`# ${context.name}`);
	if (context.description) {
		sections.push(`\n${context.description}`);
	}
	if (context.version) {
		sections.push(`\nVersion: ${context.version}`);
	}

	// Stack
	sections.push(`\n## Tech Stack`);
	sections.push(`- **Primary Language:** ${context.stack.primaryLanguage}`);
	if (context.stack.languages.length > 1) {
		sections.push(`- **All Languages:** ${context.stack.languages.join(', ')}`);
	}
	if (context.stack.frameworks.length > 0) {
		const fwList = context.stack.frameworks
			.map((f) => `${f.name}${f.version ? ` (${f.version})` : ''}`)
			.join(', ');
		sections.push(`- **Frameworks:** ${fwList}`);
	}
	if (context.stack.packageManager) {
		sections.push(`- **Package Manager:** ${context.stack.packageManager}`);
	}
	if (context.stack.runtime) {
		sections.push(`- **Runtime:** ${context.stack.runtime}`);
	}

	// Key dependencies (limit to 15)
	const prodDeps = context.stack.dependencies.filter((d) => !d.dev).slice(0, 15);
	if (prodDeps.length > 0) {
		sections.push(`\n### Key Dependencies`);
		for (const dep of prodDeps) {
			sections.push(`- ${dep.name}: ${dep.version}`);
		}
	}

	// Structure
	sections.push(`\n## Project Structure`);
	if (context.structure.entryPoints.length > 0) {
		sections.push(`\n### Entry Points`);
		for (const entry of context.structure.entryPoints) {
			sections.push(`- ${entry}`);
		}
	}

	sections.push(`\n### Folders`);
	for (const folder of context.structure.folders.slice(0, 20)) {
		sections.push(
			`- **${folder.path}/** - ${folder.description} (${folder.fileCount} files)`
		);
	}

	if (context.structure.configFiles.length > 0) {
		sections.push(`\n### Config Files`);
		sections.push(context.structure.configFiles.join(', '));
	}

	// Endpoints
	if (context.endpoints && context.endpoints.endpoints.length > 0) {
		sections.push(`\n## API Endpoints (${context.endpoints.type.toUpperCase()})`);
		for (const ep of context.endpoints.endpoints.slice(0, 30)) {
			sections.push(`- \`${ep.method} ${ep.path}\` → ${ep.file}:${ep.line}`);
		}
		if (context.endpoints.endpoints.length > 30) {
			sections.push(
				`\n... and ${context.endpoints.endpoints.length - 30} more endpoints`
			);
		}
	}

	// Models
	if (context.models && context.models.models.length > 0) {
		sections.push(`\n## Data Models`);
		if (context.models.ormUsed) {
			sections.push(`ORM: ${context.models.ormUsed}`);
		}
		for (const model of context.models.models.slice(0, 20)) {
			const fields = model.fields
				.slice(0, 5)
				.map((f) => f.name)
				.join(', ');
			const moreFields =
				model.fields.length > 5 ? `, +${model.fields.length - 5} more` : '';
			sections.push(
				`- **${model.name}** (${model.type}) → ${model.file}:${model.line}`
			);
			if (fields) {
				sections.push(`  Fields: ${fields}${moreFields}`);
			}
		}
		if (context.models.models.length > 20) {
			sections.push(`\n... and ${context.models.models.length - 20} more models`);
		}
	}

	// Architecture
	sections.push(`\n## Architecture`);
	sections.push(`- **Pattern:** ${context.architecture.pattern}`);
	sections.push(`- ${context.architecture.description}`);
	if (context.architecture.layers.length > 0) {
		sections.push(`- **Layers:** ${context.architecture.layers.join(', ')}`);
	}

	// Status
	sections.push(`\n## Project Status`);
	sections.push(
		`- **Documentation:** ${context.status.hasDocumentation ? 'Yes' : 'No'}`
	);
	sections.push(`- **Docker:** ${context.status.hasDocker ? 'Yes' : 'No'}`);
	sections.push(
		`- **CI/CD:** ${
			context.status.hasCI ? `Yes (${context.status.ciPlatform})` : 'No'
		}`
	);
	sections.push(
		`- **Tests:** ${context.status.tests.testFiles} test files${
			context.status.tests.framework ? ` (${context.status.tests.framework})` : ''
		}`
	);
	sections.push(`- **TODOs:** ${context.status.todos.length} found`);

	if (context.status.todos.length > 0) {
		sections.push(`\n### Top TODOs`);
		for (const todo of context.status.todos.slice(0, 5)) {
			const priority =
				todo.priority === 'high' ? '!' : todo.priority === 'medium' ? '-' : '.';
			sections.push(`- ${priority} ${todo.text} (${todo.file}:${todo.line})`);
		}
	}

	// Hot Files
	if (context.hotFiles && context.hotFiles.files.length > 0) {
		sections.push(`\n## ⚠ Hot Files (${context.hotFiles.files.length})`);
		sections.push(
			`*Thresholds: >${context.hotFiles.thresholds.lines} lines, >${context.hotFiles.thresholds.imports} imports*`
		);
		for (const hf of context.hotFiles.files.slice(0, 10)) {
			const details: string[] = [`${hf.lines} lines`];
			if (hf.imports) details.push(`${hf.imports} imports`);
			if (hf.exports) details.push(`${hf.exports} exports`);
			if (hf.todoCount) details.push(`${hf.todoCount} TODOs`);
			sections.push(`- **${hf.file}** (${details.join(', ')}) [${hf.reason}]`);
		}
	}

	// Import Graph
	if (context.importGraph) {
		sections.push(`\n## Import Graph`);
		if (context.importGraph.mostImported.length > 0) {
			sections.push(`\n### Hub Files (most imported)`);
			for (const hub of context.importGraph.mostImported) {
				const node = context.importGraph.nodes.find((n) => n.file === hub);
				sections.push(
					`- **${hub}** (imported by ${node?.importedBy || '?'} files)`
				);
			}
		}
		if (context.importGraph.orphans.length > 0) {
			sections.push(`\n### Orphan Files (not imported by anyone)`);
			for (const orphan of context.importGraph.orphans.slice(0, 10)) {
				sections.push(`- ${orphan}`);
			}
		}
	}

	// Annotations
	if (context.annotations) {
		sections.push(`\n## Project Annotations`);
		if (context.annotations.businessRules.length > 0) {
			sections.push(`\n### 📋 Business Rules`);
			for (const rule of context.annotations.businessRules) {
				sections.push(`- ${rule}`);
			}
		}
		if (context.annotations.gotchas.length > 0) {
			sections.push(`\n### ⚠ Gotchas`);
			for (const g of context.annotations.gotchas) {
				sections.push(`- ${g}`);
			}
		}
		if (context.annotations.warnings.length > 0) {
			sections.push(`\n### 🔴 Warnings`);
			for (const w of context.annotations.warnings) {
				sections.push(`- ${w}`);
			}
		}
	}

	sections.push(`\n---\n*Analyzed at: ${context.analyzedAt}*`);

	return sections.join('\n');
}
