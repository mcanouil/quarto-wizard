import * as vscode from "vscode";
import { Octokit } from "@octokit/rest";
import {
	QW_EXTENSIONS,
	QW_EXTENSIONS_CACHE,
	QW_EXTENSIONS_CACHE_TIME,
	QW_EXTENSION_DETAILS_CACHE,
	QW_EXTENSION_DETAILS_CACHE_TIME,
} from "../constants";
import { showLogsCommand, logMessage } from "./log";
import { Credentials } from "./githubAuth";
import { generateHashKey } from "./hash";

export interface ExtensionDetails {
	id: string;
	name: string;
	full_name: string; // "owner/repo"
	owner: string;
	description: string;
	topics: string[];
	stars: number;
	license: string;
	size: number;
	html_url: string;
	homepage: string;
	version: string;
	tag: string;
}

async function fetchExtensions(context: vscode.ExtensionContext): Promise<string[]> {
	const url = QW_EXTENSIONS;
	const cacheKey = `${QW_EXTENSIONS_CACHE}_${generateHashKey(url)}`;
	const cachedData = context.globalState.get<{ data: string[]; timestamp: number }>(cacheKey);

	if (cachedData && Date.now() - cachedData.timestamp < QW_EXTENSIONS_CACHE_TIME) {
		logMessage(`Using cached extensions: ${new Date(cachedData.timestamp).toISOString()}`, "debug");
		return cachedData.data;
	}

	logMessage(`Fetching extensions: ${url}`, "debug");
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
		logMessage(`${message} ${error}`, "error");
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
		logMessage(`Using cached details: ${ext} ${new Date(cachedExtensionDetails.timestamp).toISOString()}`, "debug");
		return cachedExtensionDetails.ExtensionDetails;
	}

	logMessage(`Fetching details: ${ext}`, "debug");
	let message = `Error fetching details for ${ext}.`;
	let ExtensionDetails: ExtensionDetails;
	try {
		const [owner, name] = ext.split("/");
		const repo = `${owner}/${name}`;
		const response = await octokit.request(`GET /repos/${repo}`);
		let tagName = "none";
		const releases = await octokit.request(`GET /repos/${repo}/releases`);
		const nonPreReleaseTags = releases.data.filter((tag: { prerelease: boolean }) => !tag.prerelease);
		if (nonPreReleaseTags.length > 0) {
			tagName = nonPreReleaseTags[0].tag_name;
		}
		ExtensionDetails = {
			id: ext,
			name: formatExtensionLabel(ext),
			full_name: repo,
			owner: owner,
			description: response.data.description ? response.data.description : "none",
			topics: response.data.topics.filter((topic: string) => !/quarto/i.test(topic)),
			stars: response.data.stargazers_count,
			license: response.data.license ? response.data.license.name : "none",
			size: response.data.size,
			html_url: response.data.html_url,
			homepage: response.data.homepage,
			version: tagName.replace(/^v/, ""),
			tag: tagName,
		};

		await context.globalState.update(cacheKey, { ExtensionDetails: ExtensionDetails, timestamp: Date.now() });
		return ExtensionDetails;
	} catch (error) {
		logMessage(`${message} ${error}`, "error");
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
