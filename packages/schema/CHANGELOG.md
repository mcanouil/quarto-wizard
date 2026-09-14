# Changelog

The extension meta-schemas and the Lua reference validator are versioned apart from the Quarto Wizard extension.
The major version is the major version of the meta-schema, so a `2.x.y` release implements the v2 vocabulary.
A release is tagged `schema-v<version>`.
This is not the changelog of the `@quarto-wizard/schema` npm package, whose version follows the Quarto Wizard extension and whose changes are recorded in the root `CHANGELOG.md`.

## Unreleased

## 2.1.0

### Features

- feat: Accept `uniqueItems` in a field descriptor. (#378)

### Bug Fixes

- fix: Parse a block sequence at the column of its key. (#375)
- fix: Refuse a pattern that the compiler cannot express. (#376)
- fix: Correct the handling of an empty string, an alias and a dependency. (#377)
- fix: Correct three checks in the validator. (#410)
- fix: Read the options of a format from the top level of the metadata. (#439)
- fix: Accept only `true` and `false` as a boolean. (#460)

### Code Refactoring

- refactor: Report the spellings that a merge consumed. (#415)

## 2.0.0

### Features

- feat: Add the Lua reference validator for the v2 extension schema. (#374)

This version shipped inside the Quarto Wizard extension releases, before the schema had a release train of its own.
