# Changelog

## Unreleased

### New Features

- feat: add `classes` section to extension schemas for declaring CSS classes contributed by filters, with descriptions.
- feat: add class name completion and hover support for CSS classes declared in extension schemas.
- feat: add `Quarto Wizard: Use Brand` command to download and apply a Quarto brand to the project's `_brand/` directory, supporting GitHub, URL, and local sources.
- feat: add extension schema support via `_schema.yml`, `_schema.yaml`, and `_schema.json` to drive completion, hover help, and diagnostics for YAML options, shortcodes, and element attributes.
- feat: add schema authoring support with diagnostics and YAML completion for extension schema definition files when `_extension.yml` is present.
- feat: add file-path completion for schema fields using `completion.type: file` (with optional extension filters).
- feat: display schema contribution details in the installed extensions tree view.
- feat: add extension-provided snippets from `_snippets.json`, surfaced in the tree view and IntelliSense with direct insertion from snippet nodes.
- feat: display `quarto-required` version constraints in extension detail rows in the installed extensions tree view.
- feat: add compatibility status in the installed extensions tree view to highlight version mismatches against `quarto-required` when Quarto is available.

### Bug Fixes

- fix: improve update detection and update UI for commit-based installs, unknown registry versions, badge clearing, and refresh timing.
- fix: improve operation flow by supporting cancellation for update actions and removing unnecessary GitHub sign-in prompts for public registry usage.
- fix: harden network and security handling for stream backpressure failures and path traversal checks.
- fix: improve schema provider robustness with better cache sharing, merge consistency, type handling, and completion ranking.
- fix: store file system watcher event disposables to prevent resource leaks.
- fix: prevent directory deselection in the template file picker by updating selection state directly instead of rebuilding items.
- fix: validate GitHub reference format in source prompt input to reject malformed values such as `///` or `a/b/c/d`.
- fix: add concurrency guard to update check to prevent concurrent calls from corrupting version data.
- fix: include error details in the "reveal in Explorer" log message for better diagnostics.
- fix: prevent spurious cancellation message after a completed single-source install.
- fix: use deferred error pattern in tar extraction to prevent unhandled rejections, and reject hard links alongside symbolic links.
- fix: track additional extension install failures separately so partial installs report success for the primary extension.
- fix: make retry backoff cancellable via AbortSignal so users can cancel during retry delays.
- fix: detect cross-platform absolute paths (Windows drive letters, UNC paths) in source prompts.
- fix: skip internet connectivity check for local extension installs.
- fix: prevent closing a document tab from cancelling pending diagnostics for other open documents.
- fix: prevent stale YAML diagnostics from overwriting fresh validation results during rapid edits.

### Refactoring

- refactor: extract schema types, parsing, validation, and caching into a dedicated `@quarto-wizard/schema` package for better separation of concerns.
- refactor: consolidate shared utilities, deduplicate error handling, and harden internal validation across extension and core packages.

## 2.1.3 (2026-02-05)

- docs: update website theme and display proper license.

## 2.1.2 (2026-02-05)

### Dependency Updates

- chore(deps-dev): bump prettier from 3.7.4 to 3.8.1 (#244)
- chore(deps): bump the npm_and_yarn group across 1 directory with 2 updates (#246)
- chore(deps): bump undici from 7.18.2 to 7.19.2 (#243)
- chore(deps): bump lodash from 4.17.21 to 4.17.23 in the npm_and_yarn group across 1 directory (#241)

## 2.1.1 (2026-01-23)

### Dependency Updates

- chore(deps): bump tar from 7.5.3 to 7.5.4 in the npm_and_yarn group across 1 directory (#239)

## 2.1.0 (2026-01-20)

### New Features

- feat: add `Quarto Wizard: Install Extension from GitHub` command for direct GitHub installation with version specifiers (e.g., `owner/repo@v2` or `owner/repo@branch`).

### Refactoring

- refactor: replace auto-detection with explicit source picker in "Install Extension" and "Use Template" commands.
  Users now choose the installation source (Registry, GitHub, URL, or Local) as the first step, enabling direct GitHub installation with version specifiers (e.g., `owner/repo@v2` or `owner/repo@branch`) even for extensions in the registry.

## 2.0.1 (2026-01-19)

### Dependency Updates

- chore(deps): bump tar from 7.5.2 to 7.5.3 in the npm_and_yarn group across 1 directory (#234)
- chore(deps): bump undici from 7.16.0 to 7.18.2 in the npm_and_yarn group across 1 directory (#233)

## 2.0.0 (2026-01-09)

### Breaking Changes

- removed: `quartoWizard.quarto.path` setting is no longer available.
- removed: Quarto CLI is no longer required; extension management is now handled natively.

### New Features

#### Core

- feat: add `@quarto-wizard/core` package with platform-agnostic extension management logic.
- feat: add proxy support via environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).

#### Templates

- feat: add interactive file selection for templates with tree view, allowing users to select which files to copy.
- feat: add target subdirectory option for template files when using `Quarto Wizard: Use Template` functionality.
  Users can now specify a subdirectory within the project where template files should be copied, while extensions always install to the project root.

#### Extensions

- feat: add multi-extension selection when installing from sources containing multiple extensions.
- feat: add extension type filtering in the picker UI for easier browsing.
- feat: add Quarto version requirement validation using the `quarto.quarto` extension API.
- feat: support discovery and removal of extensions without owner in path (e.g., `_extensions/myext`).

#### Commands

- feat: add `Quarto Wizard: Install Extension from Registry` command for direct registry installation.
- feat: add `Quarto Wizard: Install Extension from URL` command for archive URL installation.
- feat: add `Quarto Wizard: Install Extension from Local` command for local path installation.
- feat: add `Quarto Wizard: Update All Extensions` command to batch update outdated extensions.
- feat: add `Quarto Wizard: Remove Multiple Extensions` command for batch removal.
- feat: add `Quarto Wizard: Clear Extension Cache` command to force registry refresh.
- feat: add `Quarto Wizard: Set GitHub Token (Manual)` command for explicit token configuration.
- feat: add `Quarto Wizard: Clear GitHub Token` command to remove stored token.
- feat: add command descriptions to all commands for improved discoverability.

#### Settings

- feat: add `quartoWizard.cache.ttlMinutes` setting to configure cache duration.
- feat: add `quartoWizard.registry.url` setting to configure custom registry URL.

### Documentation

- docs: add Quarto-based documentation website with user guide and API reference.
- docs: add API reference documentation generated from TypeDoc.
- docs: add reference pages for commands, configuration, and environment variables.

### Refactoring

- refactor: replace Quarto CLI calls with native archive extraction and GitHub API integration.
- refactor: migrate extension lifecycle operations (install, update, remove) to `@quarto-wizard/core`.
- refactor: add single-pass installation with callbacks for overwrite confirmation and version validation.
- refactor: improve authentication priority (manual token > VSCode session > environment variables).
- refactor: centralise error handling with typed error classes.
- refactor: use `InstalledExtension` type from core library instead of custom `ExtensionData` interface.
- refactor: consolidate tree provider caching into single structured cache object.
- refactor: extract reusable path resolution and source type detection utilities.
- refactor: remove sync/async function duplication in extensions utilities.

## 1.0.2 (2025-12-06)

- fix: ensure Quarto path validation properly awaits version check, add clear error messages with actionable buttons when Quarto CLI is not found, and implement detailed diagnostic logging for troubleshooting configuration issues.

## 1.0.1 (2025-10-27)

- fix: update is using "version" instead of tag.

## 1.0.0 (2025-10-20)

**Stable Release** - This project has reached stable status!

- No breaking changes from previous version.
- All existing functionality remains unchanged.

## 0.20.1 (2025-10-19)

- fix: prevent overwriting existing "source:" field in `_extension.yml` file (as it will come from `quarto add` command in the future).

## 0.20.0 (2025-10-14)

- feat: add "Reveal in Explorer" command for installed extensions.
- chore: polish code, comments, and documentation.

## 0.19.1 (2025-10-04)

- docs: add walkthroughs for Quarto Wizard features.

## 0.19.0 (2025-09-29)

- feat: add progress notification when updating or removing an extension from the Quarto Wizard Explorer view.
- feat: implement timeout handling for network and Quarto version checks.
- fix: drop `markdownlint` related code and settings.
- fix: enable extensions caching with 30-minute TTL for improved performance and reduced network requests.
- fix: migrate from `child_process.exec()` to `child_process.spawn()` for enhanced security and elimination of command injection risks.
- fix: optimise tree view refresh operations to eliminate duplicate calls and ensure automatic updates after all actions.
- fix: resolve promise properly when workspace folder is empty in `installQuartoExtension()` function.
- refactor: Convert remaining forEach to functional array methods.
- chore: polish code, comments, and documentation.
- chore: update dependencies to latest versions.
- chore: optimise `README.md` images.
- chore: remove outdated test verification script.

## 0.18.6 (2025-05-02)

- fix: ensure update check occurs after installing, updating, or removing an extension.

## 0.18.5 (2025-04-25)

- feat: use error code from Quarto CLI >= 1.7.23 when installing an extension.

## 0.18.4 (2025-04-17)

- fix: handle undefined source in repository field for extension tree

## 0.18.3 (2025-04-12)

- chore: no user-facing changes.

## 0.18.2 (2025-04-12)

- fix: proper handling of extension source with default tag

## 0.18.1 (2025-04-03)

- fix: strip tag from source URL in `/use?repo=<repository>` handler.

## 0.18.0 (2025-04-03)

- feat: add `/use?repo=<repository>` URI handler for installing Quarto extensions templates from the browser.
- feat: enhance URI handling for Quarto extensions.
- feat: enhance Quarto extension installation and template handling.
- feat: documentation for Quarto commands.
- feat: support extension tags in default Quarto installation.

## 0.17.0 (2025-03-31)

- feat: support installing/using Quarto extensions templates.
- fix: correct typo in short title of the `quartoWizard.installExtension` command.

## 0.16.2 (2025-03-22)

- refactor: update to reflect changes in <https://github.com/mcanouil/quarto-extensions>.

## 0.16.1 (2025-03-17)

- fix: GitHub icon / "open source" visibility for tree elements without source.

## 0.16.0 (2025-03-15)

## 0.15.2 (2025-03-12)

- feat: add a welcome view in the Quarto Wizard Explorer.
- feat: handle empty workspace(s) in the explorer view.
- feat: add workspace folder install context command.
- fix: disable "blanks-around-fenced-divs" rule by default.
- refactor(src/utils/workspace.ts): use `vscode.WorkspaceFolderPickOptions()` for workspace folder selection.
- docs: add a note about the "blanks-around-fenced-divs" rule in the README.

## 0.15.1 (2025-03-10)

- fix: tweak `markdownlint` extension activation and trigger to avoid linting issues.

## 0.15.0 (2025-03-09)

- feat: add support for multi-root workspaces ([#102](https://github.com/mcanouil/quarto-wizard/issues/102)).
- feat: implement workspace folder selection utility ([#100](https://github.com/mcanouil/quarto-wizard/issues/100), [#101](https://github.com/mcanouil/quarto-wizard/issues/101)).

## 0.14.2 (2025-03-06)

- feat: add custom "markdownlint" rules: "blanks-around-fenced-divs".
- fix: set "markdownlint" linting to "on type" by default.
- chore: remove a `console.log()` statement.

## 0.14.1 (2025-02-23)

- feat: improve the SVG icon.

## 0.14.0 (2025-02-22)

- feat: add URI handler for installing Quarto extensions from the browser.  
  `vscode://mcanouil.quarto-wizard/install?repo=mcanouil/quarto-iconify`

## 0.13.0 (2025-02-22)

- feat: allow to disable the automatic markdown linting via `markdownlint` with a "never" option.
- refactor(lintOnEvent): use `switch` instead of `if`.
- refactor: Use truthy checks instead for better readability..

## 0.12.0 (2025-02-21)

- feat: automatic markdown linting via `markdownlint`.
- feat: lazy extension dependencies.

## 0.11.0 (2025-02-20)

- feat: first release of the Quarto Wizard extension, but not yet 1.0.0.

## 0.10.1 (2025-02-20)

- chore: no user-facing changes.

## 0.10.0 (2025-02-20)

- refactor: no longer use `quarto remove` to uninstall an extension.

## 0.9.0 (2025-02-20)

- refactor: use a pre-fetched list of Quarto extensions for the QuickPick UI.
- refactor: drop GitHub authentication requirement for the extension details.
- refactor: change log level for cached extensions messages.
- refactor: implement debounced logging for extension fetching via fetchExtensions()
- feat: add activation log message for Quarto Wizard.

## 0.8.1 (2025-02-20)

- fix: prevent error notification when extension details cannot be retrieved.

## 0.8.0 (2025-02-18)

- feat: retrieve and display extensions details from GitHub API.
- feat: add more details in QuickPick UI for extensions.
- feat: set `log` to `true` for output channel, allowing colouring.
- feat: add Quarto extensions update check.
- fix: activate `quarto-wizard-explorer` view only in a workspace.
- refactor: use constants variables for cache name and expiration time.
- refactor: use `logMessage` function to log messages.
- refactor: add a log level parameter to `logMessage` function.
- docs: add GitHub account authentication as a requirement.
- docs: update README.md with new features and usage instructions.
- chore(CITATION.cff): add citation file.
- chore: update TypeScript configuration settings.
- chore: add basic Dev Container setup.
- ci: bump version via GitHub Actions input.
- docs: add JSDoc comments for utility functions and commands.

## 0.7.2 (2025-02-06)

- fix(src/ui/extensionsQuickPick.ts): broken extensions install by updating description handling in QuickPick UI.
- deps: update dependencies to latest.

## 0.7.1 (2025-02-02)

- feat: add "activationEvents" to `package.json` to avoid unnecessary activation.
- fix: GitHub button in QuickPick UI opens again the repository in the default browser.

## 0.7.0 (2025-01-30)

- refactor(src/utils/network.ts): internal logging.
- refactor(src/utils/extensions.ts): externalise Quick Pick UI tools.
- refactor: use constants for log messages target.
- fix(src/utils/extensions.ts): caching of the list of available Quarto extensions.
- fix(src/utils/extensions.ts): update cache expiration time for extensions list and display in log as ISO string.
- fix: harmonise log and notification messages.
- chore: use webpack to bundle the extension.

## 0.6.0 (2025-01-24)

- feat(package.json): add a "Quarto Wizard" menu in Explorer and Editor context menus.
- fix(src/utils/reprex.ts): `Quarto Wizard: Quarto Reproducible Document` command no longer set filename.
- fix(README.md): update commands and usage instructions.

## 0.5.5 (2025-01-21)

- chore: no changes.

## 0.5.4 (2025-01-21)

- chore: no changes.

## 0.5.3 (2025-01-21)

- fix: duplication of recently installed extensions in search results.
- fix: add information and error notifications when updating and removing an extension.
- refactor: add `showLogsCommand()` function to display a link to the output log in the notification.

## 0.5.2 (2025-01-19)

- fix: add source after updating an extension.
- refactor: add `installQuartoExtensionSource` to contain the logic to install an extension and add the source.

## 0.5.1 (2025-01-19)

- fix(.vscodeignore): remove wrong entry.

## 0.5.0 (2025-01-19)

- feat: add view to display and to manage the Quarto extensions installed.
- feat(checkQuartoPath): better check for the Quarto CLI path.
- refactor(utils/extensions.ts): externalise user prompts to a separate module (`utils/ask.ts`).
- refactor: update and correct trust authors and confirm installations prompts option value, _i.e._, `Yes, always trust`.
- refactor(extension.ts): don't use temporary variables for commands.

## 0.4.2 (2025-01-05)

- feat: add command `Quarto Wizard: New Reproducible Document` to create a new Quarto document in "new File" menu.
- refactor: use "category" instead of hardcoding `Quarto Wizard:` in the command title.

## 0.4.1 (2025-01-04)

- feat(assets/templates): add bibliography reference to the templates.

## 0.4.0 (2025-01-04)

- feat(README.md): add usage instructions for `Quarto Wizard: New Reproducible Document`.
- feat: add settings to specify the Quarto CLI path (`quartoWizard.quarto.path`).
- feat: add settings to control user prompts for trusting authors and confirming installations (`quartoWizard.ask.trustAuthors`, `quartoWizard.ask.confirmInstall`).
- feat: introduce prompts for users to trust authors and confirm installations, with a "Never ask again" option to update settings accordingly.
- feat: enhance the extension installation process to update `_extension.yml` with the source repository (i.e., `source: <repository>`), ensuring future updates.
- fix(README.md): remove duplicated command prefix.
- style: format code with Prettier.
- ci: allow anything after version number header in CHANGELOG.md.

## 0.3.0 (2024-11-19)

- feat: add command `Quarto Wizard: New Reproducible Document` to create a new Quarto document. ([#6](https://github.com/mcanouil/quarto-wizard/pull/6))
- refactor: replace "see details" with "show logs" in notification messages. ([#5](https://github.com/mcanouil/quarto-wizard/pull/5))

## 0.2.1 (2024-11-18)

- docs: update README.md with updated usage instructions.

## 0.2.0 (2024-11-18)

- feat: cache the list of available Quarto extensions (CSV) for twelve hours.
- feat: add command `Quarto Wizard: Clear Recently Installed Extensions` to remove the list of recently installed extensions.
- fix: `Quarto Wizard: Install Extension(s)` errors if no workspace/folder is open. ([#4](https://github.com/mcanouil/quarto-wizard/pull/4))
- refactor: split `extension.ts` into multiple files.
- refactor: rename `quartoExtensions` to `quartoWizard`.
- refactor: update commands prefix from `Quarto` to `Quarto Wizard`.
- ci: publish to Open VSX Registry. ([#3](https://github.com/mcanouil/quarto-wizard/pull/3))

## 0.1.0 (2024-11-16)

- Initial release of Quarto Wizard extension.
- feat: add command `Quarto: Install Extension(s)` to open the extension installer interface.
- feat: add command `Quarto: Show Quarto Wizard Output` to display the output log for the extension.
