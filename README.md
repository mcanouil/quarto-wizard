# Quarto Wizard <img src="assets/logo/logo.png" align="right" width="120" alt="A cartoon-style illustration of a dog dressed as a wizard, holding a glowing wand. The dog is wearing a pointed hat and a robe with red accents, set against a background filled with magical symbols." />

[![GitHub Release](https://img.shields.io/github/v/release/mcanouil/quarto-wizard?style=flat-square&include_prereleases&label=Version)](https://github.com/mcanouil/quarto-wizard/releases/latest)
[![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/mcanouil.quarto-wizard?style=flat-square&color=333333&label=Visual%20Studio%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=mcanouil.quarto-wizard)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/mcanouil/quarto-wizard?style=flat-square&color=333333&label=Open%20VSX)](https://open-vsx.org/extension/mcanouil/quarto-wizard)
[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/mcanouil/quarto-wizard/total?style=flat-square&label=GitHub&color=333333)](https://github.com/mcanouil/quarto-wizard/releases/latest)

## Overview

**Quarto Wizard** is a Visual Studio Code extension that helps you manage your [Quarto](https://quarto.org) projects.
It allows you to easily install Quarto extensions from the [Quarto Extensions](https://m.canouil.dev/quarto-extensions/) registry, GitHub repositories, URLs, or local paths.
This extension provides a user-friendly interface to browse, select, and install Quarto extensions, enhancing your Quarto development experience.

## Key Features

- Browse and install Quarto extensions from Registry, GitHub, URL, or Local sources.
- Use dedicated install commands for each source (including `owner/repo@version` on GitHub).
- Manage installed extensions from the Explorer view (update, reinstall, remove, reveal, open source).
- Inspect extension schema metadata and insert extension snippets from the Explorer view.
- Batch-manage extensions with "Update All", "Remove Multiple", and cache refresh.
- Use Quarto templates with target subdirectory support and file selection.
- Use Quarto brands from GitHub, URL, or local sources.
- Create reproducible documents for R, Python, or Julia.
- Support for private GitHub repositories with authentication.

## Install Quarto Extensions

1. Open the Command Palette and run `Quarto Wizard: Install Extensions`.
2. Choose a source: **Registry**, **GitHub**, **URL**, or **Local**.
3. Select one or more extensions and confirm installation.

You can also skip the source picker with:

- `Quarto Wizard: Install Extension from Registry`
- `Quarto Wizard: Install Extension from GitHub`
- `Quarto Wizard: Install Extension from URL`
- `Quarto Wizard: Install Extension from Local`

For full install options (including local archives and version validation), see [Installing Extensions](https://m.canouil.dev/quarto-wizard/getting-started/installing-extensions.html).

## Quarto Wizard Explorer View

Use the **Extensions Installed** Explorer view to:

- Check installed extension status and available updates.
- Update one extension or all outdated extensions.
- Remove one or multiple extensions.
- Inspect schema contributions (options, shortcodes, formats, projects, and element attributes).
- Insert extension snippets directly into the active editor.

See [Explorer View](https://m.canouil.dev/quarto-wizard/getting-started/explorer-view.html) for details.

## Use Quarto Templates

Run `Quarto Wizard: Use Template`, choose a source, then select template files to copy.
You can optionally set a target subdirectory for copied files.

See [Using Templates](https://m.canouil.dev/quarto-wizard/getting-started/using-templates.html).

## Use Quarto Brand

Run `Quarto Wizard: Use Brand`, choose a source (**GitHub**, **URL**, or **Local**), and apply brand assets to your project.
Brand files are installed in `_brand/`.

See [Using Brands](https://m.canouil.dev/quarto-wizard/getting-started/installing-extensions.html#using-brands).

## Installation

Search for "Quarto Wizard" in the VS Code/Positron Extensions view and click **Install**.

For other installation methods, see the [Installation Guide](https://m.canouil.dev/quarto-wizard/getting-started/installation.html).

## Documentation

Full documentation is available at **[m.canouil.dev/quarto-wizard](https://m.canouil.dev/quarto-wizard/)**.

- [Getting Started](https://m.canouil.dev/quarto-wizard/getting-started/) - Installation, usage, and troubleshooting.
- [Commands Reference](https://m.canouil.dev/quarto-wizard/reference/commands.html) - Commands.
- [Configuration](https://m.canouil.dev/quarto-wizard/reference/configuration.html) - Available settings, defaults, and workspace scope.
- [Extension Schema Specification](https://m.canouil.dev/quarto-wizard/reference/schema-specification.html) - For extension developers: `_schema.yml` format for hover details, suggestions, and validation.
- [Extension Snippet Specification](https://m.canouil.dev/quarto-wizard/reference/snippet-specification.html) - For extension developers: `_snippets.json` format for snippet suggestions and insertion.

## Getting Help

If you experience issues or have questions:

1. **Check the output log**: `Quarto Wizard: Show Quarto Wizard Log Output`.
2. **Search existing discussions and issues**: [GitHub Discussions](https://github.com/mcanouil/quarto-wizard/discussions) and [GitHub Issues](https://github.com/mcanouil/quarto-wizard/issues).
3. **Ask a question or share feedback**: Use the [Discussion chooser](https://github.com/mcanouil/quarto-wizard/discussions/new/choose) to select the appropriate category.
4. **Report a bug**: Use the [Issue chooser](https://github.com/mcanouil/quarto-wizard/issues/new/choose) to create a bug report with the provided template.

> [!TIP]
> Please use the chooser menus to select the right place for your request.
> This ensures efficient handling and helps maintainers respond appropriately.

## Verifying Release Asset Build Provenance

To ensure the authenticity and integrity of the release asset, use GitHub CLI to verify its build provenance.

```bash
gh attestation verify quarto-wizard-<version>.vsix --repo mcanouil/quarto-wizard
```

## Development

1. Clone the repository:

   ```sh
   git clone https://github.com/mcanouil/quarto-wizard
   ```

2. Open the project in Visual Studio Code.

3. Install the dependencies:

   ```sh
   npm install
   ```

4. Launch the extension:
   - Press `F5` to open a new Visual Studio Code window with the extension loaded.

## Contributing

Contributions are welcome!
Please open an issue or submit a pull request on the [GitHub repository](https://github.com/mcanouil/quarto-wizard).

## Credits

Quarto Wizard is developed by [Mickaël CANOUIL](https://github.com/mcanouil) ([mickael.canouil.fr](https://mickael.canouil.fr)).

- Built for the [Quarto CLI](https://quarto.org) ecosystem.
- Extension registry: [Quarto Extensions](https://m.canouil.dev/quarto-extensions/).
- [All contributors](https://github.com/mcanouil/quarto-wizard/graphs/contributors).

[Full credits](https://m.canouil.dev/quarto-wizard/credits.html).

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE) file for details.

## Disclaimer

This extension is not affiliated with or endorsed by [Quarto](https://quarto.org) or its maintainers.
