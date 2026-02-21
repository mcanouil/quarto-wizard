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
	SCHEMA_VERSION_URI,
	SUPPORTED_SCHEMA_VERSIONS,
	normaliseFieldDescriptor,
	normaliseFieldDescriptorMap,
	normaliseShortcodeSchema,
	normaliseSchema,
	typeIncludes,
	formatType,
} from "./schema.js";
