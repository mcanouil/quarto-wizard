# Install Quarto Extensions

Quarto Wizard provides access to over 250 Quarto extensions from the community.

## How to Install Extensions

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Type **"Quarto Wizard: Install Extensions"**.
3. Select a source (Registry, GitHub, URL, or Local).
4. Browse and select extensions.
5. Confirm the installation.

You can also click the **Install** button in the Quarto Wizard Explorer View.

[Install Extensions](command:quartoWizard.installExtension)

Extensions are installed from GitHub releases/tags for stability and reproducibility.

## Private Repository Support

Quarto Wizard supports installing extensions from private GitHub repositories.
Configure authentication using one of:

- Manual token setup via **"Quarto Wizard: Set GitHub Token (Manual)"**.
- Environment variables (`GITHUB_TOKEN` or `QUARTO_WIZARD_TOKEN`).
- VS Code's built-in GitHub authentication (offered automatically on authentication errors).

[Set GitHub Token (Manual)](command:quartoWizard.setGitHubToken)

[Full guide](https://m.canouil.dev/quarto-wizard/getting-started/installing-extensions.html)
