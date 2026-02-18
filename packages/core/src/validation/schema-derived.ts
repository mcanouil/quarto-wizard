/**
 * @title Schema-Derived Constants
 * @description Derives validation constants and completion metadata from the
 * JSON Schema meta-schema (extension-schema.json).
 *
 * All derivation runs once at module load time.
 *
 * @module validation
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const metaSchema = require("./extension-schema.json") as MetaSchemaShape;

interface MetaSchemaShape {
	$schema: string;
	$id: string;
	title: string;
	description: string;
	type: string;
	additionalProperties: boolean;
	properties: Record<string, Record<string, unknown>>;
	$defs: {
		typeEnum: { type: string; enum: string[] };
		fieldDescriptor: {
			type: string;
			additionalProperties: boolean;
			properties: Record<string, Record<string, unknown>>;
		};
		shortcodeEntry: {
			type: string;
			additionalProperties: boolean;
			properties: Record<string, Record<string, unknown>>;
		};
		[key: string]: Record<string, unknown>;
	};
}

// Re-export the raw meta-schema for consumers that need the full object.
export const SCHEMA_META_SCHEMA = metaSchema;

// ---------------------------------------------------------------------------
// Core validation constants (replace the former hardcoded Sets).
// ---------------------------------------------------------------------------

/** Allowed top-level keys in a schema definition file. */
export const ALLOWED_TOP_LEVEL_KEYS = new Set<string>(Object.keys(metaSchema.properties));

/** Allowed properties on a field descriptor (both camelCase and kebab-case). */
export const ALLOWED_FIELD_PROPERTIES = new Set<string>(Object.keys(metaSchema.$defs.fieldDescriptor.properties));

/** Allowed type values for a field descriptor. */
export const ALLOWED_TYPES = new Set<string>(metaSchema.$defs.typeEnum.enum);

/** Allowed top-level keys inside a shortcode entry. */
export const ALLOWED_SHORTCODE_KEYS = new Set<string>(Object.keys(metaSchema.$defs.shortcodeEntry.properties));

// ---------------------------------------------------------------------------
// Metadata for the completion provider (field descriptors).
// ---------------------------------------------------------------------------

interface PropertyMeta {
	description?: string;
	type?: string;
	"x-yaml-hidden"?: boolean;
	"x-boolean-property"?: boolean;
	"x-nested-property"?: boolean;
	"x-snippet"?: string;
	"x-shortcode-argument-only"?: boolean;
}

function deriveFieldDescriptorMetadata() {
	const props = metaSchema.$defs.fieldDescriptor.properties as Record<string, PropertyMeta>;

	const booleanProperties = new Set<string>();
	const nestedProperties = new Set<string>();
	const yamlHidden = new Set<string>();
	const valueTriggerProperties = new Set<string>();
	const propertyDocs: Record<string, string> = {};
	const snippetOverrides: Record<string, string> = {};
	const shortcodeArgumentOnly = new Set<string>();

	for (const [key, meta] of Object.entries(props)) {
		if (meta["x-yaml-hidden"]) {
			yamlHidden.add(key);
		}
		if (meta["x-boolean-property"] || meta.type === "boolean") {
			booleanProperties.add(key);
		}
		if (meta["x-nested-property"]) {
			nestedProperties.add(key);
		}
		if (meta["x-snippet"]) {
			snippetOverrides[key] = meta["x-snippet"];
		}
		if (meta["x-shortcode-argument-only"]) {
			shortcodeArgumentOnly.add(key);
		}
		if (meta.description) {
			propertyDocs[key] = meta.description;
		}
	}

	// "type" is always a value-trigger property, plus all booleans.
	valueTriggerProperties.add("type");
	for (const key of booleanProperties) {
		valueTriggerProperties.add(key);
	}

	return {
		booleanProperties,
		nestedProperties,
		yamlHidden,
		valueTriggerProperties,
		propertyDocs,
		snippetOverrides,
		shortcodeArgumentOnly,
	};
}

export const fieldDescriptorMetadata = deriveFieldDescriptorMetadata();

// ---------------------------------------------------------------------------
// Metadata for the completion provider (shortcode entries).
// ---------------------------------------------------------------------------

function deriveShortcodeEntryMetadata() {
	const props = metaSchema.$defs.shortcodeEntry.properties as Record<string, PropertyMeta>;

	const propertyDocs: Record<string, string> = {};
	const snippetOverrides: Record<string, string> = {};
	const nestedProperties = new Set<string>();

	for (const [key, meta] of Object.entries(props)) {
		if (meta.description) {
			propertyDocs[key] = meta.description;
		}
		if (meta["x-snippet"]) {
			snippetOverrides[key] = meta["x-snippet"];
		}
		if (meta["x-nested-property"]) {
			nestedProperties.add(key);
		}
	}

	return { propertyDocs, snippetOverrides, nestedProperties };
}

export const shortcodeEntryMetadata = deriveShortcodeEntryMetadata();

// ---------------------------------------------------------------------------
// Metadata for the completion provider (root keys).
// ---------------------------------------------------------------------------

function deriveRootKeyMetadata() {
	const props = metaSchema.properties as Record<string, PropertyMeta>;

	const yamlHidden = new Set<string>();
	const propertyDocs: Record<string, string> = {};

	for (const [key, meta] of Object.entries(props)) {
		if (meta["x-yaml-hidden"]) {
			yamlHidden.add(key);
		}
		if (meta.description) {
			propertyDocs[key] = meta.description;
		}
	}

	return { yamlHidden, propertyDocs };
}

export const rootKeyMetadata = deriveRootKeyMetadata();
