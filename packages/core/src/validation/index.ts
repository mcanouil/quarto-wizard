/**
 * @title Validation Module
 * @description Barrel export for schema definition validation.
 *
 * @module validation
 */

export {
	validateSchemaDefinition,
	validateSchemaDefinitionSyntax,
	validateSchemaDefinitionStructure,
} from "./schema-definition.js";

export type { SchemaDefinitionSeverity, SchemaDefinitionFinding } from "./schema-definition.js";

export {
	ALLOWED_TOP_LEVEL_KEYS,
	ALLOWED_FIELD_PROPERTIES,
	ALLOWED_TYPES,
	ALLOWED_SHORTCODE_KEYS,
	fieldDescriptorMetadata,
	shortcodeEntryMetadata,
	rootKeyMetadata,
	SCHEMA_META_SCHEMA,
} from "./schema-derived.js";
