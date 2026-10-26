import type { FieldDescriptor } from "@quarto-wizard/schema";
import { findDeclaredName } from "../utils/fieldLookup";

/**
 * Which category of group key matched the element.
 * - `classOrId`: a class or ID-prefix group (e.g. `"modal"`, `"panel"`).
 * - `elementType`: a Pandoc element-type group (`Div`, `Span`, `Code`, `Header`, `CodeBlock`).
 * - `any`: the catch-all `_any` group.
 */
export type GroupOrigin = "classOrId" | "elementType" | "any";

/**
 * The declaration of one field by one extension.
 * `sourceId` identifies the extension, so one installed in several project roots counts once.
 */
export interface AttributeDeclaration {
	descriptor: FieldDescriptor;
	source: string;
	sourceId: string;
	groupOrigin: GroupOrigin;
}

/**
 * The applicable fields of one extension, after the most specific of its own groups won.
 * `origins` gives the group category that each field came from.
 */
export interface ExtensionDeclarations {
	source: string;
	sourceId: string;
	descriptors: Record<string, FieldDescriptor>;
	origins: Record<string, GroupOrigin>;
}

/**
 * The applicable fields of every extension.
 * `byName` maps a declared name to one declaration per extension, and both lists keep the discovery order.
 */
export interface ApplicableDeclarations {
	byName: Record<string, AttributeDeclaration[]>;
	byExtension: ExtensionDeclarations[];
}

function declarationOf(ext: ExtensionDeclarations, name: string): AttributeDeclaration {
	return {
		descriptor: ext.descriptors[name],
		source: ext.source,
		sourceId: ext.sourceId,
		groupOrigin: ext.origins[name],
	};
}

/**
 * Combine the applicable fields of several extensions, in discovery order.
 * An entry whose `sourceId` repeats an earlier one is skipped.
 * `byName` has no prototype, so a field named `constructor` is an ordinary key.
 */
export function combineDeclarations(perExtension: readonly ExtensionDeclarations[]): ApplicableDeclarations {
	const byName: Record<string, AttributeDeclaration[]> = Object.create(null);
	const byExtension: ExtensionDeclarations[] = [];
	const seen = new Set<string>();

	for (const ext of perExtension) {
		if (seen.has(ext.sourceId)) {
			continue;
		}
		seen.add(ext.sourceId);
		byExtension.push(ext);
		for (const name of Object.keys(ext.descriptors)) {
			(byName[name] ??= []).push(declarationOf(ext, name));
		}
	}

	return { byName, byExtension };
}

/**
 * Find the declaration of a written key in each extension, in discovery order.
 * Inside one extension, the lookup follows the Lua validator: a declared name first, then an alias, each tried in its three spellings.
 */
export function resolveDeclarations(applicable: ApplicableDeclarations, key: string): AttributeDeclaration[] {
	return applicable.byExtension.flatMap((ext) => {
		const name = findDeclaredName(ext.descriptors, key);
		return name === undefined ? [] : [declarationOf(ext, name)];
	});
}

/**
 * Join extension names for a message: `A`, `A and B`, `A, B and C`.
 */
export function formatSources(sources: readonly string[]): string {
	if (sources.length <= 1) {
		return sources.join("");
	}
	return `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}`;
}
