import * as fs from "node:fs";
import * as path from "node:path";

/** The repository root, where `package.json` lives. */
export const REPOSITORY_ROOT = path.resolve(__dirname, "../../..");

/** The parts of the extension manifest that the tests read. */
export interface PackageJson {
	contributes: {
		commands: { command: string }[];
		menus: { "view/item/context": { command: string; when: string; group: string }[] };
		walkthroughs: { steps: { id: string; media: { image?: string; markdown?: string } }[] }[];
	};
}

/** Reads the extension manifest from the repository root. */
export function readPackageJson(): PackageJson {
	return JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf8")) as PackageJson;
}
