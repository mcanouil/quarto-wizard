/**
 * @title SAML SSO Detection
 * @description Detects GitHub SAML SSO enforcement responses.
 *
 * GitHub signals that a token is blocked by organisation SAML SSO with
 * HTTP 403 and an `X-GitHub-SSO` header containing a `url=...` directive
 * pointing at the authorisation page the user must visit.
 *
 * The header comes from a remote server and must be treated as untrusted
 * input. This module:
 *   - only inspects 403 responses (SAML enforcement is strictly a 403),
 *   - parses the header with a boundary-anchored regex so that directives
 *     like `partial_results_url=...` cannot collide with `url=...`,
 *   - validates that the extracted URL is `https://github.com/...` before
 *     trusting it, rejecting anything else (javascript:, file:, phishing
 *     hostnames, ...).
 *
 * @module samlSso
 */

import { SamlSsoError } from "./errors.js";

const GITHUB_HOSTNAME = "github.com";

/**
 * Parse the `X-GitHub-SSO` header value and return the authorisation URL
 * if it is well-formed and points at `https://github.com`.
 */
function parseAuthorizationUrl(headerValue: string): string | undefined {
	// Anchor on start-of-string or a directive delimiter so that
	// `partial_results_url=https://evil; url=https://github.com/...` cannot
	// match the first `url=` inside `partial_results_url=`. Stop the capture
	// at whitespace or a directive delimiter so trailing `;`, `,` are not
	// swallowed into the URL.
	const match = /(?:^|[;\s,])url=([^\s;,]+)/.exec(headerValue);
	if (!match?.[1]) {
		return undefined;
	}

	let parsed: URL;
	try {
		parsed = new URL(match[1]);
	} catch {
		return undefined;
	}

	if (parsed.protocol !== "https:") {
		return undefined;
	}
	if (parsed.hostname !== GITHUB_HOSTNAME) {
		return undefined;
	}
	return parsed.toString();
}

/**
 * Detect a SAML SSO enforcement error from a non-ok HTTP response.
 *
 * Returns a {@link SamlSsoError} when the response is a 403 and the
 * `X-GitHub-SSO` header contains a trustworthy authorisation URL,
 * otherwise `undefined` so the caller can fall back to a plain
 * {@link import("./errors.js").NetworkError}.
 *
 * @param response - The failing HTTP response.
 * @param messagePrefix - Prefix for the error message (e.g. the caller
 *   context such as `"HTTP 403"` or `"Failed to download: HTTP 403"`).
 */
export function detectSamlSsoError(response: Response, messagePrefix: string): SamlSsoError | undefined {
	if (response.status !== 403) {
		return undefined;
	}
	const headerValue = response.headers.get("x-github-sso");
	if (!headerValue) {
		return undefined;
	}
	const authorizationUrl = parseAuthorizationUrl(headerValue);
	if (!authorizationUrl) {
		return undefined;
	}
	return new SamlSsoError(`${messagePrefix}: SAML SSO enforcement`, { authorizationUrl });
}
