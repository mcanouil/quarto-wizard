import * as vscode from "vscode";
import { formatType } from "@quarto-wizard/schema";
import type { SchemaCache, ExtensionSchema, FieldDescriptor, DeprecatedSpec } from "@quarto-wizard/schema";
import { formatExtensionId, getExtensionTypes, type InstalledExtension, getErrorMessage } from "@quarto-wizard/core";
import { getYamlKeyPath, isInYamlRegion } from "../utils/yamlPosition";
import { logMessage } from "../utils/log";
import { getWorkspaceSchemaIndex } from "../utils/workspaceSchemaIndex";

/**
 * Provides hover information for Quarto extension options
 * defined in extension schema files.
 */
export class YamlHoverProvider implements vscode.HoverProvider {
	constructor(private schemaCache: SchemaCache) {}

	async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
		try {
			const lines = document.getText().split("\n");
			const languageId = document.languageId;

			if (!isInYamlRegion(lines, position.line, languageId)) {
				return null;
			}

			const keyPath = getYamlKeyPath(lines, position.line, languageId);
			if (keyPath.length === 0) {
				return null;
			}

			const line = lines[position.line];
			if (this.isCursorOnValue(line, position.character)) {
				// Structural hovers only apply to keys, not values.
				// Fall through to schema-based hover below.
			} else {
				// Hover on the "extensions" key itself.
				if (keyPath.length === 1 && keyPath[0] === "extensions") {
					return new vscode.Hover(new vscode.MarkdownString("Configure options for installed Quarto extensions."));
				}
			}

			const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
			if (!workspaceFolder) {
				return null;
			}

			const projectDir = workspaceFolder.uri.fsPath;
			const { schemaMap, extMap } = await getWorkspaceSchemaIndex(projectDir, this.schemaCache);
			const installedExtensions = Array.from(new Set(extMap.values()));

			// Hover on an extension name under "extensions:".
			if (keyPath.length === 2 && keyPath[0] === "extensions" && !this.isCursorOnValue(line, position.character)) {
				const extName = keyPath[1];
				const ext = this.findExtension(installedExtensions, extName);
				if (ext) {
					return new vscode.Hover(this.buildExtensionHover(ext));
				}
			}

			if (schemaMap.size === 0) {
				return null;
			}

			const descriptor = this.resolveDescriptor(keyPath, schemaMap);
			if (!descriptor) {
				return null;
			}

			const leafKey = keyPath[keyPath.length - 1];
			const isOnValue = this.isCursorOnValue(line, position.character);

			const markdown = this.buildHoverContent(leafKey, descriptor, isOnValue);
			return new vscode.Hover(markdown);
		} catch (error) {
			logMessage(`YAML hover error: ${getErrorMessage(error)}.`, "warn");
			return null;
		}
	}

	private resolveDescriptor(keyPath: string[], schemaMap: Map<string, ExtensionSchema>): FieldDescriptor | undefined {
		if (keyPath.length < 2) {
			return undefined;
		}

		const topKey = keyPath[0];

		if (topKey === "extensions" && keyPath.length >= 3) {
			const extName = keyPath[1];
			const schema = schemaMap.get(extName);
			if (!schema?.options) {
				return undefined;
			}
			return this.walkDescriptor(schema.options, keyPath.slice(2));
		}

		if (topKey === "format" && keyPath.length >= 3) {
			const formatName = keyPath[1];
			const formatFields = this.collectFormatFields(formatName, schemaMap);
			if (!formatFields) {
				return undefined;
			}
			return this.walkDescriptor(formatFields, keyPath.slice(2));
		}

		return undefined;
	}

	/**
	 * Find an installed extension by short name or full "owner/name" ID.
	 */
	private findExtension(extensions: InstalledExtension[], name: string): InstalledExtension | undefined {
		for (const ext of extensions) {
			if (ext.id.name === name || formatExtensionId(ext.id) === name) {
				return ext;
			}
		}
		return undefined;
	}

	/**
	 * Build a hover card for an extension name showing its manifest metadata.
	 */
	private buildExtensionHover(ext: InstalledExtension): vscode.MarkdownString {
		const md = new vscode.MarkdownString();

		const parts: string[] = [];

		const title = ext.manifest.title || ext.id.name;
		parts.push(`**${title}**`);

		const types = getExtensionTypes(ext.manifest);
		if (types.length > 0) {
			parts.push(`Provides: ${types.join(", ")}`);
		}

		const meta: string[] = [];
		if (ext.manifest.author) {
			meta.push(`**Author:** ${ext.manifest.author}`);
		}
		if (ext.manifest.version) {
			meta.push(`**Version:** ${ext.manifest.version}`);
		}
		if (meta.length > 0) {
			parts.push(meta.join("  \n"));
		}

		md.appendMarkdown(parts.join("\n\n"));
		return md;
	}

	private walkDescriptor(
		fields: Record<string, FieldDescriptor>,
		remainingPath: string[],
	): FieldDescriptor | undefined {
		if (remainingPath.length === 0) {
			return undefined;
		}

		const currentKey = remainingPath[0];
		const descriptor = this.findDescriptor(currentKey, fields);
		if (!descriptor) {
			return undefined;
		}

		if (remainingPath.length === 1) {
			return descriptor;
		}

		if (descriptor.properties) {
			return this.walkDescriptor(descriptor.properties, remainingPath.slice(1));
		}

		return undefined;
	}

	private findDescriptor(key: string, fields: Record<string, FieldDescriptor>): FieldDescriptor | undefined {
		if (fields[key]) {
			return fields[key];
		}

		for (const descriptor of Object.values(fields)) {
			if (descriptor.aliases?.includes(key)) {
				return descriptor;
			}
		}

		return undefined;
	}

	private collectFormatFields(
		formatName: string,
		schemaMap: Map<string, ExtensionSchema>,
	): Record<string, FieldDescriptor> | undefined {
		const merged: Record<string, FieldDescriptor> = {};
		let found = false;

		for (const schema of schemaMap.values()) {
			if (!schema.formats) {
				continue;
			}

			const formatFields = schema.formats[formatName];
			if (formatFields) {
				for (const [key, descriptor] of Object.entries(formatFields)) {
					if (!(key in merged)) {
						merged[key] = descriptor;
					}
				}
				found = true;
			}
		}

		return found ? merged : undefined;
	}

	/**
	 * Whether the cursor sits in the value portion (after the colon) of a YAML key line.
	 * Only meaningful on lines that contain a key-colon pair; colon-less lines
	 * (e.g. bare list items `- value`) return false.
	 */
	private isCursorOnValue(line: string, column: number): boolean {
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) {
			return false;
		}
		return column > colonIndex;
	}

	private buildHoverContent(key: string, descriptor: FieldDescriptor, isOnValue: boolean): vscode.MarkdownString {
		const md = new vscode.MarkdownString();

		const parts: string[] = [];

		if (isOnValue && descriptor.enum) {
			parts.push(`**\`${key}\`** — allowed values: ${descriptor.enum.map((v) => `\`${String(v)}\``).join(", ")}`);
		} else {
			parts.push(`**\`${key}\`**`);
		}

		if (descriptor.description) {
			parts.push(descriptor.description);
		}

		const details: string[] = [];
		if (descriptor.type) {
			details.push(`**Type:** \`${formatType(descriptor.type)}\``);
		}
		if (descriptor.required) {
			details.push("**Required:** yes");
		}
		if (descriptor.default !== undefined) {
			details.push(`**Default:** \`${String(descriptor.default)}\``);
		}
		if (descriptor.enum && !isOnValue) {
			details.push(`**Allowed values:** ${descriptor.enum.map((v) => `\`${String(v)}\``).join(", ")}`);
		}
		if (descriptor.const !== undefined) {
			details.push(`**Const:** \`${JSON.stringify(descriptor.const)}\``);
		}
		if (
			descriptor.min !== undefined ||
			descriptor.max !== undefined ||
			descriptor.exclusiveMinimum !== undefined ||
			descriptor.exclusiveMaximum !== undefined
		) {
			const rangeParts = [
				descriptor.min !== undefined ? `min: ${descriptor.min}` : "",
				descriptor.exclusiveMinimum !== undefined ? `exclusiveMin: ${descriptor.exclusiveMinimum}` : "",
				descriptor.max !== undefined ? `max: ${descriptor.max}` : "",
				descriptor.exclusiveMaximum !== undefined ? `exclusiveMax: ${descriptor.exclusiveMaximum}` : "",
			]
				.filter(Boolean)
				.join(", ");
			details.push(`**Range:** ${rangeParts}`);
		}
		if (descriptor.minItems !== undefined || descriptor.maxItems !== undefined) {
			const itemsParts = [
				descriptor.minItems !== undefined ? `min: ${descriptor.minItems}` : "",
				descriptor.maxItems !== undefined ? `max: ${descriptor.maxItems}` : "",
			]
				.filter(Boolean)
				.join(", ");
			details.push(`**Items:** ${itemsParts}`);
		}
		if (descriptor.pattern) {
			details.push(`**Pattern:** \`${descriptor.pattern}\``);
		}
		if (descriptor.aliases && descriptor.aliases.length > 0) {
			details.push(`**Aliases:** ${descriptor.aliases.map((a) => `\`${a}\``).join(", ")}`);
		}

		if (details.length > 0) {
			parts.push(details.join("  \n"));
		}

		if (descriptor.deprecated) {
			parts.push(this.formatDeprecation(descriptor.deprecated));
		}

		md.appendMarkdown(parts.join("\n\n---\n\n"));
		return md;
	}

	private formatDeprecation(deprecated: boolean | string | DeprecatedSpec): string {
		if (typeof deprecated === "boolean") {
			return "**Deprecated**";
		}
		if (typeof deprecated === "string") {
			return `**Deprecated:** ${deprecated}`;
		}

		const segments: string[] = ["**Deprecated**"];
		if (deprecated.since) {
			segments[0] += ` (since ${deprecated.since})`;
		}
		if (deprecated.message) {
			segments.push(deprecated.message);
		} else if (deprecated.replaceWith) {
			segments.push(`Use \`${deprecated.replaceWith}\` instead.`);
		}
		return segments.join(": ");
	}
}
