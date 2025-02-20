import * as vscode from "vscode";
import { Octokit } from "@octokit/rest";
import {
	QW_EXTENSIONS,
	QW_EXTENSIONS_CACHE,
	QW_EXTENSIONS_CACHE_TIME,
	QW_EXTENSION_DETAILS_CACHE,
	QW_EXTENSION_DETAILS_CACHE_TIME,
} from "../constants";
import { logMessage } from "./log";
import { Credentials } from "./githubAuth";
import { generateHashKey } from "./hash";

/**
 * Interface representing the details of a Quarto extension.
 */
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

/**
 * Fetches the list of Quarto extensions.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @returns {Promise<string[]>} - A promise that resolves to an array of extension names.
 */
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
		return [];
	}
}

/**
 * Formats the label of a Quarto extension.
 * @param {string} extension - The extension name.
 * @returns {string} - The formatted extension label.
 */
function formatExtensionLabel(extension: string): string {
	const [, name, subDirectory] = extension.split("/");
	let extensionName = name
		.replace(/[-_]/g, " ")
		.replace(/quarto/gi, "")
		.trim();
	if (subDirectory !== undefined) {
		const extensionNameSubDirectory = subDirectory
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

/**
 * Fetches the details of a Quarto extension.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @param {string} extension - The extension name.
 * @param {Octokit} octokit - The Octokit instance.
 * @returns {Promise<ExtensionDetails | undefined>} - A promise that resolves to the extension details or undefined if an error occurs.
 */
async function getExtensionDetails(
	context: vscode.ExtensionContext,
	extension: string,
	octokit: Octokit
): Promise<ExtensionDetails | undefined> {
	const cacheKey = `${QW_EXTENSION_DETAILS_CACHE}_${generateHashKey(extension)}`;
	const cachedExtensionDetails = context.globalState.get<{
		ExtensionDetails: ExtensionDetails;
		timestamp: number;
	}>(cacheKey);

	if (cachedExtensionDetails && Date.now() - cachedExtensionDetails.timestamp < QW_EXTENSION_DETAILS_CACHE_TIME) {
		logMessage(
			`Using cached details: ${extension} ${new Date(cachedExtensionDetails.timestamp).toISOString()}`,
			"debug"
		);
		return cachedExtensionDetails.ExtensionDetails;
	}

	logMessage(`Fetching details: ${extension}`, "debug");
	const message = `Error fetching details for ${extension}.`;
	let ExtensionDetails: ExtensionDetails;
	try {
		const [owner, name] = extension.split("/");
		const repo = `${owner}/${name}`;
		const response = await octokit.request(`GET /repos/${repo}`);
		let tagName = "none";
		const releases = await octokit.request(`GET /repos/${repo}/releases`);
		const nonPreReleaseTags = releases.data.filter((tag: { prerelease: boolean }) => !tag.prerelease);
		if (nonPreReleaseTags.length > 0) {
			tagName = nonPreReleaseTags[0].tag_name;
		}
		ExtensionDetails = {
			id: extension,
			name: formatExtensionLabel(extension),
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
		return undefined;
	}
}

/**
 * Fetches the details of all Quarto extensions.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @returns {Promise<ExtensionDetails[]>} - A promise that resolves to an array of extension details.
 */
export async function getExtensionsDetails(context: vscode.ExtensionContext): Promise<ExtensionDetails[]> {
	const credentials = new Credentials();
	await credentials.initialise(context);
	const octokit = await credentials.getOctokit();

	const extensionsList = await fetchExtensions(context);

	const extensionsPromises = extensionsList.map((ext) => getExtensionDetails(context, ext, octokit));
	const extensions = await Promise.all(extensionsPromises);

	return extensions.filter((extension): extension is ExtensionDetails => extension !== undefined);
}
