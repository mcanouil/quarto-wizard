# Quarto Wizard <img src="assets/logo/logo.png" align="right" width="120" alt="A cartoon-style illustration of a dog dressed as a wizard, holding a glowing wand. The dog is wearing a pointed hat and a robe with red accents, set against a background filled with magical symbols." />

![GitHub Release](https://img.shields.io/github/v/release/mcanouil/quarto-wizard?style=flat-square&include_prereleases&label=Version)
[![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/mcanouil.quarto-wizard?style=flat-square&color=333333&label=Visual%20Studio%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=mcanouil.quarto-wizard)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/mcanouil/quarto-wizard?style=flat-square&color=333333&label=Open%20VSX)](https://open-vsx.org/extension/mcanouil/quarto-wizard)
[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/mcanouil/quarto-wizard/total?style=flat-square&color=333333&label=GitHub)](https://github.com/mcanouil/quarto-wizard/releases/latest)

## Overview

**Quarto Wizard** is a Visual Studio Code extension that helps you manage your [Quarto](https://quarto.org) projects.  
It allows you to easily install Quarto extensions directly from the [Quarto Extensions](https://github.com/mcanouil/quarto-extensions) listing repository.  
This extension provides a user-friendly interface to browse, select, and install Quarto extensions, enhancing your Quarto development experience.  
Additionally, it offers a set of commands to create new Quarto documents that you can use as a starting point for your bug reports, feature requests, or any other Quarto-related content.

- [Overview](#overview)
- [Installation](#installation)
  - [VS Code Marketplace](#vs-code-marketplace)
  - [Command Line](#command-line)
  - [Manual Installation](#manual-installation)
- [Requirements](#requirements)
- [Commands](#commands)
- [Usage](#usage)
  - [Quarto Wizard Explorer View](#quarto-wizard-explorer-view)
  - [Explorer/Editor Context Menu](#explorereditor-context-menu)
  - [Install Quarto Extensions](#install-quarto-extensions)
  - [Use Quarto Templates](#use-quarto-templates)
  - [Create a New Reproducible Document](#create-a-new-reproducible-document)
  - [Show Quarto Wizard Output](#show-quarto-wizard-output)
- [Configuration](#configuration)
  - [Available Settings](#available-settings)
    - [Extension Installation Behaviour](#extension-installation-behaviour)
    - [Quarto CLI Configuration](#quarto-cli-configuration)
- [Getting Help](#getting-help)
- [Verifying Release Asset Build Provenance](#verifying-release-asset-build-provenance)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

## Installation

### VS Code Marketplace

1. Open Visual Studio Code/Positron.
2. Go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X` on macOS).
3. Search for "Quarto Wizard".
4. Click **Install** on the extension.

### Command Line

- Visual Studio Code:

```bash
code --install-extension mcanouil.quarto-wizard
```

- Positron:

```bash
positron --install-extension mcanouil.quarto-wizard
```

### Manual Installation

1. Download the latest `.vsix` file from the [GitHub Releases](https://github.com/mcanouil/quarto-wizard/releases).
2. In VS Code, open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
3. Run `Extensions: Install from VSIX...`.
4. Select the downloaded `.vsix` file.

## Requirements

- **Check Internet Connection**: Ensure you have an active internet connection before installing extensions.
- **Check Quarto Installation**: Verify that Quarto is installed and available in your system's PATH.

## Commands

- `Quarto Wizard: Install Extensions`: Opens the extension installer interface.
  - **Browse Extensions**: View a list of available Quarto extensions.
    <p>
      <img
        src="docs/assets/images/install-extensions.png"
        alt='This image displays a search results interface for Quarto extensions authored by the user "mcanouil". It lists various extensions, including their names, version numbers, star ratings, and brief descriptions. The search highlights extensions such as Animate, Div Reuse, Elevator, Github, Highlight Text, Iconify, Invoice, and Letter, showcasing diverse functionalities ranging from animated content to document styling and templates for invoices and letters. The purpose of the image is to present a concise overview of available extensions along with their popularity and license information for Quarto users.'
        width="400"
      />
    </p>
  - **Install Extensions**: Install selected Quarto extensions with a single click.
- `Quarto Wizard: Use Template`: Opens the template installer interface.
  - **Browse Templates**: View a list of available Quarto templates from Quarto Extensions.
    <p>
      <img
        src="docs/assets/images/use-template.png"
        alt='This image showcases a menu of Quarto extension templates available for selection. It lists templates like "LETTER," "ACADEMIC TYPST," "ACM," "ACS," and others, each with details such as version, number of stars, repository link, and license type. The "LETTER" template is highlighted, suggesting recent usage. This visual serves as a practical guide for users looking to choose and apply specific Quarto templates effectively.'
        width="400"
      />
    </p>
  - **Install Templates**: Install selected Quarto template with a single click.
- `Quarto Wizard: Clear Recently Installed Extensions`: Clears the list of recently installed extensions.
- `Quarto Wizard: Show Quarto Wizard Log Output`: Displays the output log for the extension installer.
- `Quarto Wizard: Quarto Reproducible Document`: Creates a new Quarto document.
  - [`R`](/assets/templates/r.qmd)
  - [`Python`](assets/templates/python.qmd)
  - [`Julia`](assets/templates/julia.qmd)
- `Quarto Wizard: Focus on Extensions Installed View`: Opens the Quarto Wizard view to display and manage the Quarto extensions installed.

## Usage

### Quarto Wizard Explorer View

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
2. Type `Quarto Wizard: Focus on Extensions Installed View` and select it.  
   Or click on the Quarto Wizard icon in the Activity Bar.
   <p align="center">
     <img
       src="docs/assets/images/explorer-view.png"
       alt="This image showcases the Quarto Wizard extension interface within Visual Studio Code. It highlights features like the workspace view, extension management options for adding, removing, or updating extensions, as well as template usage and GitHub repository access. The interface also illustrates the Quarto Wizard Explorer section, with annotations using coloured arrows and text to explain specific functionalities. Two workspaces are displayed: one with installed extensions labelled wizard-dev, and another without installed extensions labelled quarto-playground. This visual guide serves users looking to manage Quarto extensions in Visual Studio Code effectively."
       width="600"
     />
   </p>

Or click on the Quarto Wizard icon in the Activity Bar.

_Quarto Wizard Explorer View in action:_

<p align="center">
  <video
    controls
    src="https://github.com/user-attachments/assets/6ea42fb5-a749-4df8-9de3-7038a148ea4d"
    title="Wizard Explorer View in action"
    alt="A video showcasing the Quarto Wizard Explorer View in action, highlighting its capability to detect updates based on GitHub tags/releases."
    width=600
  >
  </video>
</p>

> [!IMPORTANT]
> Quarto extensions can only be updated if installed by Quarto Wizard (_i.e._, if `source: <owner>/<repository>` is present in `_extension.yml`).
> You can manually add the source to the extension's `_extension.yml` file to enable updates.

### Explorer/Editor Context Menu

- Right-click in the Explorer or Editor to access the following commands:
  - `Install Extensions`.
  - `Use Template` (_Only retrieves the Quarto document. For other resources, please use `quarto use template` manually_).
  - `Quarto Reproducible Document`.
  - `Show Quarto Wizard Log Output`.
  - `Clear Recently Installed Extensions`.

<p align="center">
  <img
    src="docs/assets/images/explorer-context.png"
    alt='This image presents a context menu within Visual Studio Code. The menu displays options such as "Install Extensions," "Use Template", "Quarto Reproducible Document", and more. The "Quarto Wizard" option is highlighted. This visual aids users in navigating and utilising Quarto tools effectively within their workspace.'
    width="400"
  />
</p>

### Install Quarto Extensions

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
2. Type `Quarto Wizard: Install Extensions` and select it.
3. Browse the list of available Quarto extensions.
4. Select the Quarto extension(s) you want to install.
5. Answer the prompts to confirm the installation.

> [!NOTE]
> Quarto Wizard can only display available information, _i.e._, if the author of an extension has not provided a description, license, and/or used tags for release versions, these fields will be populated with `none`.

### Use Quarto Templates

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
2. Type `Quarto Wizard: Use Template` and select it.
3. Browse the list of available Quarto templates.
4. Select the Quarto template you want to use.
5. Answer the prompts to confirm the installation.

### Create a New Reproducible Document

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
2. Type `Quarto Wizard: Quarto Reproducible Document` and select it.
3. Choose the template for the new Quarto document.

### Show Quarto Wizard Output

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
2. Type `Quarto Wizard: Show Quarto Wizard Log Output` and select it.
3. View the output log for the Quarto Wizard extension.
4. Use the output log to troubleshoot any issues.

## Configuration

The Quarto Wizard extension can be configured through VS Code settings.
Access these through:

- **File** > **Preferences** > **Settings** (or **Code** > **Preferences** > **Settings** on macOS).
- Search for "Quarto Wizard".

### Available Settings

#### Extension Installation Behaviour

```json
{
	"quartoWizard.ask.trustAuthors": "ask",
	"quartoWizard.ask.confirmInstall": "ask"
}
```

- `quartoWizard.ask.trustAuthors`: Control prompts for trusting extension authors
  - `"ask"`: Ask each time (default).
  - `"yes"`: Always trust.
  - `"never"`: Never ask.
- `quartoWizard.ask.confirmInstall`: Control installation confirmation prompts
  - `"ask"`: Ask each time (default).
  - `"yes"`: Auto-confirm.
  - `"never"`: Never ask.

#### Quarto CLI Configuration

```json
{
	"quartoWizard.quarto.path": "/usr/local/bin/quarto"
}
```

- `quartoWizard.quarto.path`: Specify custom path to Quarto CLI executable.

## Getting Help

If you experience issues:

1. **Check the output log**: `Quarto Wizard: Show Quarto Wizard Log Output`
2. **Search existing issues**: [GitHub Issues](https://github.com/mcanouil/quarto-wizard/issues)
3. [**Report a bug**](https://github.com/mcanouil/quarto-wizard/issues/new?template=bug.yml): Create a new issue following the provided template.

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

Contributions are welcome! Please open an issue or submit a pull request on the [GitHub repository](https://github.com/mcanouil/quarto-wizard).

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE) file for details.

## Disclaimer

This extension is not affiliated with or endorsed by [Quarto](https://quarto.org) or its maintainers.
