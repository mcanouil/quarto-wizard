# Quarto Wizard <img src="assets/logo/logo.png" align="right" width="120" />

## Overview

The **Quarto Wizard** extension is a Visual Studio Code extension that helps you manage your Quarto projects.
It allows you to easily install Quarto extensions directly from the [Quarto Extensions Repository](https://github.com/mcanouil/quarto-wizard).
This extension provides a user-friendly interface to browse, select, and install Quarto extensions, enhancing your Quarto development experience.

## Requirements

- **Check Internet Connection**: Ensure you have an active internet connection before installing extensions.
- **Check Quarto Installation**: Verify that Quarto is installed and available in your system's PATH.

## Commands

- `Quarto: Install Extension(s)`: Opens the extension installer interface.
  - **Browse Extensions**: View a list of available Quarto extensions.  
    ![List of extensions](assets/images/install-extensions.png)
  - **Install Extensions**: Install selected Quarto extensions with a single click.
- `Quarto: Show Quarto Wizard Output`: Displays the output log for the extension installer.

## Usage

### Install Quarto Extensions

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
2. Type `Quarto: Install Extension(s)` and select it.
3. Browse the list of available Quarto extensions.
4. Select the Quarto extension(s) you want to install.
5. Answer the prompts to confirm the installation.

### Show Quarto Wizard Output

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
2. Type `Quarto: Show Quarto Wizard Output` and select it.
3. View the output log for the Quarto Wizard extension.
4. Use the output log to troubleshoot any issues.

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

4. Compile the extension:

   ```sh
   npm run compile
   ```

5. Type `Tasks: Run Task` and select `Setup Debug`.

6. Launch the extension:

   - Press `F5` to open a new VS Code window with the extension loaded.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on the [GitHub repository](https://github.com/mcanouil/quarto-wizard).

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE) file for details.
