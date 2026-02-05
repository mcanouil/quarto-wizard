## Install from GitHub Release

For detailed installation instructions, see the [Installation Guide](${DOCS_URL}/getting-started/installation.html).

```powershell
$VERSION = "${WIZARD_VERSION}"
gh release download "$VERSION" --repo ${REPO} --pattern "*.vsix"
gh attestation verify "quarto-wizard-$VERSION.vsix" --repo ${REPO}

# VS Code
code --install-extension "quarto-wizard-${WIZARD_VERSION}.vsix"
# Positron
positron --install-extension "quarto-wizard-${WIZARD_VERSION}.vsix"
```
