import * as vscode from "vscode";
import * as Octokit from "@octokit/rest";
import { GITHUB_AUTH_PROVIDER_ID, GITHUB_AUTH_PROVIDER_SCOPES } from "../constants";

export class Credentials {
	private octokit: Octokit.Octokit | undefined;

	async initialise(context: vscode.ExtensionContext): Promise<void> {
		this.registerListeners(context);
		await this.setOctokit();
	}

	private async setOctokit() {
		const session = await vscode.authentication.getSession(GITHUB_AUTH_PROVIDER_ID, GITHUB_AUTH_PROVIDER_SCOPES, {
			createIfNone: false,
		});

		if (session) {
			this.octokit = new Octokit.Octokit({
				auth: session.accessToken,
			});

			return;
		}

		this.octokit = undefined;
	}

	registerListeners(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			vscode.authentication.onDidChangeSessions(async (e) => {
				if (e.provider.id === GITHUB_AUTH_PROVIDER_ID) {
					await this.setOctokit();
				}
			})
		);
	}

	async getOctokit(): Promise<Octokit.Octokit> {
		if (this.octokit) {
			return this.octokit;
		}
		const session = await vscode.authentication.getSession(GITHUB_AUTH_PROVIDER_ID, GITHUB_AUTH_PROVIDER_SCOPES, {
			createIfNone: true,
		});
		this.octokit = new Octokit.Octokit({
			auth: session.accessToken,
		});

		return this.octokit;
	}
}
