/**
 * @title Manifest Parsing Module
 * @description Manifest parsing for _extension.yml files.
 *
 * Provides functions to read, parse, and write Quarto extension manifests.
 *
 * @module filesystem
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { ExtensionManifest, RawManifest, SourceType } from "../types/manifest.js";
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
		throw new ManifestError(`Failed to read manifest file: ${getErrorMessage(error)}`, {
			manifestPath,
			cause: error,
		});
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

/** A manifest line together with the line terminator that followed it. */
interface ManifestLine {
	/** Line content without its terminator. */
	text: string;
	/** Line terminator, empty for a final line with no trailing newline. */
	eol: string;
}

/**
 * Split content into lines, keeping each line's own terminator so that mixed
 * or non-native line endings survive a round trip.
 */
function splitLines(content: string): ManifestLine[] {
	return content.split(/(?<=\n)/).map((part) => {
		const match = /\r?\n$/.exec(part);
		return match ? { text: part.slice(0, match.index), eol: match[0] } : { text: part, eol: "" };
	});
}

function joinLines(lines: ManifestLine[]): string {
	return lines.map((line) => line.text + line.eol).join("");
}

/** Blank lines, comments, and directives carry no mapping content. */
function isIgnorableLine(text: string): boolean {
	const trimmed = text.trim();
	return trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("%");
}

function isDocumentStart(text: string): boolean {
	return text === "---" || text.startsWith("--- ") || text.startsWith("---\t");
}

function isDocumentEnd(text: string): boolean {
	return text === "..." || text.startsWith("... ") || text.startsWith("...\t");
}

/**
 * Serialise a scalar with js-yaml so that values needing quotes get them,
 * and plain values such as `owner/repo@v1.2.3` stay unquoted.
 */
function formatScalar(value: string): string {
	return yaml.dump(value, { lineWidth: -1 }).replace(/\n$/, "");
}

/**
 * Index of the first line of the first document's root mapping.
 * Skips leading comments, directives, and an opening document separator.
 */
function findRootStart(lines: ManifestLine[]): number {
	let index = 0;
	while (index < lines.length && isIgnorableLine(lines[index].text)) {
		index++;
	}
	if (index < lines.length && isDocumentStart(lines[index].text)) {
		index++;
		while (index < lines.length && isIgnorableLine(lines[index].text)) {
			index++;
		}
	}
	return index;
}

/**
 * Exclusive index of the end of the first document, so that a second document
 * in the same file is never patched.
 */
function findRootEnd(lines: ManifestLine[], start: number): number {
	for (let index = start; index < lines.length; index++) {
		const { text } = lines[index];
		if (isDocumentStart(text) || isDocumentEnd(text)) {
			return index;
		}
	}
	return lines.length;
}

/**
 * Exclusive index of the last line belonging to the value that starts at
 * `from`, covering block scalars and multi-line plain scalars.
 */
function findValueEnd(lines: ManifestLine[], from: number, end: number): number {
	let last = from;
	for (let index = from; index < end; index++) {
		const { text } = lines[index];
		if (text.trim() === "") {
			continue;
		}
		if (/^\s/.test(text)) {
			last = index + 1;
			continue;
		}
		break;
	}
	return last;
}

/**
 * Upsert a top-level scalar key, leaving every other byte of the document
 * untouched. A missing key is appended at the end of the first document; an
 * existing one is replaced where it stands.
 *
 * Zero indentation is a safe anchor for the key: nested mappings and block
 * scalar bodies must be indented past their parent, so a `source:` under
 * `contributes:` is never mistaken for the root key.
 *
 * @param content - Current manifest content
 * @param key - Top-level key to set
 * @param value - Scalar value to record
 * @param manifestPath - Manifest path, used for error reporting
 * @returns Updated manifest content
 * @throws ManifestError if the document root is a flow collection
 */
function setTopLevelScalar(content: string, key: string, value: string, manifestPath: string): string {
	const lines = splitLines(content);
	const start = findRootStart(lines);

	if (start < lines.length && /^[{[]/.test(lines[start].text)) {
		throw new ManifestError(
			`Cannot record "${key}": the manifest root is a flow collection, which requires a block mapping with one key per line.`,
			{ manifestPath },
		);
	}

	const end = findRootEnd(lines, start);
	const defaultEol = lines.find((line) => line.eol !== "")?.eol ?? "\n";
	const newText = `${key}: ${formatScalar(value)}`;
	const keyPattern = new RegExp(`^${key}\\s*:(\\s|$)`);
	const keyIndex = lines.findIndex((line, index) => index >= start && index < end && keyPattern.test(line.text));

	if (keyIndex !== -1) {
		const valueEnd = findValueEnd(lines, keyIndex + 1, end);
		lines.splice(keyIndex, valueEnd - keyIndex, { text: newText, eol: lines[keyIndex].eol || defaultEol });
		return joinLines(lines);
	}

	const previous = end > 0 ? lines[end - 1] : undefined;
	if (previous && previous.text === "" && previous.eol === "") {
		lines.splice(end - 1, 1, { text: newText, eol: defaultEol });
		return joinLines(lines);
	}
	if (previous && previous.eol === "") {
		previous.eol = defaultEol;
	}
	lines.splice(end, 0, { text: newText, eol: defaultEol });
	return joinLines(lines);
}

/**
 * Record the source of an installed extension in its manifest.
 *
 * Patches the `source` and `source-type` lines in place instead of
 * re-serialising the document, so comments, key order, quoting style, and any
 * keys the extension author added are preserved. A file without a trailing
 * newline gains one when a key is appended.
 *
 * @param manifestPath - Path to the manifest file
 * @param source - New source value
 * @param sourceType - Type of source (github, url, local, registry)
 * @throws ManifestError if the manifest cannot be read or patched
 */
export function updateManifestSource(manifestPath: string, source: string, sourceType?: SourceType): void {
	let content: string;
	try {
		content = fs.readFileSync(manifestPath, "utf-8");
	} catch (error) {
		throw new ManifestError(`Failed to read manifest file: ${getErrorMessage(error)}`, {
			manifestPath,
			cause: error,
		});
	}

	let updated = setTopLevelScalar(content, "source", source, manifestPath);
	if (sourceType) {
		updated = setTopLevelScalar(updated, "source-type", sourceType, manifestPath);
	}

	fs.writeFileSync(manifestPath, updated, "utf-8");
}
