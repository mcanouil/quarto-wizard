# Changelog

## Unreleased

- feat: retrieve and display extensions details from GitHub API.
- feat: add more details in QuickPick UI for extensions.
- feat: set `log` to `true` for output channel, allowing colouring.
- feat: add Quarto extensions update check.
- fix: activate `quarto-wizard-explorer` view only in a workspace.
- refactor: use constants variables for cache name and expiration time.
- refactor: use `logMessage` function to log messages.
- refactor: add a log level parameter to `logMessage` function.
- docs: add GitHub account authentication as a requirement.
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
- refactor: update and correct trust authors and confirm installations prompts option value, *i.e.*, `Yes, always trust`.
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
