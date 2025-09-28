# Changelog

## Unreleased

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
