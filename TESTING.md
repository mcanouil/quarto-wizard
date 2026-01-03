# Testing Guide

This guide covers how to run and write tests for the Quarto Wizard project.

## Project Structure

The project is a monorepo with two test suites:

- **VS Code Extension Tests** (root) - Integration tests using Mocha.
- **Core Package Tests** (`packages/core`) - Unit tests using Vitest.

## Test Setup

### VS Code Extension Tests

#### Dependencies

- `@vscode/test-cli` - VS Code testing CLI.
- `@vscode/test-electron` - Testing framework for VS Code extensions.
- `@types/mocha` - TypeScript definitions for Mocha.
- `mocha` - The test framework.

#### Configuration Files

- `.vscode-test.mjs` - Main test configuration.
- `src/test/suite/index.ts` - Test suite entry point.
- `src/test/runTest.ts` - Alternative test runner for manual execution.

#### Test Files

Located in `src/test/suite/`:

- `activate.test.ts` - Tests for extension activation.
- `ask.test.ts` - Tests for user prompts and confirmations.
- `extension.test.ts` - Tests for extension commands registration.
- `extensionDetails.test.ts` - Tests for extension metadata retrieval.
- `extensions.test.ts` - Tests for extension discovery and parsing.
- `extensionsQuickPick.test.ts` - Tests for the QuickPick UI.
- `hash.test.ts` - Tests for hashing utility functions.
- `installQuartoExtension.test.ts` - Tests for extension installation.
- `log.test.ts` - Tests for logging functionality.
- `network.test.ts` - Tests for network operations.
- `quarto.test.ts` - Tests for Quarto CLI integration.
- `reprex.test.ts` - Tests for reproducible document creation.
- `timeout.test.ts` - Tests for timeout handling.
- `workspace.test.ts` - Tests for workspace operations.

### Core Package Tests

The `@quarto-wizard/core` package (`packages/core`) uses Vitest for testing.

#### Core Dependencies

- `vitest` - The test framework.
- `@vitest/coverage-v8` - Code coverage support.

#### Core Configuration

- `packages/core/vitest.config.ts` - Vitest configuration.

#### Core Test Files

Located in `packages/core/tests/`:

- `archive.test.ts` - Tests for archive extraction.
- `auth.test.ts` - Tests for GitHub authentication.
- `discovery.test.ts` - Tests for extension discovery.
- `errors.test.ts` - Tests for error handling.
- `extension.test.ts` - Tests for extension metadata.
- `github-releases.test.ts` - Tests for GitHub releases API.
- `manifest.test.ts` - Tests for extension manifests.
- `proxy.test.ts` - Tests for proxy support.
- `registry-cache.test.ts` - Tests for registry caching.
- `registry-search.test.ts` - Tests for registry search.
- `registry.test.ts` - Tests for registry operations.
- `walk.test.ts` - Tests for directory walking.

Located in `packages/core/tests/operations/`:

- `install.test.ts` - Tests for install operation.
- `remove.test.ts` - Tests for remove operation.
- `update.test.ts` - Tests for update operation.
- `use.test.ts` - Tests for use template operation.

### Additional Setup

- Debug configuration in `.vscode/launch.json`.
- Test scripts in `package.json` (root and packages/core).
- CI workflow in `.github/workflows/build.yml` for automated testing across multiple platforms.
- Test fixtures in `test-fixtures/` directory.

## Running Tests

### Running Extension Tests

```bash
# Install dependencies first
npm install

# Run all extension tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Only compile tests without running them
npm run test-compile
```

#### Advanced Options

```bash
# Run specific test configuration
npx vscode-test --label unitTests

# Validate configuration without running tests
npx vscode-test --dry-run

# Test against VS Code Insiders
npx vscode-test --code-version insiders
```

### Running Core Tests

```bash
# Navigate to the core package
cd packages/core

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm test -- --coverage
```

Or from the root directory:

```bash
# Run core tests via npm workspace
npm run test -w packages/core
```

### Debugging Tests

#### Debugging Extension Tests

1. Open the project in VS Code.
2. Go to **Run and Debug** (`Ctrl+Shift+D` or `Cmd+Shift+D` on macOS).
3. Select **"Extension Tests"** from the dropdown.
4. Set breakpoints in your test files.
5. Press **F5** to start debugging.

#### Debugging Core Tests

Use the Vitest VS Code extension or run with `--inspect` flag:

```bash
cd packages/core
node --inspect-brk ./node_modules/.bin/vitest run
```

## Writing Tests

### VS Code Extension Tests (Mocha)

Integration tests verify that the extension works properly within VS Code.
These tests have access to the full VS Code API:

```typescript
import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Integration Tests", () => {
  test("Extension loads correctly", () => {
    const extension = vscode.extensions.getExtension("mcanouil.quarto-wizard");
    assert.ok(extension, "Extension should be available");
  });

  test("Commands are registered", async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes("quartoWizard.installExtension"));
  });
});
```

### Core Package Tests (Vitest)

Unit tests focus on individual functions and do not require VS Code:

```typescript
import { describe, it, expect } from "vitest";
import { parseManifest } from "../src/manifest";

describe("Manifest Parser", () => {
  it("parses a valid manifest", () => {
    const yaml = "title: Test\nversion: 1.0.0";
    const result = parseManifest(yaml);
    expect(result.title).toBe("Test");
    expect(result.version).toBe("1.0.0");
  });
});
```

## Test Configuration

### Extension Test Configuration

The main test configuration is in `.vscode-test.mjs`:

- **Test files**: `out/test/**/*.test.js`.
- **VS Code version**: `stable`.
- **Workspace**: `./test-fixtures`.
- **Timeout**: 20000ms.

### Core Test Configuration

The configuration is in `packages/core/vitest.config.ts`.

## Troubleshooting

### Common Issues

- **Tests won't start**: Ensure `npm run test-compile` runs without errors.
- **Extension not found**: Check that the extension compiles successfully.
- **VS Code hangs**: This is normal behaviour; the VS Code test instance remains open.
- **Core tests fail**: Ensure you have run `npm install` in the root directory.

### CI/CD

Tests run automatically on GitHub Actions via `.github/workflows/build.yml` for:

- Ubuntu, Windows, and macOS.
- Node.js version 24.x.

The workflow includes:

1. Core package linting and testing.
2. Extension compilation and linting.
3. VS Code extension tests (with Xvfb on Linux).
4. Extension packaging.

## Resources

- [VS Code Extension Testing Guide](https://code.visualstudio.com/api/working-with-extensions/testing-extension).
- [Mocha Documentation](https://mochajs.org/).
- [VS Code Test CLI](https://github.com/microsoft/vscode-test-cli).
- [Vitest Documentation](https://vitest.dev/).
