/**
 * @title GitHub Raw Files Module
 * @description Reads single files of a repository from raw.githubusercontent.com.
 *
 * These requests do not count against the GitHub API rate limit.
 *
 * @module github
 */

import { getAuthHeaders } from "../types/auth.js";
import { NetworkError } from "../errors.js";
import { fetchText } from "../registry/http.js";
import type { GitHubOptions } from "./releases.js";

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

/**
 * Fetch one file of a repository at a ref.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param ref - Tag, branch, commit, or "HEAD" for the default branch
 * @param filePath - Path of the file from the repository root, with "/" separators
 * @param options - GitHub options
 * @returns File content, or null when the file does not exist at that ref
 * @throws NetworkError, RateLimitError or SamlSsoError when the request fails for another reason
 */
export async function fetchRawFile(
	owner: string,
	repo: string,
	ref: string,
	filePath: string,
	options: GitHubOptions = {},
): Promise<string | null> {
	const { auth, timeout, signal } = options;
	const segments = [owner, repo, ...ref.split("/"), ...filePath.split("/")].map(encodeURIComponent);
	const url = `${GITHUB_RAW_BASE}/${segments.join("/")}`;

	try {
		return await fetchText(url, { headers: getAuthHeaders(auth, true), timeout, retries: 2, signal });
	} catch (error) {
		if (error instanceof NetworkError && error.statusCode === 404) {
			return null;
		}
		throw error;
	}
}
