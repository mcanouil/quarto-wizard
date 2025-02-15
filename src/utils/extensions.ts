import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

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
