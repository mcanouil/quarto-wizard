# Sign In to GitHub

Quarto Wizard checks GitHub for new extension tags when you are signed in.
Without a sign-in, it checks the registry, which can be a little behind GitHub.

Sign in to also install extensions from private repositories and to avoid GitHub rate limits.

## How to Sign In

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run **"Quarto Wizard: Sign In with GitHub Session"**.
3. Allow the access that VS Code asks for.

[Sign In with GitHub Session](command:quartoWizard.signInWithGitHubSession)

## Other Options

- Run **"Quarto Wizard: Set GitHub Token (Manual)"** to use a personal access token.
- Set the `GITHUB_TOKEN` or `QUARTO_WIZARD_TOKEN` environment variable.

[Set GitHub Token (Manual)](command:quartoWizard.setGitHubToken)

This step is optional.
Skip it if you only use public extensions.

[Full guide](https://m.canouil.dev/quarto-wizard/getting-started/installation.html#optional-github-authentication)
