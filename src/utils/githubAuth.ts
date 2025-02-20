import * as vscode from "vscode";
import * as Octokit from "@octokit/rest";
// import { QW_AUTH_PROVIDER_ID, QW_AUTH_PROVIDER_SCOPES } from "../constants";

/**
 * GitHub authentication provider ID.
 */
export const QW_AUTH_PROVIDER_ID = "github";

/**
 * Scopes for the GitHub authentication provider.
 * "no scope" = Grants read-only access to public information.
 * The GitHub Authentication Provider accepts the scopes described here:
 * https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/
 */
export const QW_AUTH_PROVIDER_SCOPES: string[] = [];

/**
 * Manages GitHub authentication and provides an authenticated Octokit instance.
 */
export class Credentials {
	private octokit: Octokit.Octokit | undefined;

	/**
	 * Initialises the credentials by registering listeners and setting up Octokit.
	 * @param context - The extension context.
	 */
	async initialise(context: vscode.ExtensionContext): Promise<void> {
		this.registerListeners(context);
		await this.setOctokit();
	}

	/**
	 * Sets up the Octokit instance using the current authentication session.
	 * @returns The Octokit instance.
	 */
	private async setOctokit() {
		const session = await vscode.authentication.getSession(QW_AUTH_PROVIDER_ID, QW_AUTH_PROVIDER_SCOPES, {
			createIfNone: false,
		});

		if (session) {
			this.octokit = new Octokit.Octokit({
				auth: session.accessToken,
			});
		}

		return this.octokit;
	}

	/**
	 * Registers listeners for authentication session changes.
	 * @param context - The extension context.
	 */
	registerListeners(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			vscode.authentication.onDidChangeSessions(async (e) => {
				if (e.provider.id === QW_AUTH_PROVIDER_ID) {
					await this.setOctokit();
				}
			})
		);
	}

	/**
	 * Gets the Octokit instance, creating a new authentication session if necessary.
	 * @returns The Octokit instance.
	 */
	async getOctokit(): Promise<Octokit.Octokit> {
		if (this.octokit) {
			return this.octokit;
		}
		const session = await vscode.authentication.getSession(QW_AUTH_PROVIDER_ID, QW_AUTH_PROVIDER_SCOPES, {
			createIfNone: true,
		});

		this.octokit = new Octokit.Octokit({
			auth: session.accessToken,
		});

		return this.octokit;
	}
}
