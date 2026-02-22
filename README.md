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

- Browse and install Quarto extensions from the registry, GitHub, URLs, or local paths.
- Manage installed extensions with update detection.
- Use Quarto templates to quick-start projects.
- Create reproducible documents for R, Python, or Julia.
- Install extensions from local directories or archives.
- Support for private GitHub repositories with authentication.

## Installation

Search for "Quarto Wizard" in the VS Code/Positron Extensions view and click **Install**.

For other installation methods, see the [Installation Guide](https://m.canouil.dev/quarto-wizard/getting-started/installation.html).

## Documentation

Full documentation is available at **[m.canouil.dev/quarto-wizard](https://m.canouil.dev/quarto-wizard/)**.

- [Getting Started](https://m.canouil.dev/quarto-wizard/getting-started/) - Installation, usage, and troubleshooting.
- [Commands Reference](https://m.canouil.dev/quarto-wizard/reference/commands.html) - Commands.
- [Configuration](https://m.canouil.dev/quarto-wizard/reference/configuration.html) - Available configuration options.

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
