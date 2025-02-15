import * as vscode from "vscode";
import { QUARTO_WIZARD_LOG, QUARTO_WIZARD_EXTENSIONS } from "../constants";
import { showLogsCommand } from "./log";
import { Credentials } from "./githubAuth";
import { generateHashKey } from "./hash";

export interface ExtensionInfo {
	id: string;
	name: string;
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

async function fetchExtensions(context: vscode.ExtensionContext): Promise<string[]> {
	const url = QUARTO_WIZARD_EXTENSIONS;
	const cacheKey = `${"quarto_wizard_extensions_csv_"}${generateHashKey(url)}`;
	const cachedData = context.globalState.get<{ data: string[]; timestamp: number }>(cacheKey);

	if (cachedData && Date.now() - cachedData.timestamp < 60 * 60 * 1000) {
		QUARTO_WIZARD_LOG.appendLine(`Using cached extensions: ${new Date(cachedData.timestamp).toISOString()}`);
		return cachedData.data;
	}

	QUARTO_WIZARD_LOG.appendLine(`Fetching extensions: ${url}`);
	let message = `Error fetching list of extensions from ${url}.`;
	try {
		const response: Response = await fetch(url);
		if (!response.ok) {
			message = `${message}. ${response.statusText}`;
			throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
		}
		const data = await response.text();
		const extensionsList = data.split("\n").filter((line: string) => line.trim() !== "");
		await context.globalState.update(cacheKey, { data: extensionsList, timestamp: Date.now() });
		return extensionsList;
	} catch (error) {
		QUARTO_WIZARD_LOG.appendLine(`${message} ${error}`);
		vscode.window.showErrorMessage(`${message}. ${showLogsCommand()}`);
		return [];
	}
}

function formatExtensionLabel(ext: string): string {
	const [owner, name, subDirectory] = ext.split("/");
	let extensionName = name
		.replace(/[-_]/g, " ")
		.replace(/quarto/gi, "")
		.trim();
	if (subDirectory !== undefined) {
		let extensionNameSubDirectory = subDirectory
			.replace(/[-_]/g, " ")
			.replace(/quarto/gi, "")
			.trim();
		if (extensionNameSubDirectory !== "") {
			extensionName = extensionNameSubDirectory;
		}
	}
	extensionName = extensionName
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
	return extensionName;
}

async function getExtensionInformation(
	context: vscode.ExtensionContext,
	ext: string,
	octokit: any
): Promise<ExtensionInfo | undefined> {
	const cacheKey = `${"quarto_wizard_extensions_infos_"}${generateHashKey(ext)}`;
	const cachedExtensionInformation = context.globalState.get<{ extensionInfo: ExtensionInfo; timestamp: number }>(
		cacheKey
	);

	if (cachedExtensionInformation && Date.now() - cachedExtensionInformation.timestamp < 60 * 60 * 1000) {
		QUARTO_WIZARD_LOG.appendLine(
			`Using cached information: ${ext} ${new Date(cachedExtensionInformation.timestamp).toISOString()}`
		);
		return cachedExtensionInformation.extensionInfo;
	}

	QUARTO_WIZARD_LOG.appendLine(`Fetching information: ${ext}`);
	let message = `Error fetching information for ${ext}.`;
	let extensionInfo: ExtensionInfo;
	try {
		const [owner, name] = ext.split("/");
		const repo = `${owner}/${name}`;
		const response = await octokit.request(`GET /repos/${repo}`);
		let version = "none";
		const releases = await octokit.request(`GET /repos/${repo}/releases`);
		const nonPreReleaseTags = releases.data.filter((tag: { prerelease: boolean }) => !tag.prerelease);
		if (nonPreReleaseTags.length > 0) {
			version = nonPreReleaseTags[0].tag_name.replace(/^v/, "");
		}
		extensionInfo = {
			id: ext,
			name: formatExtensionLabel(ext),
			full_name: repo,
			description: response.data.description ? response.data.description : "none",
			topics: response.data.topics.filter((topic: string) => !/quarto/i.test(topic)),
			stars: response.data.stargazers_count,
			license: response.data.license ? response.data.license.name : "none",
			size: response.data.size,
			html_url: response.data.html_url,
			homepage: response.data.homepage,
			version: version,
		};

		await context.globalState.update(cacheKey, { extensionInfo: extensionInfo, timestamp: Date.now() });
		return extensionInfo;
	} catch (error) {
		QUARTO_WIZARD_LOG.appendLine(`${message} ${error}`);
		vscode.window.showErrorMessage(`${message}. ${showLogsCommand()}`);
		return undefined;
	}
}

export async function getExtensionsInformation(context: vscode.ExtensionContext): Promise<ExtensionInfo[]> {
	const credentials = new Credentials();
	await credentials.initialise(context);
	const octokit = await credentials.getOctokit();

	const extensionsList = await fetchExtensions(context);
	// const extensionsList = ["mcanouil/quarto-iconify", "gadenbuie/countdown/quarto"];

	const extensions: ExtensionInfo[] = [];
	for (const ext of extensionsList) {
		const extensionInfo = await getExtensionInformation(context, ext, octokit);
		if (extensionInfo) {
			extensions.push(extensionInfo);
		}
	}

	return extensions;
}
