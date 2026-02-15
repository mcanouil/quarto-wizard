/**
 * @title Schema Types Module
 * @description Extension schema types for parsing _schema.yml files.
 *
 * Defines types for field descriptors, completion specs, shortcode schemas,
 * and the overall extension schema structure.
 *
 * @module types
 */

/**
 * Completion specification for a field.
 * Describes how a field's value should be completed in an editor.
 */
export interface CompletionSpec {
	/** Type of completion (e.g., "file", "value"). */
	type?: string;
	/** File extensions to filter (for file completions). */
	extensions?: string[];
	/** Placeholder text shown in the editor. */
	placeholder?: string;
	/** Static list of allowed values. */
	values?: string[];
	/** Whether completion values are dynamically resolved. */
	dynamic?: boolean;
	/** Source for dynamic completion values. */
	source?: string;
}

/**
 * Descriptor for a single field in an extension schema.
 * Describes the type, constraints, and metadata for a configuration option.
 */
export interface FieldDescriptor {
	/** Data type of the field (e.g., "string", "number", "boolean", "object", "array"). */
	type?: string;
	/** Whether the field is required. */
	required?: boolean;
	/** Default value for the field. */
	default?: unknown;
	/** Human-readable description of the field. */
	description?: string;
	/** Allowed values for the field. */
	enum?: unknown[];
	/** Whether enum matching is case-insensitive. */
	enumCaseInsensitive?: boolean;
	/** Regular expression pattern the value must match. */
	pattern?: string;
	/** Whether the pattern must match the entire value. */
	patternExact?: boolean;
	/** Minimum numeric value. */
	min?: number;
	/** Maximum numeric value. */
	max?: number;
	/** Minimum string length. */
	minLength?: number;
	/** Maximum string length. */
	maxLength?: number;
	/** Alternative names for the field. */
	aliases?: string[];
	/** Whether the field is deprecated. */
	deprecated?: boolean | string;
	/** Completion specification for the field. */
	completion?: CompletionSpec;
	/** Schema for array items when type is "array". */
	items?: FieldDescriptor;
	/** Schema for object properties when type is "object". */
	properties?: Record<string, FieldDescriptor>;
}

/**
 * Schema for a shortcode, including its arguments and attributes.
 */
export interface ShortcodeSchema {
	/** Human-readable description of the shortcode. */
	description?: string;
	/** Positional arguments accepted by the shortcode. */
	arguments?: Array<FieldDescriptor & { name: string }>;
	/** Named attributes accepted by the shortcode. */
	attributes?: Record<string, FieldDescriptor>;
}

/**
 * Complete extension schema parsed from a _schema.yml file.
 * All sections are optional and default to empty objects or arrays.
 */
export interface ExtensionSchema {
	/** Options (top-level YAML keys) the extension accepts. */
	options?: Record<string, FieldDescriptor>;
	/** Shortcodes the extension provides. */
	shortcodes?: Record<string, ShortcodeSchema>;
	/** Format-specific options the extension supports. */
	formats?: Record<string, Record<string, FieldDescriptor>>;
	/** Project-level options the extension supports. */
	projects?: Record<string, FieldDescriptor>;
	/** Element-level attributes grouped by CSS class or element type (e.g., "_any", "panel", "card"). */
	elementAttributes?: Record<string, Record<string, FieldDescriptor>>;
}

/**
 * Raw schema data as parsed from YAML.
 * Uses kebab-case keys matching the _schema.yml structure.
 */
export interface RawSchema {
	options?: Record<string, unknown>;
	shortcodes?: Record<string, unknown>;
	formats?: Record<string, unknown>;
	projects?: Record<string, unknown>;
	"element-attributes"?: Record<string, unknown>;
}

/**
 * Mapping of kebab-case YAML field descriptor keys to camelCase TypeScript keys.
 */
const KEBAB_TO_CAMEL: Record<string, string> = {
	"enum-case-insensitive": "enumCaseInsensitive",
	"pattern-exact": "patternExact",
	"min-length": "minLength",
	"max-length": "maxLength",
};

/**
 * Normalise a raw field descriptor from YAML, converting kebab-case keys to camelCase.
 *
 * @param raw - Raw field descriptor object from YAML
 * @returns Normalised FieldDescriptor
 */
export function normaliseFieldDescriptor(raw: Record<string, unknown>): FieldDescriptor {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(raw)) {
		const camelKey = KEBAB_TO_CAMEL[key] ?? key;

		if (camelKey === "items" && value && typeof value === "object" && !Array.isArray(value)) {
			result[camelKey] = normaliseFieldDescriptor(value as Record<string, unknown>);
		} else if (camelKey === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
			result[camelKey] = normaliseFieldDescriptorMap(value as Record<string, unknown>);
		} else {
			result[camelKey] = value;
		}
	}

	return result as FieldDescriptor;
}

/**
 * Normalise a map of field descriptors from YAML.
 *
 * @param raw - Raw object mapping field names to descriptors
 * @returns Normalised map of FieldDescriptor objects
 */
export function normaliseFieldDescriptorMap(raw: Record<string, unknown>): Record<string, FieldDescriptor> {
	const result: Record<string, FieldDescriptor> = {};

	for (const [key, value] of Object.entries(raw)) {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			result[key] = normaliseFieldDescriptor(value as Record<string, unknown>);
		}
	}

	return result;
}

/**
 * Normalise a raw shortcode schema from YAML.
 *
 * @param raw - Raw shortcode schema object from YAML
 * @returns Normalised ShortcodeSchema
 */
export function normaliseShortcodeSchema(raw: Record<string, unknown>): ShortcodeSchema {
	const result: ShortcodeSchema = {};

	if (typeof raw["description"] === "string") {
		result.description = raw["description"];
	}

	if (Array.isArray(raw["arguments"])) {
		result.arguments = raw["arguments"].map((arg: unknown) => {
			if (arg && typeof arg === "object" && !Array.isArray(arg)) {
				const rawArg = arg as Record<string, unknown>;
				const normalised = normaliseFieldDescriptor(rawArg);
				return { ...normalised, name: String(rawArg["name"] ?? "") };
			}
			return { name: "" };
		});
	}

	if (raw["attributes"] && typeof raw["attributes"] === "object" && !Array.isArray(raw["attributes"])) {
		result.attributes = normaliseFieldDescriptorMap(raw["attributes"] as Record<string, unknown>);
	}

	return result;
}

/**
 * Normalise a raw schema from YAML to an ExtensionSchema.
 *
 * @param raw - Raw schema data from YAML parsing
 * @returns Normalised ExtensionSchema
 */
export function normaliseSchema(raw: RawSchema): ExtensionSchema {
	const result: ExtensionSchema = {};

	if (raw.options && typeof raw.options === "object" && !Array.isArray(raw.options)) {
		result.options = normaliseFieldDescriptorMap(raw.options);
	}

	if (raw.shortcodes && typeof raw.shortcodes === "object") {
		const shortcodes: Record<string, ShortcodeSchema> = {};
		for (const [key, value] of Object.entries(raw.shortcodes)) {
			if (value && typeof value === "object" && !Array.isArray(value)) {
				shortcodes[key] = normaliseShortcodeSchema(value as Record<string, unknown>);
			}
		}
		result.shortcodes = shortcodes;
	}

	if (raw.formats && typeof raw.formats === "object") {
		const formats: Record<string, Record<string, FieldDescriptor>> = {};
		for (const [formatName, formatValue] of Object.entries(raw.formats)) {
			if (formatValue && typeof formatValue === "object" && !Array.isArray(formatValue)) {
				formats[formatName] = normaliseFieldDescriptorMap(formatValue as Record<string, unknown>);
			}
		}
		result.formats = formats;
	}

	if (raw.projects && typeof raw.projects === "object" && !Array.isArray(raw.projects)) {
		result.projects = normaliseFieldDescriptorMap(raw.projects);
	}

	const elementAttributes = raw["element-attributes"];
	if (elementAttributes && typeof elementAttributes === "object" && !Array.isArray(elementAttributes)) {
		const groups: Record<string, Record<string, FieldDescriptor>> = {};
		for (const [groupKey, groupValue] of Object.entries(elementAttributes as Record<string, unknown>)) {
			if (groupValue && typeof groupValue === "object" && !Array.isArray(groupValue)) {
				groups[groupKey] = normaliseFieldDescriptorMap(groupValue as Record<string, unknown>);
			}
		}
		result.elementAttributes = groups;
	}

	return result;
}
