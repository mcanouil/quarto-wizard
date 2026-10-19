import * as path from "node:path";
import type { AuthConfig } from "@quarto-wizard/core";
import * as auth from "../../utils/auth";
import * as extensionDetails from "../../utils/extensionDetails";

export const TREE_COMMANDS_ROOT = path.join(__dirname, "..", "..", "..", "src", "test", "fixtures", "treeCommands");

const REGISTRY_URL = "https://registry.test/extensions.json";
const GITHUB_REPOS = "https://api.github.com/repos/";

export interface FakeRepository {
	/** Tags that GitHub lists, as published. */
	githubTags?: string[];
	/** Tag that the registry advertises; the repository is absent from the registry when unset. */
	registryTag?: string;
	/** HTTP status of every GitHub request for this repository. */
	githubStatus?: number;
}

export interface UpdateBoundaryOptions {
	repositories: Record<string, FakeRepository>;
	token?: string;
	registryStatus?: number;
}

const authModule = auth as { getAuthConfig: typeof auth.getAuthConfig };
const detailsModule = extensionDetails as {
	getRegistryUrl: typeof extensionDetails.getRegistryUrl;
	getCacheTTL: typeof extensionDetails.getCacheTTL;
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function registryBody(repositories: Record<string, FakeRepository>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	for (const [fullName, repository] of Object.entries(repositories)) {
		if (repository.registryTag === undefined) {
			continue;
		}
		body[fullName] = {
			owner: fullName.split("/")[0],
			title: fullName,
			nameWithOwner: fullName,
			url: `https://github.com/${fullName}`,
			latestRelease: repository.registryTag,
			latestReleaseUrl: `https://github.com/${fullName}/releases/tag/${repository.registryTag}`,
		};
	}
	return body;
}

function githubResponse(fullName: string, endpoint: string, repository: FakeRepository | undefined): Response {
	if (repository?.githubStatus) {
		return json({ message: "Not Found" }, repository.githubStatus);
	}
	const tags = repository?.githubTags ?? [];
	const archive = (tag: string, kind: string) => `https://api.github.com/repos/${fullName}/${kind}/${tag}`;
	switch (endpoint) {
		case "tags":
			return json(
				tags.map((name) => ({
					name,
					commit: { sha: "0000000000000000000000000000000000000000" },
					zipball_url: archive(name, "zipball"),
					tarball_url: archive(name, "tarball"),
				})),
			);
		case "releases":
		case "commits":
			return json([]);
		default:
			return json({ message: "Not Found" }, 404);
	}
}

/**
 * Replaces the network and the settings that an update check reads, so that core runs its real rule
 * against the given repositories. Returns the function that restores the originals.
 */
export function stubUpdateBoundary(options: UpdateBoundaryOptions): () => void {
	const originalFetch = globalThis.fetch;
	const originalGetAuthConfig = auth.getAuthConfig;
	const originalGetRegistryUrl = extensionDetails.getRegistryUrl;
	const originalGetCacheTTL = extensionDetails.getCacheTTL;

	const authConfig: AuthConfig = { githubToken: options.token, httpHeaders: [] };
	authModule.getAuthConfig = async () => authConfig;
	detailsModule.getRegistryUrl = () => REGISTRY_URL;
	detailsModule.getCacheTTL = () => 0;

	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url === REGISTRY_URL) {
			return options.registryStatus
				? json({ message: "Unavailable" }, options.registryStatus)
				: json(registryBody(options.repositories));
		}
		if (url.startsWith(GITHUB_REPOS)) {
			const [owner, repo, endpoint] = new URL(url).pathname.split("/").slice(2);
			const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(repo)}`;
			return githubResponse(fullName, endpoint, options.repositories[fullName]);
		}
		throw new Error(`Unexpected request in an update test: ${url}`);
	}) as typeof globalThis.fetch;

	return () => {
		globalThis.fetch = originalFetch;
		authModule.getAuthConfig = originalGetAuthConfig;
		detailsModule.getRegistryUrl = originalGetRegistryUrl;
		detailsModule.getCacheTTL = originalGetCacheTTL;
	};
}
