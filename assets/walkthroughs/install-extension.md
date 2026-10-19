# Install Quarto Extensions

Quarto Wizard gives you access to the Quarto extensions of the community.

## How to Install Extensions

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run **"Quarto Wizard: Install Extensions"**.
3. Select a source: Registry, GitHub, URL or Local.
4. Browse and select the extensions.
5. Choose the workspace folder and confirm the installation.

You can also select **Install Extensions** on a folder in the Explorer View.
Quarto Wizard then installs into that folder and does not ask you to choose one.

[Install Extensions](command:quartoWizard.installExtension)

An extension from GitHub or from the registry installs its latest tag, or the latest commit of the default branch when the repository has no tags.
Quarto Wizard records that tag or commit in `_extension.yml`, so you can update or reinstall the extension later.

[Full guide](https://m.canouil.dev/quarto-wizard/getting-started/installing-extensions.html)
