/**
 * GitHub module exports.
 */

export {
	type GitHubRelease,
	type GitHubTag,
	type GitHubOptions,
	type ResolvedVersion,
	type ResolveVersionOptions,
	fetchReleases,
	fetchTags,
	getLatestRelease,
	resolveVersion,
} from "./releases.js";

export {
	type DownloadProgressCallback,
	type DownloadOptions,
	type DownloadResult,
	downloadGitHubArchive,
	downloadArchive,
	downloadFromUrl,
} from "./download.js";
