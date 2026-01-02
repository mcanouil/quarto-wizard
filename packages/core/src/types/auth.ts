/**
 * @title Auth
 * @description Authentication configuration types.
 *
 * Quarto Wizard supports GitHub authentication via environment variables.
 * This is useful for accessing private repositories or increasing API rate limits.
 *
 * @module auth
 *
 * @envvar GITHUB_TOKEN - GitHub personal access token for API authentication.
 * @envvar QUARTO_WIZARD_TOKEN - Alternative token variable (fallback if GITHUB_TOKEN is not set).
 *
 * GITHUB_TOKEN takes precedence over QUARTO_WIZARD_TOKEN if both are set.
 *
 * @example Setting GitHub token for private repository access
 * ```bash
 * export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * ```
 *
 * @example Using the alternative token variable
 * ```bash
 * export QUARTO_WIZARD_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * ```
 *
 * @note Tokens can also be set via VS Code settings or the extension's authentication UI.
 */

/**
 * HTTP header for custom authentication.
 */
export interface HttpHeader {
	/** Header name (e.g., "Authorization"). */
	name: string;
	/** Header value (e.g., "Bearer token123"). */
	value: string;
}

/**
 * Authentication configuration for API requests.
 */
export interface AuthConfig {
	/** GitHub personal access token for GitHub API and private repos. */
	githubToken?: string;
	/** Custom HTTP headers for URL downloads. */
	httpHeaders: HttpHeader[];
}

/**
 * Options for creating an AuthConfig.
 */
export interface AuthConfigOptions {
	/** GitHub personal access token. */
	githubToken?: string;
	/** HTTP headers in "Name: Value" format. */
	httpHeaders?: string[];
}

/**
 * Create an AuthConfig from options.
 * Automatically reads from environment variables if not provided.
 *
 * @param options - Configuration options
 * @returns AuthConfig object
 * @throws Error if header format is invalid
 */
export function createAuthConfig(options: AuthConfigOptions = {}): AuthConfig {
	const headers: HttpHeader[] = [];

	for (const header of options.httpHeaders ?? []) {
		const colonIndex = header.indexOf(":");

		if (colonIndex === -1) {
			throw new Error(`Invalid header format: "${header}". Expected "Name: Value".`);
		}

		headers.push({
			name: header.substring(0, colonIndex).trim(),
			value: header.substring(colonIndex + 1).trim(),
		});
	}

	const githubToken = options.githubToken ?? process.env["GITHUB_TOKEN"] ?? process.env["QUARTO_WIZARD_TOKEN"];

	return {
		githubToken,
		httpHeaders: headers,
	};
}

/**
 * Get authorization headers for a request.
 *
 * @param auth - Authentication configuration
 * @param isGitHub - Whether this is a GitHub API request
 * @returns Headers object for fetch
 */
export function getAuthHeaders(auth: AuthConfig | undefined, isGitHub: boolean): Record<string, string> {
	const headers: Record<string, string> = {};

	if (isGitHub && auth?.githubToken) {
		headers["Authorization"] = `Bearer ${auth.githubToken}`;
	}

	if (auth?.httpHeaders) {
		for (const header of auth.httpHeaders) {
			headers[header.name] = header.value;
		}
	}

	return headers;
}
