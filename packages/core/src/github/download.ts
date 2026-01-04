/**
 * @title GitHub Download Module
 * @description GitHub archive download functionality.
 *
 * Handles downloading release archives from GitHub repositories.
 *
 * @module github
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AuthConfig } from "../types/auth.js";
import type { VersionSpec } from "../types/extension.js";
import { getAuthHeaders } from "../types/auth.js";
import { NetworkError } from "../errors.js";
import { proxyFetch } from "../proxy/index.js";
import { resolveVersion, type ResolveVersionOptions } from "./releases.js";

/**
 * Progress callback for downloads.
 */
export type DownloadProgressCallback = (progress: {
	phase: "resolving" | "downloading";
	message: string;
	bytesDownloaded?: number;
	totalBytes?: number;
	percentage?: number;
}) => void;

/**
 * Options for downloading archives.
 */
export interface DownloadOptions extends ResolveVersionOptions {
	/** Preferred archive format. */
	format?: "zip" | "tarball";
	/** Progress callback. */
	onProgress?: DownloadProgressCallback;
	/** Custom download directory (uses temp by default). */
	downloadDir?: string;
}

/**
 * Result of a download operation.
 */
export interface DownloadResult {
	/** Path to the downloaded archive. */
	archivePath: string;
	/** Resolved tag/version name. */
	tagName: string;
	/** Archive format. */
	format: "zip" | "tarball";
	/** Commit SHA if resolved to a commit (first 7 characters). */
	commitSha?: string;
}

/**
 * Download an archive from GitHub.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param version - Version specification
 * @param options - Download options
 * @returns Download result
 */
export async function downloadGitHubArchive(
	owner: string,
	repo: string,
	version: VersionSpec,
	options: DownloadOptions = {},
): Promise<DownloadResult> {
	const { auth, timeout = 60000, format = "zip", onProgress, downloadDir, defaultBranch, latestCommit } = options;

	onProgress?.({
		phase: "resolving",
		message: `Resolving version for ${owner}/${repo}...`,
	});

	const resolved = await resolveVersion(owner, repo, version, { auth, timeout, defaultBranch, latestCommit });

	const downloadUrl = format === "zip" ? resolved.zipballUrl : resolved.tarballUrl;
	const extension = format === "zip" ? ".zip" : ".tar.gz";

	onProgress?.({
		phase: "downloading",
		message: `Downloading ${owner}/${repo}@${resolved.tagName}...`,
	});

	const archivePath = await downloadArchive(downloadUrl, {
		auth,
		timeout,
		extension,
		downloadDir,
		onProgress,
	});

	return {
		archivePath,
		tagName: resolved.tagName,
		format,
		commitSha: resolved.commitSha,
	};
}

/**
 * Download an archive from a URL.
 *
 * @param url - URL to download
 * @param options - Download options
 * @returns Path to downloaded file
 */
export async function downloadArchive(
	url: string,
	options: {
		auth?: AuthConfig;
		timeout?: number;
		extension?: string;
		downloadDir?: string;
		onProgress?: DownloadProgressCallback;
	} = {},
): Promise<string> {
	const { auth, timeout = 60000, extension = ".zip", downloadDir, onProgress } = options;

	let githubLikeHost = false;
	try {
		const parsedUrl = new URL(url);
		const hostname = parsedUrl.hostname.toLowerCase();
		githubLikeHost = hostname === "github.com" || hostname === "api.github.com";
	} catch {
		// If the URL is invalid, fall back to treating it as a non-GitHub host.
		githubLikeHost = false;
	}

	const headers: Record<string, string> = {
		"User-Agent": "quarto-wizard",
		...getAuthHeaders(auth, githubLikeHost),
	};

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await proxyFetch(url, {
			headers,
			redirect: "follow",
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new NetworkError(`Failed to download: HTTP ${response.status}`, { statusCode: response.status });
		}

		const contentLength = response.headers.get("content-length");
		const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;

		const dir = downloadDir ?? os.tmpdir();
		const filename = `quarto-ext-${Date.now()}${extension}`;
		const archivePath = path.join(dir, filename);

		const fileStream = fs.createWriteStream(archivePath);

		if (!response.body) {
			throw new NetworkError("No response body received");
		}

		const reader = response.body.getReader();
		let bytesDownloaded = 0;

		try {
			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				fileStream.write(Buffer.from(value));
				bytesDownloaded += value.length;

				if (onProgress) {
					const percentage = totalBytes ? Math.round((bytesDownloaded / totalBytes) * 100) : undefined;

					onProgress({
						phase: "downloading",
						message: `Downloading... ${formatBytes(bytesDownloaded)}`,
						bytesDownloaded,
						totalBytes,
						percentage,
					});
				}
			}
		} finally {
			fileStream.end();
		}

		await new Promise<void>((resolve, reject) => {
			fileStream.on("finish", resolve);
			fileStream.on("error", reject);
		});

		return archivePath;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new NetworkError(`Download timed out after ${timeout}ms`, { cause: error });
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Download from a custom URL (non-GitHub).
 *
 * @param url - URL to download
 * @param options - Download options
 * @returns Path to downloaded file
 */
export async function downloadFromUrl(
	url: string,
	options: {
		auth?: AuthConfig;
		timeout?: number;
		downloadDir?: string;
		onProgress?: DownloadProgressCallback;
	} = {},
): Promise<string> {
	const extension = getExtensionFromUrl(url);

	return downloadArchive(url, {
		...options,
		extension,
	});
}

/**
 * Get file extension from URL.
 */
function getExtensionFromUrl(url: string): string {
	const pathname = new URL(url).pathname;

	if (pathname.endsWith(".tar.gz") || pathname.endsWith(".tgz")) {
		return ".tar.gz";
	}

	if (pathname.endsWith(".zip")) {
		return ".zip";
	}

	return ".zip";
}

/**
 * Format bytes for display.
 */
function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
