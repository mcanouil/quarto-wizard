# @quarto-wizard/core

Core library for Quarto extension management.
Provides functionality for discovering, installing, updating, and removing Quarto extensions.

## Installation

```bash
npm install @quarto-wizard/core
```

## Quick Start

```typescript
import { install, remove, discoverInstalledExtensions, fetchRegistry, search } from "@quarto-wizard/core";

// Install an extension from the registry
const result = await install("quarto-ext/fontawesome", {
	projectDir: "./my-project",
});
console.log(`Installed ${result.extension.id.name} v${result.version}`);

// List installed extensions
const installed = await discoverInstalledExtensions("./my-project");
for (const ext of installed) {
	console.log(`${ext.id.owner}/${ext.id.name}: ${ext.manifest.version}`);
}

// Search the registry
const registry = await fetchRegistry();
const results = search(registry, "lightbox");
```

## Features

- **Extension Discovery**: Scan filesystem for installed Quarto extensions.
- **Manifest Parsing**: Read and validate `_extension.yml` files.
- **Registry Integration**: Search and browse the Quarto extensions registry.
- **GitHub Integration**: Download extensions from GitHub repositories.
- **Lifecycle Operations**: Install, update, and remove extensions.
- **Archive Support**: Extract ZIP and TAR.GZ archives.

## API Reference

### Operations

The main entry points for extension management.

#### `install(source, options)`

Install an extension from various sources.

```typescript
import { install, type InstallOptions } from "@quarto-wizard/core";

// From registry
await install("quarto-ext/fontawesome", { projectDir: "." });

// From GitHub with version
await install("quarto-ext/lightbox@v1.0.0", { projectDir: "." });

// From URL
await install("https://github.com/owner/repo/archive/main.zip", {
	projectDir: ".",
});

// From local path
await install("/path/to/extension.zip", { projectDir: "." });
```

**Options:**

| Option        | Type           | Description                   |
| ------------- | -------------- | ----------------------------- |
| `projectDir`  | `string`       | Target project directory      |
| `registryUrl` | `string?`      | Custom registry URL           |
| `auth`        | `AuthConfig?`  | GitHub authentication         |
| `timeout`     | `number?`      | Request timeout in ms         |
| `signal`      | `AbortSignal?` | Abort signal for cancellation |

#### `remove(extensionId, options)`

Remove an installed extension.

```typescript
import { remove } from "@quarto-wizard/core";

await remove(
	{ owner: "quarto-ext", name: "fontawesome" },
	{
		projectDir: ".",
		cleanupEmpty: true, // Remove empty parent directories
	},
);
```

#### `update(extensionId, options)`

Update an extension to a newer version.

```typescript
import { update, checkForUpdates } from "@quarto-wizard/core";

// Check what updates are available
const available = await checkForUpdates(".", { registryUrl: undefined });
for (const update of available) {
	console.log(`${update.extension.id.name}: ${update.currentVersion} -> ${update.availableVersion}`);
}

// Apply updates
const results = await update([{ owner: "quarto-ext", name: "fontawesome" }], { projectDir: "." });
```

#### `use(source, options)`

Install an extension and copy its template files.

```typescript
import { use, getTemplateFiles } from "@quarto-wizard/core";

// Preview template files
const templates = await getTemplateFiles("quarto-ext/typst-cv", { projectDir: "." });

// Install and copy templates
const result = await use("quarto-ext/typst-cv", {
	projectDir: ".",
	files: ["template.qmd", "_quarto.yml"],
});
```

### Discovery

Functions for finding and reading installed extensions.

#### `discoverInstalledExtensions(projectDir)`

Find all extensions in a project's `_extensions` directory.

```typescript
import { discoverInstalledExtensions } from "@quarto-wizard/core";

const extensions = await discoverInstalledExtensions("./my-project");

for (const ext of extensions) {
	console.log(`${ext.id.owner ?? "(no owner)"}/${ext.id.name}`);
	console.log(`  Version: ${ext.manifest.version}`);
	console.log(`  Path: ${ext.directory}`);
}
```

#### `findInstalledExtension(projectDir, extensionId)`

Find a specific installed extension.

```typescript
import { findInstalledExtension } from "@quarto-wizard/core";

const ext = await findInstalledExtension(".", {
	owner: "quarto-ext",
	name: "fontawesome",
});

if (ext) {
	console.log(`Found: ${ext.manifest.title}`);
}
```

### Registry

Functions for searching the Quarto extensions registry.

#### `fetchRegistry(options)`

Fetch the extensions registry.

```typescript
import { fetchRegistry } from "@quarto-wizard/core";

const registry = await fetchRegistry({
	url: undefined, // Use default registry
	cacheTtl: 3600000, // Cache for 1 hour
});

console.log(`Registry has ${registry.length} extensions`);
```

#### `search(registry, query, options)`

Search for extensions by name or description.

```typescript
import { fetchRegistry, search } from "@quarto-wizard/core";

const registry = await fetchRegistry();
const results = search(registry, "table", {
	types: ["filter"], // Only filters
	limit: 10,
});
```

#### `listAvailable(registry, options)`

List available extensions with filtering.

```typescript
import { fetchRegistry, listAvailable } from "@quarto-wizard/core";

const registry = await fetchRegistry();
const filters = listAvailable(registry, { types: ["filter"] });
const formats = listAvailable(registry, { types: ["format"] });
```

### Manifest

Functions for parsing `_extension.yml` files.

#### `readManifest(directory)`

Read and parse a manifest from a directory.

```typescript
import { readManifest } from "@quarto-wizard/core";

const result = readManifest("./_extensions/quarto-ext/fontawesome");
if (result) {
	console.log(`Title: ${result.manifest.title}`);
	console.log(`Version: ${result.manifest.version}`);
}
```

#### `parseManifestContent(content)`

Parse manifest content from a string.

```typescript
import { parseManifestContent } from "@quarto-wizard/core";

const manifest = parseManifestContent(`
title: My Extension
version: 1.0.0
contributes:
  filters:
    - my-filter.lua
`);
```

### Types

#### `ExtensionId`

Identifies an extension by owner and name.

```typescript
import { parseExtensionId, formatExtensionId } from "@quarto-wizard/core";

const id = parseExtensionId("quarto-ext/fontawesome");
// { owner: "quarto-ext", name: "fontawesome" }

const str = formatExtensionId(id);
// "quarto-ext/fontawesome"
```

#### `InstallSource`

Represents where an extension can be installed from.

```typescript
import { parseInstallSource } from "@quarto-wizard/core";

// GitHub reference
parseInstallSource("quarto-ext/fontawesome");
// { type: "github", owner: "quarto-ext", repo: "fontawesome" }

// GitHub with version
parseInstallSource("quarto-ext/lightbox@v1.0.0");
// { type: "github", owner: "quarto-ext", repo: "lightbox", ref: "v1.0.0" }

// URL
parseInstallSource("https://example.com/ext.zip");
// { type: "url", url: "https://example.com/ext.zip" }

// Local path
parseInstallSource("./my-extension");
// { type: "local", path: "./my-extension" }
```

### Error Handling

The library provides typed errors for different failure scenarios.

```typescript
import {
	install,
	ExtensionError,
	NetworkError,
	AuthenticationError,
	RepositoryNotFoundError,
	isQuartoWizardError,
} from "@quarto-wizard/core";

try {
	await install("owner/repo", { projectDir: "." });
} catch (error) {
	if (isQuartoWizardError(error)) {
		console.error(`Error: ${error.message}`);
		if (error.suggestion) {
			console.error(`Suggestion: ${error.suggestion}`);
		}

		if (error instanceof AuthenticationError) {
			// Handle authentication failure
		} else if (error instanceof RepositoryNotFoundError) {
			// Handle missing repository
		} else if (error instanceof NetworkError) {
			// Handle network issues
		}
	}
}
```

| Error Class               | Description                         |
| ------------------------- | ----------------------------------- |
| `QuartoWizardError`       | Base error class                    |
| `ExtensionError`          | General extension operation failure |
| `AuthenticationError`     | GitHub authentication failure       |
| `RepositoryNotFoundError` | Repository does not exist           |
| `NetworkError`            | Network request failure             |
| `SecurityError`           | Security violation (path traversal) |
| `ManifestError`           | Invalid manifest file               |
| `VersionError`            | Version resolution failure          |

### Authentication

For private repositories, provide GitHub authentication.

```typescript
import { install, createAuthConfig } from "@quarto-wizard/core";

const auth = createAuthConfig("ghp_xxxxxxxxxxxx");

await install("private-org/private-ext", {
	projectDir: ".",
	auth,
});
```

## Supported Extension Sources

| Source           | Example                  | Description                     |
| ---------------- | ------------------------ | ------------------------------- |
| Registry         | `quarto-ext/fontawesome` | From Quarto extensions registry |
| GitHub           | `owner/repo`             | Latest release from GitHub      |
| GitHub + version | `owner/repo@v1.0.0`      | Specific tag/release            |
| GitHub + branch  | `owner/repo@main`        | Specific branch                 |
| URL              | `https://.../ext.zip`    | Direct archive URL              |
| Local            | `./path/to/ext`          | Local directory or archive      |

## Requirements

- Node.js >= 24.0.0

## Licence

MIT
