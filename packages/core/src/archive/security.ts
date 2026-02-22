/**
 * @title Archive Security Module
 * @description Shared security utilities for archive extraction.
 *
 * Provides path traversal detection and size formatting used by both
 * ZIP and TAR extractors.
 *
 * @module archive
 */

import * as path from "node:path";
import { SecurityError } from "../errors.js";

/** Default maximum extraction size: 100 MB. */
export const DEFAULT_MAX_SIZE = 100 * 1024 * 1024;

/** Maximum compression ratio allowed. */
export const MAX_COMPRESSION_RATIO = 100;

/** Maximum number of entries allowed in an archive. */
export const MAX_FILE_COUNT = 10_000;

/**
 * Check for path traversal attempts in archive entry paths.
 *
 * @param filePath - Entry path from the archive
 * @throws SecurityError if path traversal is detected
 */
export function checkPathTraversal(filePath: string): void {
	const normalised = path.normalize(filePath);

	if (path.isAbsolute(normalised)) {
		throw new SecurityError(`Path traversal detected in archive: "${filePath}"`);
	}

	const segments = normalised.split(path.sep);
	if (segments.some((segment) => segment === "..")) {
		throw new SecurityError(`Path traversal detected in archive: "${filePath}"`);
	}
}

/**
 * Validate that a URL uses an allowed protocol.
 *
 * Prevents SSRF by rejecting file://, ftp://, and other non-HTTP protocols.
 *
 * @param url - URL string to validate
 * @throws SecurityError if the protocol is not allowed
 */
export function validateUrlProtocol(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new SecurityError(`Invalid URL: "${url}"`);
	}

	const protocol = parsed.protocol.toLowerCase();
	if (protocol !== "https:") {
		throw new SecurityError(`Disallowed URL protocol "${protocol}" in "${url}". Only https: is permitted.`);
	}
}

/**
 * Format a byte count for display.
 *
 * @param bytes - Number of bytes
 * @returns Human-readable size string
 */
export function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
