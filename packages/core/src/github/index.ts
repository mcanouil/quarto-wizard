/**
 * GitHub module exports.
 */

export {
	type GitHubRelease,
	type GitHubTag,
	type GitHubOptions,
	fetchReleases,
	fetchTags,
	fetchLatestCommit,
	getLatestRelease,
} from "./releases.js";

export { type ResolvedVersion, type ResolveVersionOptions, resolveVersion } from "./resolve.js";

export { type LatestTag, type ResolveLatestTagOptions, normaliseVersion, resolveLatestTag } from "./latest.js";

export {
	type DownloadProgressCallback,
	type DownloadOptions,
	type DownloadResult,
	downloadGitHubArchive,
	downloadArchive,
	downloadFromUrl,
} from "./download.js";
