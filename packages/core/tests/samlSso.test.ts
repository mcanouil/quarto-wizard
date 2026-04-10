import { describe, it, expect } from "vitest";
import { detectSamlSsoError } from "../src/samlSso.js";
import { SamlSsoError } from "../src/errors.js";

function makeResponse(status: number, headers: Record<string, string> = {}): Response {
	return new Response(null, { status, headers });
}

describe("detectSamlSsoError", () => {
	const VALID_URL = "https://github.com/orgs/myorg/sso?authorization_request=abc";

	it("returns a SamlSsoError for a 403 with a valid X-GitHub-SSO header", () => {
		const response = makeResponse(403, { "x-github-sso": `required; url=${VALID_URL}` });
		const error = detectSamlSsoError(response, "HTTP 403");

		expect(error).toBeInstanceOf(SamlSsoError);
		expect(error?.authorizationUrl).toBe(VALID_URL);
		expect(error?.statusCode).toBe(403);
	});

	it("returns undefined for a non-403 status even with SAML header", () => {
		const response = makeResponse(500, { "x-github-sso": `required; url=${VALID_URL}` });
		expect(detectSamlSsoError(response, "HTTP 500")).toBeUndefined();
	});

	it("returns undefined for a 404 with SAML header", () => {
		const response = makeResponse(404, { "x-github-sso": `required; url=${VALID_URL}` });
		expect(detectSamlSsoError(response, "HTTP 404")).toBeUndefined();
	});

	it("returns undefined for a 403 without the SAML header", () => {
		const response = makeResponse(403);
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	it("returns undefined when the header has no url directive", () => {
		const response = makeResponse(403, { "x-github-sso": "required" });
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	// Substring-collision attack: a directive whose name ends in `url=` must not
	// be confused with the `url=` directive itself.
	it("does not match url= inside another directive name", () => {
		const header = "required; partial_results_url=https://evil.example/bad; url=" + VALID_URL;
		const response = makeResponse(403, { "x-github-sso": header });
		const error = detectSamlSsoError(response, "HTTP 403");

		expect(error).toBeInstanceOf(SamlSsoError);
		expect(error?.authorizationUrl).toBe(VALID_URL);
	});

	// If only the attacker-controlled directive is present, there is no genuine
	// url= directive and we must fall through to a plain NetworkError.
	it("returns undefined when only a colliding directive is present", () => {
		const response = makeResponse(403, {
			"x-github-sso": "required; partial_results_url=https://evil.example/bad",
		});
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	it("rejects javascript: URLs", () => {
		const response = makeResponse(403, { "x-github-sso": "required; url=javascript:alert(1)" });
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	it("rejects file: URLs", () => {
		const response = makeResponse(403, { "x-github-sso": "required; url=file:///etc/passwd" });
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	it("rejects http: URLs (scheme must be https)", () => {
		const response = makeResponse(403, {
			"x-github-sso": "required; url=http://github.com/orgs/myorg/sso?authorization_request=abc",
		});
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	it("rejects non-github.com hosts", () => {
		const response = makeResponse(403, {
			"x-github-sso": "required; url=https://evil.example/orgs/myorg/sso?authorization_request=abc",
		});
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	// Subdomain confusion: an attacker hostname with github.com as a suffix must
	// not be accepted. The hostname check is exact equality, not endsWith.
	it("rejects evil.github.com.attacker.example", () => {
		const response = makeResponse(403, {
			"x-github-sso": "required; url=https://github.com.attacker.example/orgs/myorg/sso",
		});
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	it("rejects api.github.com (not the authorisation origin)", () => {
		const response = makeResponse(403, {
			"x-github-sso": "required; url=https://api.github.com/orgs/myorg/sso",
		});
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	it("rejects malformed URLs", () => {
		const response = makeResponse(403, { "x-github-sso": "required; url=not a url" });
		expect(detectSamlSsoError(response, "HTTP 403")).toBeUndefined();
	});

	it("does not include trailing delimiters in the captured URL", () => {
		const response = makeResponse(403, {
			"x-github-sso": `required; url=${VALID_URL}; extra=ignored`,
		});
		const error = detectSamlSsoError(response, "HTTP 403");

		expect(error).toBeInstanceOf(SamlSsoError);
		expect(error?.authorizationUrl).toBe(VALID_URL);
	});

	it("builds an error message prefixed with the provided context", () => {
		const response = makeResponse(403, { "x-github-sso": `required; url=${VALID_URL}` });
		const error = detectSamlSsoError(response, "Failed to download: HTTP 403");
		expect(error?.message).toBe("Failed to download: HTTP 403: SAML SSO enforcement");
	});
});
