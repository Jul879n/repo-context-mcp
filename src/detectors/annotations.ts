import * as fs from 'fs/promises';
import * as path from 'path';
import {Annotations} from '../types/index.js';

const ANNOTATIONS_FILE = '.repo-context-notes.json';

const EMPTY_ANNOTATIONS: Annotations = {
	businessRules: [],
	gotchas: [],
	warnings: [],
};

type AnnotationCategory = keyof Annotations;

/**
 * Read annotations from .repo-context-notes.json
 */
export async function readAnnotations(
	projectRoot: string
): Promise<Annotations> {
	try {
		const filePath = path.join(projectRoot, ANNOTATIONS_FILE);
		const content = await fs.readFile(filePath, 'utf-8');
		const parsed = JSON.parse(content);

		// Validate structure
		return {
			businessRules: Array.isArray(parsed.businessRules)
				? parsed.businessRules
				: [],
			gotchas: Array.isArray(parsed.gotchas) ? parsed.gotchas : [],
			warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
		};
	} catch {
		// File doesn't exist or is invalid — return empty
		return {...EMPTY_ANNOTATIONS};
	}
}

/**
 * Write annotations to .repo-context-notes.json
 */
async function writeAnnotations(
	projectRoot: string,
	annotations: Annotations
): Promise<void> {
	const filePath = path.join(projectRoot, ANNOTATIONS_FILE);
	await fs.writeFile(filePath, JSON.stringify(annotations, null, 2), 'utf-8');
}

/**
 * Add an annotation to a category
 */
export async function addAnnotation(
	projectRoot: string,
	category: AnnotationCategory,
	text: string
): Promise<Annotations> {
	const annotations = await readAnnotations(projectRoot);

	if (!annotations[category]) {
		throw new Error(
			`Invalid category: ${category}. Use: businessRules, gotchas, warnings`
		);
	}

	// Avoid duplicates
	if (annotations[category].includes(text)) {
		return annotations;
	}

	annotations[category].push(text);
	await writeAnnotations(projectRoot, annotations);
	return annotations;
}

/**
 * Remove an annotation by category and index
 */
export async function removeAnnotation(
	projectRoot: string,
	category: AnnotationCategory,
	index: number
): Promise<Annotations> {
	const annotations = await readAnnotations(projectRoot);

	if (!annotations[category]) {
		throw new Error(
			`Invalid category: ${category}. Use: businessRules, gotchas, warnings`
		);
	}

	if (index < 0 || index >= annotations[category].length) {
		throw new Error(
			`Index ${index} out of range. Category "${category}" has ${annotations[category].length} items.`
		);
	}

	annotations[category].splice(index, 1);
	await writeAnnotations(projectRoot, annotations);
	return annotations;
}

/**
 * List all annotations with indices (for display)
 */
export function formatAnnotations(annotations: Annotations): string {
	const lines: string[] = [];

	if (annotations.businessRules.length > 0) {
		lines.push('📋 Business Rules:');
		annotations.businessRules.forEach((rule, i) => {
			lines.push(`  [${i}] ${rule}`);
		});
	}

	if (annotations.gotchas.length > 0) {
		lines.push('⚠ Gotchas:');
		annotations.gotchas.forEach((gotcha, i) => {
			lines.push(`  [${i}] ${gotcha}`);
		});
	}

	if (annotations.warnings.length > 0) {
		lines.push('🔴 Warnings:');
		annotations.warnings.forEach((warning, i) => {
			lines.push(`  [${i}] ${warning}`);
		});
	}

	if (lines.length === 0) {
		return 'No annotations. Use add_annotation to add business rules, gotchas, or warnings.';
	}

	return lines.join('\n');
}
