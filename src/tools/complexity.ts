import * as path from 'path';
import {getAllOutlines} from './file-reader.js';

// ─── COMPLEXITY ANALYSIS ───
// Identifies "heavy" functions/methods to help AI prioritize what to read.
// Output is ultra-compact to minimize token cost.

interface ComplexityEntry {
	file: string;
	line: number;
	name: string;
	lines: number;
	params: number;
}

/**
 * Count top-level parameters in a function signature.
 * Handles generics: countParams("fn(a: Map<K,V>, b: string)") → 2
 */
function countParams(signature: string): number {
	const match = signature.match(/\(([^]*?)\)(?:\s*[:→]|$)/);
	if (!match || !match[1].trim()) return 0;
	const inner = match[1].trim();
	let depth = 0;
	let count = 1;
	for (const ch of inner) {
		if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === ',' && depth === 0) count++;
	}
	return count;
}

/**
 * Match a relative file path against a simple glob pattern.
 * Supports * (any segment chars) and ** (any path).
 */
function matchesPattern(filePath: string, pattern: string): boolean {
	const regex = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, '##GLOBSTAR##')
		.replace(/\*/g, '[^/]*')
		.replace(/##GLOBSTAR##/g, '.*');
	return new RegExp(`(^|/)${regex}($|/)`).test(filePath);
}

/**
 * Analyze all source files and report functions/methods above complexity thresholds.
 * Returns ultra-compact output: `file:line name (Xl, Yp)`
 *
 * @param projectRoot - Absolute path to project root
 * @param filePattern - Optional glob pattern to limit analysis (e.g. "src/**\/*.ts")
 * @param minLines    - Minimum lines in body to flag (default: 30)
 * @param minParams   - Minimum parameter count to flag (default: 4)
 */
export async function getComplexityReport(
	projectRoot: string,
	filePattern?: string,
	minLines = 30,
	minParams = 4
): Promise<string> {
	const outlines = await getAllOutlines(projectRoot);
	const entries: ComplexityEntry[] = [];

	for (const [file, {symbols}] of outlines) {
		if (filePattern && !matchesPattern(file, filePattern)) continue;

		for (const sym of symbols) {
			if (sym.type !== 'function' && sym.type !== 'method' && sym.type !== 'class') {
				continue;
			}
			const bodyLines = sym.endLine - sym.startLine + 1;
			const paramCount = countParams(sym.signature);

			if (bodyLines >= minLines || paramCount >= minParams) {
				entries.push({
					file,
					line: sym.startLine,
					name: sym.name,
					lines: bodyLines,
					params: paramCount,
				});
			}
		}
	}

	if (entries.length === 0) {
		return `No complex symbols found (thresholds: >=${minLines}L, >=${minParams}p)`;
	}

	entries.sort((a, b) => b.lines - a.lines || b.params - a.params);

	const header = `Complexity report — ${entries.length} symbols (>=${minLines}L or >=${minParams}p):`;
	const rows = entries.map(
		(e) => `${e.file}:${e.line} ${e.name} (${e.lines}L, ${e.params}p)`
	);
	return [header, ...rows].join('\n');
}
