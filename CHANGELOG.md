# Changelog

## Development

- fix(README.md): remove duplicated command prefix.
- style: format code with Prettier.

## 0.3.0

- feat: add command `Quarto Wizard: New Reproducible Document` to create a new Quarto document.
- refactor: replace "see details" with "show logs" in notification messages.

## 0.2.1

- docs: update README.md with updated usage instructions.

## 0.2.0

- feat: cache the list of available Quarto extensions (CSV) for twelve hours.
- feat: add command `Quarto Wizard: Clear Recently Installed Extensions` to remove the list of recently installed extensions.
- fix: `Quarto Wizard: Install Extension(s)` errors if no workspace/folder is open. ([#4](https://github.com/mcanouil/quarto-wizard/pull/4))
- refactor: split `extension.ts` into multiple files.
- refactor: rename `quartoExtensions` to `quartoWizard`.
- refactor: update commands prefix from `Quarto` to `Quarto Wizard`.
- ci: publish to Open VSX Registry. ([#3](https://github.com/mcanouil/quarto-wizard/pull/3))

## 0.1.0

- Initial release of Quarto Wizard extension.
- feat: add command `Quarto: Install Extension(s)` to open the extension installer interface.
- feat: add command `Quarto: Show Quarto Wizard Output` to display the output log for the extension.
