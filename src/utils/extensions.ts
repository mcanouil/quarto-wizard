import * as vscode from "vscode";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { QUARTO_WIZARD_LOG, QUARTO_WIZARD_EXTENSIONS } from "../constants";
import { showLogsCommand } from "./log";

function generateHashKey(url: string): string {
	return crypto.createHash("md5").update(url).digest("hex");
}

export function getGitHubLink(extension: string): string {
	const [owner, repo] = extension.split("/").slice(0, 2);
	return `https://github.com/${owner}/${repo}`;
}

export function formatExtensionLabel(ext: string): string {
	const parts = ext.split("/");
	const repo = parts[1];
	let formattedRepo = repo.replace(/[-_]/g, " ");
	formattedRepo = formattedRepo.replace(/quarto/gi, "").trim();
	formattedRepo = formattedRepo
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
	return formattedRepo;
}

export async function fetchExtensions(url: string, context: vscode.ExtensionContext): Promise<string[]> {
	const cacheKey = `${"quarto_wizard_extensions_csv_"}${generateHashKey(url)}`;
	const cachedData = context.globalState.get<{ data: string[]; timestamp: number }>(cacheKey);

	if (cachedData && Date.now() - cachedData.timestamp < 12 * 60 * 60 * 1000) {
		QUARTO_WIZARD_LOG.appendLine(`Using cached extensions: ${cachedData.timestamp}`);
		return cachedData.data;
	} else {
		QUARTO_WIZARD_LOG.appendLine(`Fetching extensions: ${url}`);
	}

	let message = `Error fetching list of extensions from ${QUARTO_WIZARD_EXTENSIONS}.`;
	try {
		const response = await fetch(url);
		if (!response.ok) {
			message = `${message}. ${response.statusText}`;
			throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
		}
		const data = await response.text();
		const extensionsList = data.split("\n").filter((line) => line.trim() !== "");
		await context.globalState.update(cacheKey, { data: extensionsList, timestamp: Date.now() });
		const newCachedData = context.globalState.get<{ data: string[]; timestamp: number }>(cacheKey);
		return extensionsList;
	} catch (error) {
		QUARTO_WIZARD_LOG.appendLine(`${message} ${error}`);
		vscode.window.showErrorMessage(`${message}. ${showLogsCommand()}`);
		return [];
	}
}

function findQuartoExtensionsRecurse(dir: string): string[] {
	let results: string[] = [];
	const list = fs.readdirSync(dir);
	list.forEach((file) => {
		const filePath = path.join(dir, file);
		const stat = fs.statSync(filePath);
		if (stat && stat.isDirectory() && path.basename(filePath) !== "_extensions") {
			results = results.concat(findQuartoExtensionsRecurse(filePath));
		} else if (file.endsWith("_extension.yml") || file.endsWith("_extension.yaml")) {
			results.push(filePath);
		}
	});
	return results;
}

export function findQuartoExtensions(dir: string): string[] {
	return findQuartoExtensionsRecurse(dir).map((filePath) => path.relative(dir, path.dirname(filePath)));
}

export function getMtimeExtensions(dir: string): { [key: string]: Date } {
	if (!fs.existsSync(dir)) {
		return {};
	}
	const extensions = findQuartoExtensions(dir);
	const extensionsMtimeDict: { [key: string]: Date } = {};
	extensions.forEach((extension) => {
		extensionsMtimeDict[extension] = fs.statSync(path.join(dir, extension)).mtime;
	});
	return extensionsMtimeDict;
}

export function findModifiedExtensions(extensions: { [key: string]: Date }, dir: string): string[] {
	if (!fs.existsSync(dir)) {
		return [];
	}
	const modifiedExtensions: string[] = [];
	const currentExtensions = findQuartoExtensions(dir);
	currentExtensions.forEach((extension) => {
		const extensionPath = path.join(dir, extension);
		const extensionMtime = fs.statSync(extensionPath).mtime;
		if (!extensions[extension] || extensions[extension] < extensionMtime) {
			modifiedExtensions.push(extension);
		}
	});
	return modifiedExtensions;
}

export interface ExtensionData {
	title?: string;
	author?: string;
	version?: string;
	contributes?: string;
	source?: string;
}

function readYamlFile(filePath: string): ExtensionData | null {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	const fileContent = fs.readFileSync(filePath, "utf8");
	const data = yaml.load(fileContent) as any;
	return {
		title: data.title,
		author: data.author,
		version: data.version,
		contributes: Object.keys(data.contributes).join(", "),
		source: data.source,
	};
}

export function readExtensions(workspaceFolder: string, extensions: string[]): Record<string, ExtensionData> {
	const extensionsData: Record<string, ExtensionData> = {};
	for (const ext of extensions) {
		let filePath = path.join(workspaceFolder, "_extensions", ext, "_extension.yml");
		if (!fs.existsSync(filePath)) {
			filePath = path.join(workspaceFolder, "_extensions", ext, "_extension.yaml");
		}
		const extData = readYamlFile(filePath);
		if (extData) {
			extensionsData[ext] = extData;
		}
	}
	return extensionsData;
}
