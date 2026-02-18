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
