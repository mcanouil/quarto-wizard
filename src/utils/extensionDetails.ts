import * as vscode from "vscode";
import { Octokit } from "@octokit/rest";
import {
	QW_LOG,
	QW_EXTENSIONS,
	QW_EXTENSIONS_CACHE,
	QW_EXTENSIONS_CACHE_TIME,
	QW_EXTENSION_DETAILS_CACHE,
	QW_EXTENSION_DETAILS_CACHE_TIME,
} from "../constants";
import { showLogsCommand } from "./log";
import { Credentials } from "./githubAuth";
import { generateHashKey } from "./hash";

export interface ExtensionDetails {
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
	const url = QW_EXTENSIONS;
	const cacheKey = `${QW_EXTENSIONS_CACHE}_${generateHashKey(url)}`;
	const cachedData = context.globalState.get<{ data: string[]; timestamp: number }>(cacheKey);

	if (cachedData && Date.now() - cachedData.timestamp < QW_EXTENSIONS_CACHE_TIME) {
		QW_LOG.appendLine(`Using cached extensions: ${new Date(cachedData.timestamp).toISOString()}`);
		return cachedData.data;
	}

	QW_LOG.appendLine(`Fetching extensions: ${url}`);
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
		QW_LOG.appendLine(`${message} ${error}`);
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

async function getExtensionDetails(
	context: vscode.ExtensionContext,
	ext: string,
	octokit: Octokit
): Promise<ExtensionDetails | undefined> {
	const cacheKey = `${QW_EXTENSION_DETAILS_CACHE}_${generateHashKey(ext)}`;
	const cachedExtensionDetails = context.globalState.get<{
		ExtensionDetails: ExtensionDetails;
		timestamp: number;
	}>(cacheKey);

	if (cachedExtensionDetails && Date.now() - cachedExtensionDetails.timestamp < QW_EXTENSION_DETAILS_CACHE_TIME) {
		QW_LOG.appendLine(`Using cached information: ${ext} ${new Date(cachedExtensionDetails.timestamp).toISOString()}`);
		return cachedExtensionDetails.ExtensionDetails;
	}

	QW_LOG.appendLine(`Fetching information: ${ext}`);
	let message = `Error fetching information for ${ext}.`;
	let ExtensionDetails: ExtensionDetails;
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
		ExtensionDetails = {
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

		await context.globalState.update(cacheKey, { ExtensionDetails: ExtensionDetails, timestamp: Date.now() });
		return ExtensionDetails;
	} catch (error) {
		QW_LOG.appendLine(`${message} ${error}`);
		vscode.window.showErrorMessage(`${message}. ${showLogsCommand()}`);
		return undefined;
	}
}

export async function getExtensionsDetails(context: vscode.ExtensionContext): Promise<ExtensionDetails[]> {
	const credentials = new Credentials();
	await credentials.initialise(context);
	const octokit = await credentials.getOctokit();

	const extensionsList = await fetchExtensions(context);

	const extensionsPromises = extensionsList.map((ext) => getExtensionDetails(context, ext, octokit));
	const extensions = await Promise.all(extensionsPromises);

	return extensions.filter((extension): extension is ExtensionDetails => extension !== undefined);
}
