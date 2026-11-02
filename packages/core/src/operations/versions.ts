/**
 * @title Version Helpers Module
 * @description Version reads shared by the update check and the source change.
 *
 * @module operations
 */

import type { ExtensionId } from "../types/extension.js";
import { MANIFEST_FILENAMES, parseManifestContent } from "../filesystem/manifest.js";
import { normaliseVersion } from "../github/latest.js";
import { ManifestError, isCancellationError } from "../errors.js";

/**
 * Normalised version of a manifest, or null when the manifest cannot be
 * parsed or has no version.
 */
export function manifestVersion(content: string, sourcePath: string): string | null {
	try {
		return normaliseVersion(parseManifestContent(content, sourcePath).version);
	} catch (error) {
		if (error instanceof ManifestError) {
			return null;
		}
		throw error;
	}
}

/**
 * Paths where the manifest of a subdirectory source can be, in the order they are tried:
 * the subdirectory itself, then the folder of the installed extension under the
 * `_extensions` folder of the subdirectory, without and with its owner.
 */
export function subdirectoryManifestPaths(subdirectory: string, id: ExtensionId): string[] {
	const { owner, name } = id;
	const directories = [subdirectory, `${subdirectory}/_extensions/${name}`];
	if (owner) {
		directories.push(`${subdirectory}/_extensions/${owner}/${name}`);
	}
	return directories.flatMap((directory) => MANIFEST_FILENAMES.map((filename) => `${directory}/${filename}`));
}

/**
 * Normalised version in the manifest of a repository subdirectory at a ref,
 * or null when there is none or when it cannot be read.
 *
 * @param subdirectory - Repository subdirectory the extension was installed from
 * @param id - Identifier of the installed extension
 * @param readFile - Reads one repository file at the ref, resolving to null when it does not exist
 * @throws The cancellation error of a read that was cancelled
 */
export async function readSubdirectoryVersion(
	subdirectory: string,
	id: ExtensionId,
	readFile: (filePath: string) => Promise<string | null>,
): Promise<string | null> {
	// Raw file requests do not count against the API rate limit, so every path is asked at once.
	const filePaths = subdirectoryManifestPaths(subdirectory, id);
	const reads = await Promise.allSettled(filePaths.map((filePath) => readFile(filePath)));
	for (const read of reads) {
		if (read.status === "rejected" && isCancellationError(read.reason)) {
			throw read.reason;
		}
	}
	try {
		// The paths are in priority order, so a read that fails before the first manifest
		// found leaves the version unknown and a manifest of lower priority never decides.
		for (const [index, read] of reads.entries()) {
			if (read.status === "rejected") {
				throw read.reason;
			}
			if (read.value !== null) {
				return manifestVersion(read.value, filePaths[index]);
			}
		}
		return null;
	} catch {
		// The caller falls back to the recorded ref, so a failed read only loses precision.
		return null;
	}
}

const EXTRA_NUMERIC_PARTS_PATTERN = /^v?(\d+\.\d+\.\d+)(?:\.\d+)+$/;

/**
 * Version that an update must exceed when the installed version is not a
 * version, or null when there is none.
 *
 * A version with more than three numeric parts, such as the development build
 * "1.0.0.9000", is ahead of its first three parts, so a tag equal to them is
 * not newer. Any other installed version gives the version of the tag recorded
 * in the manifest source, so that an update never goes below that tag.
 *
 * @param installedVersion - Version in the installed manifest
 * @param recordedRef - Tag recorded in the manifest source, or null when there is none
 */
export function installedVersionFloor(installedVersion: string, recordedRef: string | null): string | null {
	const extended = EXTRA_NUMERIC_PARTS_PATTERN.exec(installedVersion.trim());
	if (extended) {
		return normaliseVersion(extended[1]);
	}
	return recordedRef === null ? null : normaliseVersion(recordedRef.replace(/^V/, "v"));
}
