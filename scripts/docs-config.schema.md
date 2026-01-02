# Documentation Configuration Schema

This document describes the structure of `docs-config.json`, which configures the documentation generation process in `process-api-docs.mjs`.

## Overview

All paths in this file are relative to the repository root.
The processing script resolves them to absolute paths at runtime.

## Schema

```json
{
  "packages": [...],
  "languageFilenames": {...},
  "envVarSources": [...],
  "commandGroups": [...],
  "configGroups": [...],
  "paths": {...}
}
```

## Properties

### packages

Array of package configurations for API documentation generation.

| Property      | Type   | Description                                            |
| ------------- | ------ | ------------------------------------------------------ |
| `name`        | string | Full package name (e.g., `@quarto-wizard/core`).       |
| `shortName`   | string | Short identifier used in output paths (e.g., `core`).  |
| `sourceDir`   | string | Relative path to TypeScript source directory.          |
| `outputDir`   | string | Relative path for generated documentation output.      |
| `description` | string | One-line package description for index pages.          |
| `overview`    | string | Multi-line overview text for the package landing page. |

### languageFilenames

Object mapping code block language identifiers to display labels.
Used when converting markdown code blocks to Quarto format with filename headers.

```json
{
	"ts": "TypeScript",
	"bash": "Terminal"
}
```

### envVarSources

Array of TypeScript files containing environment variable documentation in JSDoc format.

| Property  | Type   | Description                                                 |
| --------- | ------ | ----------------------------------------------------------- |
| `path`    | string | Relative path to TypeScript file with `@envvar` JSDoc tags. |
| `section` | string | Section title in the environment variables reference page.  |
| `id`      | string | Unique identifier for the section.                          |

### commandGroups

Array of command groupings for the reference documentation.
Commands are read from `package.json` and grouped by these categories.

| Property      | Type     | Description                                                   |
| ------------- | -------- | ------------------------------------------------------------- |
| `id`          | string   | Unique identifier for the group.                              |
| `title`       | string   | Display title for the section.                                |
| `description` | string   | Introductory text for the command group.                      |
| `commands`    | string[] | Array of command IDs (e.g., `quartoWizard.installExtension`). |

### configGroups

Array of configuration setting groupings for the reference documentation.
Settings are read from `package.json` and grouped by prefix.

| Property | Type   | Description                                              |
| -------- | ------ | -------------------------------------------------------- |
| `id`     | string | Unique identifier for the group.                         |
| `title`  | string | Display title for the section.                           |
| `prefix` | string | Setting key prefix to match (e.g., `quartoWizard.ask.`). |

### paths

Object containing relative paths to documentation directories and files.

| Property           | Description                               |
| ------------------ | ----------------------------------------- |
| `docsDir`          | Root documentation directory.             |
| `docsApiDir`       | API reference output directory.           |
| `docsRefDir`       | Reference documentation output directory. |
| `templatesDir`     | Directory containing Quarto templates.    |
| `packageJsonPath`  | Path to package.json for metadata.        |
| `variablesYmlPath` | Path to Quarto variables file.            |
| `changelogMdPath`  | Path to source CHANGELOG.md.              |
| `changelogQmdPath` | Path to generated changelog.qmd.          |

## Related Files

- [docs-config.json](docs-config.json) - The configuration file.
- [process-api-docs.mjs](process-api-docs.mjs) - The processing script that consumes this configuration.
- [package.json](../package.json) - Source of command and setting metadata.
