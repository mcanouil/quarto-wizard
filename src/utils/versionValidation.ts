import * as semver from "semver";
import { getErrorMessage } from "@quarto-wizard/core";
import { logMessage } from "./log";

/**
 * Result of validating a Quarto version requirement.
 */
export interface ValidationResult {
	/** Whether the validation passed. */
	valid: boolean;
	/** The required version constraint (e.g., ">=1.8.20"). */
	required: string | undefined;
	/** The current Quarto version. */
	current: string | undefined;
	/** A human-readable message explaining the validation result. */
	message: string | undefined;
}

/**
 * Validate a Quarto version requirement against the current installed version.
 *
 * This function handles several edge cases gracefully:
 * - If no requirement is specified, validation passes.
 * - If no current version is available (Quarto not detected), validation passes silently.
 * - If the requirement or version is invalid, validation passes with a warning logged.
 *
 * @param quartoRequired - The version requirement from the extension manifest (e.g., ">=1.8.20").
 * @param currentVersion - The current Quarto CLI version (e.g., "1.9.0").
 * @returns The validation result.
 */
export function validateQuartoRequirement(
	quartoRequired: string | undefined,
	currentVersion: string | undefined,
): ValidationResult {
	// No requirement specified - always valid
	if (!quartoRequired) {
		return {
			valid: true,
			required: undefined,
			current: currentVersion,
			message: undefined,
		};
	}

	// No current version available (Quarto not detected) - skip validation silently
	if (!currentVersion) {
		logMessage(`Skipping version validation: Quarto version not available.`, "debug");
		return {
			valid: true,
			required: quartoRequired,
			current: undefined,
			message: undefined,
		};
	}

	// Clean up the version strings
	const cleanedVersion = cleanVersion(currentVersion);
	const cleanedRequirement = quartoRequired.trim();

	// Validate the current version is valid semver
	if (!semver.valid(cleanedVersion)) {
		logMessage(`Invalid Quarto version format: "${currentVersion}". Skipping validation.`, "warn");
		return {
			valid: true,
			required: quartoRequired,
			current: currentVersion,
			message: `Invalid Quarto version format: "${currentVersion}". Skipping validation.`,
		};
	}

	// Validate the requirement is a valid semver range
	if (!semver.validRange(cleanedRequirement)) {
		logMessage(`Invalid version requirement format: "${quartoRequired}". Skipping validation.`, "warn");
		return {
			valid: true,
			required: quartoRequired,
			current: currentVersion,
			message: `Invalid version requirement format: "${quartoRequired}". Skipping validation.`,
		};
	}

	// Check if the current version satisfies the requirement
	try {
		const satisfies = semver.satisfies(cleanedVersion, cleanedRequirement);

		if (satisfies) {
			return {
				valid: true,
				required: quartoRequired,
				current: currentVersion,
				message: undefined,
			};
		} else {
			return {
				valid: false,
				required: quartoRequired,
				current: currentVersion,
				message: `This extension requires Quarto ${quartoRequired}, but you have version ${currentVersion}.`,
			};
		}
	} catch (error) {
		logMessage(`Error validating version requirement: ${getErrorMessage(error)}. Skipping validation.`, "warn");
		return {
			valid: true,
			required: quartoRequired,
			current: currentVersion,
			message: undefined,
		};
	}
}

/**
 * Clean a version string for semver comparison.
 * Removes leading 'v' and handles common variations.
 */
function cleanVersion(version: string): string {
	let cleaned = version.trim();

	// Remove leading 'v' or 'V'
	if (cleaned.toLowerCase().startsWith("v")) {
		cleaned = cleaned.slice(1);
	}

	// Coerce to valid semver if possible (handles "1.8" -> "1.8.0")
	const coerced = semver.coerce(cleaned);
	return coerced ? coerced.version : cleaned;
}
