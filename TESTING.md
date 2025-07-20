# Quarto Wizard - Testing Infrastructure

This document describes the testing infrastructure setup for the Quarto Wizard VS Code extension.

## ✅ What was set up

### 1. Testing Dependencies

- `@vscode/test-cli` - Modern VS Code testing CLI
- `@vscode/test-electron` - VS Code testing framework
- `@types/mocha` - TypeScript types for Mocha
- `mocha` - Test framework

### 2. Test Configuration Files

- `.vscode-test.mjs` - VS Code test CLI configuration
- `src/test/suite/index.ts` - Test runner script
- `src/test/runTest.ts` - Advanced test runner (for manual execution)

### 3. Test Files Created

- `src/test/suite/extension.test.ts` - Integration tests for the extension
- `src/test/suite/hash.test.ts` - Unit tests for hash utilities
- `src/test/suite/quarto.test.ts` - Unit tests for Quarto utilities

### 4. VS Code Integration

- Updated `.vscode/launch.json` with debug configuration for tests
- Added test compilation and execution scripts to `package.json`

### 5. CI/CD Setup

- `.github/workflows/test.yml` - GitHub Actions workflow for automated testing
- Support for multiple OS (Ubuntu, Windows, macOS) and Node.js versions

### 6. Test Fixtures

- `test-fixtures/` directory with sample files for testing

## 🚀 Running Tests

### Quick Commands

```bash
# Install dependencies (if not done already)
npm install

# Compile and run tests
npm test

# Run tests with watch mode
npm run test:watch

# Compile tests only
npm run test-compile
```

### Manual Testing

```bash
# Run specific test configuration
npx vscode-test --label unitTests

# Dry run (validate configuration)
npx vscode-test --dry-run

# Run with specific VS Code version
npx vscode-test --code-version insiders
```

### Debugging Tests

1. Open VS Code
2. Go to **Run and Debug** (Ctrl+Shift+D)
3. Select **"Extension Tests"** configuration
4. Set breakpoints in your test files
5. Press **F5** to start debugging

## 🧪 Writing New Tests

### Integration Tests (Extension API)

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('My Integration Tests', () => {
    test('Should access VS Code API', () => {
        const extension = vscode.extensions.getExtension('mcanouil.quarto-wizard');
        assert.ok(extension, 'Extension should be available');
    });
});
```

### Unit Tests (Pure Functions)

```typescript
import * as assert from 'assert';
import { myFunction } from '../../utils/myModule';

suite('My Unit Tests', () => {
    test('Should test pure function', () => {
        const result = myFunction('input');
        assert.strictEqual(result, 'expected');
    });
});
```

## 🔧 Configuration Details

### Test Runner Configuration

The `.vscode-test.mjs` file configures:

- Test files pattern: `out/test/**/*.test.js`
- VS Code version: `stable`
- Workspace folder: `./test-fixtures`
- Mocha timeout: 20 seconds

## 🚨 Troubleshooting

### Common Issues

**Tests won't start**

- Ensure `npm run test-compile` runs without errors
- Check that all test files are in `out/test/suite/`

**Extension not found**

- Make sure the extension is properly compiled
- Verify the extension ID matches in tests

**VS Code hangs during tests**

- This is normal - VS Code instance remains open
- Use `--bail` flag to stop on first failure
- Use dry run mode to validate configuration

### CI/CD Notes

The GitHub Actions workflow will:

- Run on Ubuntu, Windows, and macOS
- Test with Node.js 18.x and 20.x

## 📝 Best Practices

1. **Test Independence**: Each test should work in isolation
2. **Descriptive Names**: Use clear, descriptive test names  
3. **Arrange-Act-Assert**: Structure tests clearly
4. **Mock Dependencies**: Mock external APIs and file system calls
5. **Test Edge Cases**: Include error conditions and boundary tests

## 🎯 Next Steps

1. **Write more tests**: Add tests for your specific commands and utilities
2. **Set up mocking**: Use libraries like `sinon` for mocking complex dependencies
3. **Add performance tests**: Test extension startup time and memory usage
4. **Add e2e tests**: Consider adding end-to-end tests for complete workflows

## 📚 Resources

- [VS Code Extension Testing Guide](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Mocha Documentation](https://mochajs.org/)
- [VS Code Test CLI](https://github.com/microsoft/vscode-test-cli)
