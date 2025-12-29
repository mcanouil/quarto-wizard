# Testing Guide

This guide covers how to run and write tests for the Quarto Wizard extension.

## Test Setup

The extension includes a comprehensive test suite covering both unit and integration tests. Here's what's included:

### Dependencies

- `@vscode/test-cli` - VS Code testing CLI.
- `@vscode/test-electron` - Testing framework for VS Code extensions.
- `@types/mocha` - TypeScript definitions for Mocha.
- `mocha` - The test framework.

### Configuration Files

- `.vscode-test.mjs` - Main test configuration.
- `src/test/suite/index.ts` - Test suite entry point.
- `src/test/runTest.ts` - Alternative test runner for manual execution.

### Test Files

- `src/test/suite/extension.test.ts` - Tests for extension activation and commands.
- `src/test/suite/hash.test.ts` - Tests for utility functions.
- `src/test/suite/quarto.test.ts` - Tests for Quarto CLI integration.

### Additional Setup

- Debug configuration in `.vscode/launch.json`.
- Test scripts in `package.json`.
- CI workflow in `.github/workflows/test.yml` for automated testing across multiple platforms.
- Test fixtures in `test-fixtures/` directory.

## Running Tests

### Basic Commands

The quickest way to run tests is through npm scripts:

```bash
# Install dependencies first
npm install

# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Only compile tests without running them
npm run test-compile
```

### Advanced Options

For more control over test execution:

```bash
# Run specific test configuration
npx vscode-test --label unitTests

# Validate configuration without running tests
npx vscode-test --dry-run

# Test against VS Code Insiders
npx vscode-test --code-version insiders
```

### Debugging Tests

To debug tests in VS Code:

1. Open the project in VS Code.
2. Go to **Run and Debug** (`Ctrl+Shift+D` or `Cmd+Shift+D` on macOS).
3. Select **"Extension Tests"** from the dropdown.
4. Set breakpoints in your test files.
5. Press **F5** to start debugging.

## Writing Tests

### Integration Tests

Integration tests verify that the extension works properly within VS Code. These tests have access to the full VS Code API:

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

### Unit Tests

Unit tests focus on individual functions and don't require VS Code:

```typescript
import * as assert from "assert";
import { hashString } from "../../utils/hash";

suite("Hash Utility Tests", () => {
	test("Creates consistent hash", () => {
		const input = "test string";
		const hash1 = hashString(input);
		const hash2 = hashString(input);
		assert.strictEqual(hash1, hash2);
	});
});
```

## Test Configuration

The main test configuration is in `.vscode-test.mjs`:

- **Test files**: `out/test/**/*.test.js`.
- **VS Code version**: `stable`.
- **Workspace**: `./test-fixtures`.

## Troubleshooting

### Common Issues

- **Tests won't start**: Ensure `npm run test-compile` runs without errors.
- **Extension not found**: Check that the extension compiles successfully.
- **VS Code hangs**: This is normal behaviour; the VS Code test instance remains open.

### CI/CD

Tests run automatically on GitHub Actions for:

- Ubuntu, Windows, and macOS.
- Node.js versions 14.x.

## Resources

- [VS Code Extension Testing Guide](https://code.visualstudio.com/api/working-with-extensions/testing-extension).
- [Mocha Documentation](https://mochajs.org/).
- [VS Code Test CLI](https://github.com/microsoft/vscode-test-cli).
