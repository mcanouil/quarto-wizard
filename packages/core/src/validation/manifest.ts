/**
 * Extension manifest validation utilities.
 */

import type { ExtensionManifest, Contributes } from "../types/manifest.js";

/**
 * Validation issue severity level.
 */
export type ValidationSeverity = "error" | "warning";

/**
 * A single validation issue found in a manifest.
 */
export interface ValidationIssue {
	/** Severity of the issue. */
	severity: ValidationSeverity;
	/** Field path where the issue was found (e.g., "contributes.filter"). */
	field: string;
	/** Human-readable message describing the issue. */
	message: string;
	/** Suggestion for fixing the issue. */
	suggestion?: string;
}

/**
 * Result of manifest validation.
 */
export interface ValidationResult {
	/** Whether the manifest is valid (no errors, warnings allowed). */
	valid: boolean;
	/** List of validation issues found. */
	issues: ValidationIssue[];
	/** Summary counts by severity. */
	summary: {
		errors: number;
		warnings: number;
	};
}

/**
 * Options for manifest validation.
 */
export interface ValidationOptions {
	/** Whether to check for empty contributions (default: true). */
	requireContributions?: boolean;
	/** Whether to validate version format (default: false). */
	validateVersionFormat?: boolean;
	/** Current Quarto version for compatibility checking (optional). */
	quartoVersion?: string;
}

/**
 * Validate an extension manifest.
 *
 * @param manifest - The manifest to validate
 * @param options - Validation options
 * @returns Validation result with any issues found
 */
export function validateManifest(manifest: ExtensionManifest, options: ValidationOptions = {}): ValidationResult {
	const { requireContributions = true, validateVersionFormat = false, quartoVersion } = options;

	const issues: ValidationIssue[] = [];

	// Check required field: title
	if (!manifest.title || manifest.title.trim() === "") {
		issues.push({
			severity: "error",
			field: "title",
			message: "Extension title is required",
			suggestion: 'Add a "title" field to _extension.yml',
		});
	}

	// Check author (warning if missing)
	if (!manifest.author || manifest.author.trim() === "") {
		issues.push({
			severity: "warning",
			field: "author",
			message: "Extension author is not specified",
			suggestion: 'Add an "author" field to _extension.yml',
		});
	}

	// Check version (warning if missing)
	if (!manifest.version || manifest.version.trim() === "") {
		issues.push({
			severity: "warning",
			field: "version",
			message: "Extension version is not specified",
			suggestion: 'Add a "version" field to _extension.yml',
		});
	} else if (validateVersionFormat) {
		// Basic semver-like validation
		const versionPattern = /^\d+(\.\d+)*(-[\w.]+)?(\+[\w.]+)?$/;
		if (!versionPattern.test(manifest.version)) {
			issues.push({
				severity: "warning",
				field: "version",
				message: `Version "${manifest.version}" does not follow semantic versioning`,
				suggestion: 'Use a version like "1.0.0" or "1.0.0-beta"',
			});
		}
	}

	// Check contributions
	if (requireContributions) {
		const hasContributions = checkHasContributions(manifest.contributes);
		if (!hasContributions) {
			issues.push({
				severity: "error",
				field: "contributes",
				message: "Extension must provide at least one contribution",
				suggestion: "Add filters, shortcodes, formats, or other contributions to _extension.yml",
			});
		}
	}

	// Check Quarto version compatibility
	if (quartoVersion && manifest.quartoRequired) {
		const compatible = checkQuartoCompatibility(manifest.quartoRequired, quartoVersion);
		if (!compatible) {
			issues.push({
				severity: "warning",
				field: "quartoRequired",
				message: `Extension requires Quarto ${manifest.quartoRequired}, but you have ${quartoVersion}`,
				suggestion: "Update Quarto or find a compatible extension version",
			});
		}
	}

	// Validate contributes structure
	validateContributes(manifest.contributes, issues);

	const errors = issues.filter((i) => i.severity === "error").length;
	const warnings = issues.filter((i) => i.severity === "warning").length;

	return {
		valid: errors === 0,
		issues,
		summary: {
			errors,
			warnings,
		},
	};
}

/**
 * Check if the contributes object has at least one contribution.
 */
function checkHasContributions(contributes: Contributes): boolean {
	if (!contributes) {
		return false;
	}

	return (
		(contributes.filter && contributes.filter.length > 0) ||
		(contributes.shortcode && contributes.shortcode.length > 0) ||
		(contributes.format && Object.keys(contributes.format).length > 0) ||
		contributes.project !== undefined ||
		(contributes.revealjsPlugin && contributes.revealjsPlugin.length > 0) ||
		contributes.metadata !== undefined
	);
}

/**
 * Check if the current Quarto version meets the requirement.
 */
function checkQuartoCompatibility(required: string, current: string): boolean {
	// Parse version strings into comparable arrays
	const parseVersion = (v: string): number[] => {
		return v
			.replace(/^>=?\s*/, "")
			.split(".")
			.map((n) => parseInt(n, 10) || 0);
	};

	const requiredParts = parseVersion(required);
	const currentParts = parseVersion(current);

	// Pad arrays to same length
	const maxLen = Math.max(requiredParts.length, currentParts.length);
	while (requiredParts.length < maxLen) requiredParts.push(0);
	while (currentParts.length < maxLen) currentParts.push(0);

	// Compare version parts
	for (let i = 0; i < maxLen; i++) {
		if (currentParts[i] > requiredParts[i]) return true;
		if (currentParts[i] < requiredParts[i]) return false;
	}

	return true; // Equal versions
}

/**
 * Validate the contributes structure for common issues.
 */
function validateContributes(contributes: Contributes, issues: ValidationIssue[]): void {
	if (!contributes) {
		return;
	}

	// Check filters are strings
	if (contributes.filter) {
		for (let i = 0; i < contributes.filter.length; i++) {
			const filter = contributes.filter[i];
			if (typeof filter !== "string" || filter.trim() === "") {
				issues.push({
					severity: "error",
					field: `contributes.filter[${i}]`,
					message: "Filter path must be a non-empty string",
					suggestion: "Specify the path to a Lua filter file",
				});
			}
		}
	}

	// Check shortcodes are strings
	if (contributes.shortcode) {
		for (let i = 0; i < contributes.shortcode.length; i++) {
			const shortcode = contributes.shortcode[i];
			if (typeof shortcode !== "string" || shortcode.trim() === "") {
				issues.push({
					severity: "error",
					field: `contributes.shortcode[${i}]`,
					message: "Shortcode path must be a non-empty string",
					suggestion: "Specify the path to a Lua shortcode file",
				});
			}
		}
	}

	// Check formats is an object
	if (contributes.format && typeof contributes.format !== "object") {
		issues.push({
			severity: "error",
			field: "contributes.format",
			message: "Format must be an object",
			suggestion: "Define formats as an object with format names as keys",
		});
	}

	// Check revealjs plugins are strings
	if (contributes.revealjsPlugin) {
		for (let i = 0; i < contributes.revealjsPlugin.length; i++) {
			const plugin = contributes.revealjsPlugin[i];
			if (typeof plugin !== "string" || plugin.trim() === "") {
				issues.push({
					severity: "error",
					field: `contributes.revealjsPlugin[${i}]`,
					message: "Reveal.js plugin path must be a non-empty string",
					suggestion: "Specify the path to a Reveal.js plugin",
				});
			}
		}
	}
}

/**
 * Format validation issues as a human-readable string.
 *
 * @param result - Validation result to format
 * @returns Formatted string with issues
 */
export function formatValidationIssues(result: ValidationResult): string {
	if (result.issues.length === 0) {
		return "No validation issues found.";
	}

	const lines: string[] = [];
	lines.push(`Found ${result.summary.errors} error(s) and ${result.summary.warnings} warning(s):`);
	lines.push("");

	for (const issue of result.issues) {
		const prefix = issue.severity === "error" ? "[ERROR]" : "[WARN]";
		lines.push(`${prefix} ${issue.field}: ${issue.message}`);
		if (issue.suggestion) {
			lines.push(`        Suggestion: ${issue.suggestion}`);
		}
	}

	return lines.join("\n");
}
