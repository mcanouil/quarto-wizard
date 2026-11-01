/**
 * @title Manifest Parsing Module
 * @description Manifest parsing for _extension.yml files.
 *
 * Provides functions to read and parse Quarto extension manifests.
 *
 * @module filesystem
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { ExtensionManifest, RawManifest } from "../types/manifest.js";
import { normaliseManifest } from "../types/manifest.js";
import { ManifestError, getErrorMessage } from "../errors.js";

/** Supported manifest file names. */
export const MANIFEST_FILENAMES = ["_extension.yml", "_extension.yaml"] as const;

/**
 * Result of reading a manifest file.
 */
export interface ManifestReadResult {
	/** Parsed manifest data. */
	manifest: ExtensionManifest;
	/** Full path to the manifest file. */
	manifestPath: string;
	/** Filename used (e.g., "_extension.yml"). */
	filename: string;
}

/**
 * Find the manifest file in a directory.
 *
 * @param directory - Directory to search
 * @returns Path to manifest file or null if not found
 */
export function findManifestFile(directory: string): string | null {
	for (const filename of MANIFEST_FILENAMES) {
		const manifestPath = path.join(directory, filename);
		if (fs.existsSync(manifestPath)) {
			return manifestPath;
		}
	}
	return null;
}

/**
 * Read a manifest file as text.
 *
 * @param manifestPath - Full path to the manifest file
 * @returns File content
 * @throws ManifestError if the file cannot be read
 */
function readManifestContent(manifestPath: string): string {
	try {
		return fs.readFileSync(manifestPath, "utf-8");
	} catch (error) {
		throw new ManifestError(`Failed to read manifest file: ${getErrorMessage(error)}`, {
			manifestPath,
			cause: error,
		});
	}
}

/**
 * Parse a manifest file from a path.
 *
 * @param manifestPath - Full path to the manifest file
 * @returns Parsed manifest
 * @throws ManifestError if parsing fails
 */
export function parseManifestFile(manifestPath: string): ExtensionManifest {
	return parseManifestContent(readManifestContent(manifestPath), manifestPath);
}

/**
 * Parse manifest content from a YAML string.
 *
 * @param content - YAML content
 * @param sourcePath - Source path for error messages (optional)
 * @returns Parsed manifest
 * @throws ManifestError if parsing fails
 */
export function parseManifestContent(content: string, sourcePath?: string): ExtensionManifest {
	try {
		// js-yaml v5 throws on empty input; treat it as an empty document instead.
		const raw = (content.trim() === "" ? null : yaml.load(content)) as RawManifest;

		if (!raw || typeof raw !== "object") {
			throw new ManifestError("Manifest file is empty or invalid", { manifestPath: sourcePath });
		}

		return normaliseManifest(raw);
	} catch (error) {
		if (error instanceof ManifestError) {
			throw error;
		}
		throw new ManifestError(`Failed to parse manifest: ${getErrorMessage(error)}`, {
			manifestPath: sourcePath,
			cause: error,
		});
	}
}

/**
 * Read a manifest from a directory.
 *
 * @param directory - Directory containing the manifest
 * @returns ManifestReadResult or null if no manifest found
 */
export function readManifest(directory: string): ManifestReadResult | null {
	const manifestPath = findManifestFile(directory);

	if (!manifestPath) {
		return null;
	}

	const manifest = parseManifestFile(manifestPath);
	const filename = path.basename(manifestPath);

	return {
		manifest,
		manifestPath,
		filename,
	};
}

/**
 * Check if a directory contains a manifest file.
 *
 * @param directory - Directory to check
 * @returns True if manifest exists
 */
export function hasManifest(directory: string): boolean {
	return findManifestFile(directory) !== null;
}
