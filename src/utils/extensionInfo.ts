import * as vscode from "vscode";
import { QUARTO_WIZARD_EXTENSIONS } from "../constants";
import { fetchExtensions } from "./extensions";

export interface ExtensionInfo {
	full_name: string; // "owner/repo"
	description: string;
	topics: string[];
	stars: number;
	license: string;
	size: number;
	html_url: string;
	homepage: string;
	version: string;
}

export async function getExtensionInfo(repo: string, context: vscode.ExtensionContext): Promise<ExtensionInfo[]> {
	const Octokit = (await import("@octokit/rest")).Octokit;
	const session = await vscode.authentication.getSession("github", [], { createIfNone: true });
	const octokit = new Octokit({ auth: session.accessToken });

	const extensionsList = await fetchExtensions(QUARTO_WIZARD_EXTENSIONS, context);

	const extensions: ExtensionInfo[] = [];
	for (const ext of extensionsList) {
		const [owner, name] = ext.split("/");
		if (owner === repo.split("/")[0] && name === repo.split("/")[1]) {
			const response = await octokit.request(`GET /repos/${repo}`);
			let version = "none";
			const releases = await octokit.request(`GET /repos/${repo}/releases`);
			const nonPreReleaseTags = releases.data.filter((tag: { prerelease: boolean }) => !tag.prerelease);
			if (nonPreReleaseTags.length > 0) {
				version = nonPreReleaseTags[0].tag_name.replace(/^v/, "");
			}

			extensions.push({
				full_name: repo,
				description: response.data.description ? response.data.description : "none",
				topics: response.data.topics.filter((topic: string) => !/quarto/i.test(topic)),
				stars: response.data.stargazers_count,
				license: response.data.license ? response.data.license.name : "none",
				size: response.data.size,
				html_url: response.data.html_url,
				homepage: response.data.homepage,
				version: version,
			});
		}
	}

	return extensions;
}
