# Testing Guide

This guide covers how to run and write tests for the Quarto Wizard extension.

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
```

### Manual Testing

For alternative test execution:

```bash
# Compile tests only
npm run test-compile

# Run tests using the manual runner
npm run test:manual
```

### Debugging Tests

To debug tests in VS Code:

1. Open the project in VS Code.
2. Go to **Run and Debug** (`Ctrl+Shift+D` or `Cmd+Shift+D` on macOS).
3. Select **"Extension Tests"** from the dropdown.
4. Set breakpoints in your test files.
5. Press **F5** to start debugging.

## Writing Tests

### Test Structure

Tests are located in `src/test/suite/` and use the Mocha test framework:

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    test('Basic test case', () => {
        assert.strictEqual(1 + 1, 2);
    });
});
```

### Integration Tests

Integration tests verify that the extension works properly within VS Code. These tests have access to the full VS Code API:

```typescript
test('Extension loads correctly', async () => {
    const extension = vscode.extensions.getExtension('mcanouil.quarto-wizard');
    if (extension) {
        await extension.activate();
        assert.ok(extension.isActive, 'Extension should be active');
    }
});
```

### Unit Tests

Unit tests focus on individual functions and don't require VS Code:

```typescript
import { hashString } from '../../utils/hash';

test('Creates consistent hash', () => {
    const hash1 = hashString('test input');
    const hash2 = hashString('test input');
    assert.strictEqual(hash1, hash2);
});
```

## Test Configuration

The main test configuration files:

- **`.vscode-test.mjs`**: VS Code test CLI configuration.
- **`src/test/suite/index.ts`**: Test suite entry point.
- **`src/test/runTest.ts`**: Alternative test runner for manual execution.

## Continuous Integration

Tests run automatically on GitHub Actions for:

- **Operating Systems**: Ubuntu, Windows, and macOS.
- **Node.js versions**: 14.x.

## Best Practices

When writing tests, follow these guidelines:

1. **Test Isolation**: Each test should be independent.
2. **Descriptive Names**: Use clear, descriptive test names.
3. **Arrange-Act-Assert**: Structure tests with clear sections.
4. **Mock External Dependencies**: Use mocks for file system and network calls.
5. **Test Edge Cases**: Include tests for error conditions and boundary cases.

## Troubleshooting

### Common Issues

- **Tests fail with "Extension not found"**: Ensure the extension compiles successfully with `npm run test-compile`.
- **VS Code instance doesn't close**: This is normal behaviour; the test runner reuses the same VS Code instance for subsequent runs.
