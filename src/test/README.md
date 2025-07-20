# Testing Guide

This document explains how to run and write tests for the Quarto Wizard extension.

## Running Tests

### Quick Start

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode (recompiles on changes)
npm run test:watch
```

### Manual Testing

```bash
# Compile tests
npm run test-compile

# Run tests using the manual runner
npm run test:manual
```

### Debugging Tests

1. Open VS Code
2. Go to Run and Debug (Ctrl+Shift+D)
3. Select "Extension Tests" configuration
4. Set breakpoints in your test files
5. Press F5 to start debugging

## Writing Tests

### Test Structure

Tests are located in `src/test/suite/` and follow the Mocha TDD interface:

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('My Test Suite', () => {
    test('My test case', () => {
        assert.strictEqual(1 + 1, 2);
    });
});
```

### Integration Tests

Integration tests run in a VS Code Extension Host and have access to the full VS Code API:

```typescript
test('Extension should activate', async () => {
    const extension = vscode.extensions.getExtension('mcanouil.quarto-wizard');
    if (extension) {
        await extension.activate();
        assert.ok(extension.isActive, 'Extension should activate');
    }
});
```

### Unit Tests

Unit tests should focus on testing individual functions and utilities:

```typescript
import { generateHashKey } from '../../utils/hash';

test('Should generate consistent hash', () => {
    const hash1 = generateHashKey('test');
    const hash2 = generateHashKey('test');
    assert.strictEqual(hash1, hash2);
});
```

## Test Configuration

- `.vscode-test.mjs`: VS Code test CLI configuration
- `src/test/suite/index.ts`: Test runner configuration
- `src/test/runTest.ts`: Manual test runner

## Continuous Integration

The project is configured to run tests on:

- GitHub Actions (Ubuntu, Windows, macOS)
- Node.js versions 18.x and 20.x

## Best Practices

1. **Test Isolation**: Each test should be independent
2. **Descriptive Names**: Use clear, descriptive test names
3. **Arrange-Act-Assert**: Structure tests with clear sections
4. **Mock External Dependencies**: Use mocks for file system, network calls, etc.
5. **Test Edge Cases**: Include tests for error conditions and edge cases

## Troubleshooting

### Tests fail with "Extension not found"

Make sure the extension is properly compiled:

```bash
npm run test-compile
```

### VS Code instance doesn't close after tests

This is normal behaviour. The test runner will reuse the same VS Code instance for subsequent test runs.
