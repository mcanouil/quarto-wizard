/**
 * Public type exports for @quarto-wizard/schema.
 */

export {
	type ClassDefinition,
	type CompletionSpec,
	type DeprecatedSpec,
	type FieldDescriptor,
	type ShortcodeSchema,
	type ExtensionSchema,
	type RawSchema,
	type SchemaVersion,
	SCHEMA_VERSION_URI,
	SCHEMA_V1_VERSION_URI,
	SCHEMA_V2_VERSION_URI,
	SUPPORTED_SCHEMA_VERSIONS,
	FIELD_ALIAS_PAIRS,
	normaliseSchemaUri,
	resolveSchemaVersion,
	isSupportedSchemaUri,
	normaliseFieldDescriptor,
	normaliseFieldDescriptorMap,
	normaliseShortcodeSchema,
	normaliseSchema,
	typeIncludes,
	formatType,
} from "./schema.js";
