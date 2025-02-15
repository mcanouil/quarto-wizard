import * as vscode from "vscode";

export const QUARTO_WIZARD_LOG = vscode.window.createOutputChannel("Quarto Wizard");
export const QUARTO_WIZARD_RECENTLY_INSTALLED = "recentlyInstalledExtensions";
export const QUARTO_WIZARD_EXTENSIONS =
	"https://raw.githubusercontent.com/mcanouil/quarto-extensions/main/extensions/quarto-extensions.csv";

export const GITHUB_AUTH_PROVIDER_ID = "github";
export const GITHUB_AUTH_PROVIDER_SCOPES: string[] = [];
