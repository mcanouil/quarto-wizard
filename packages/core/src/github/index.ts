/**
 * GitHub module exports.
 */

export {
	type GitHubRelease,
	type GitHubTag,
	type GitHubOptions,
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
