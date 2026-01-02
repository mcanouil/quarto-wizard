/**
 * @description Manifest parsing for _extension.yml files.
 *
 * Provides functions to read, parse, and write Quarto extension manifests.
 *
 * @module filesystem
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { ExtensionManifest, RawManifest } from "../types/manifest.js";
import { normaliseManifest } from "../types/manifest.js";
import { ManifestError } from "../errors.js";

/** Supported manifest file names. */
const MANIFEST_FILENAMES = ["_extension.yml", "_extension.yaml"] as const;

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
 * Parse a manifest file from a path.
 *
 * @param manifestPath - Full path to the manifest file
 * @returns Parsed manifest
 * @throws ManifestError if parsing fails
 */
export function parseManifestFile(manifestPath: string): ExtensionManifest {
	try {
		const content = fs.readFileSync(manifestPath, "utf-8");
		return parseManifestContent(content, manifestPath);
	} catch (error) {
		if (error instanceof ManifestError) {
			throw error;
		}
		throw new ManifestError(
			`Failed to read manifest file: ${error instanceof Error ? error.message : String(error)}`,
			manifestPath,
		);
	}
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
		const raw = yaml.load(content) as RawManifest;

		if (!raw || typeof raw !== "object") {
			throw new ManifestError("Manifest file is empty or invalid", sourcePath);
		}

		return normaliseManifest(raw);
	} catch (error) {
		if (error instanceof ManifestError) {
			throw error;
		}
		throw new ManifestError(
			`Failed to parse manifest: ${error instanceof Error ? error.message : String(error)}`,
			sourcePath,
		);
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

/**
 * Write a manifest to a file.
 *
 * @param manifestPath - Path to write the manifest
 * @param manifest - Manifest data to write
 */
export function writeManifest(manifestPath: string, manifest: ExtensionManifest): void {
	const raw: RawManifest = {
		title: manifest.title,
		author: manifest.author,
		version: manifest.version,
	};

	if (manifest.quartoRequired) {
		raw["quarto-required"] = manifest.quartoRequired;
	}

	if (manifest.source) {
		raw.source = manifest.source;
	}

	const contributes: RawManifest["contributes"] = {};
	if (manifest.contributes.filter?.length) {
		contributes.filters = manifest.contributes.filter;
	}
	if (manifest.contributes.shortcode?.length) {
		contributes.shortcodes = manifest.contributes.shortcode;
	}
	if (manifest.contributes.format && Object.keys(manifest.contributes.format).length) {
		contributes.formats = manifest.contributes.format;
	}
	if (manifest.contributes.project) {
		contributes.project = manifest.contributes.project;
	}
	if (manifest.contributes.revealjsPlugin?.length) {
		contributes["revealjs-plugins"] = manifest.contributes.revealjsPlugin;
	}
	if (manifest.contributes.metadata) {
		contributes.metadata = manifest.contributes.metadata;
	}

	if (Object.keys(contributes).length > 0) {
		raw.contributes = contributes;
	}

	const content = yaml.dump(raw, {
		indent: 2,
		lineWidth: 120,
		noRefs: true,
		sortKeys: false,
	});

	fs.writeFileSync(manifestPath, content, "utf-8");
}

/**
 * Update the source field in an existing manifest file.
 *
 * @param manifestPath - Path to the manifest file
 * @param source - New source value
 */
export function updateManifestSource(manifestPath: string, source: string): void {
	const manifest = parseManifestFile(manifestPath);
	manifest.source = source;
	writeManifest(manifestPath, manifest);
}
