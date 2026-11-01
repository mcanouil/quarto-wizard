/**
 * Fixture: a GitHub repository archive whose extensions, template and brand live in subdirectories.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as tar from "tar";

/** Tag the mocked download resolves to. */
export const SUBDIRECTORY_REPOSITORY_TAG = "v1.0.0";

/** Files of the repository, relative to its root. */
export const SUBDIRECTORY_REPOSITORY_FILES: Record<string, string> = {
	"README.md": "# Repository\n",
	"template.qmd": "root template\n",
	"_brand.yml": "color:\n  primary: root\n",
	"a/_extensions/x/_extension.yml": "title: X\nversion: 1.0.0\ncontributes:\n  filters:\n    - x.lua\n",
	"a/_extensions/x/x.lua": "-- x\n",
	"b/_extensions/y/_extension.yml": "title: Y\nversion: 1.0.0\ncontributes:\n  filters:\n    - y.lua\n",
	"b/_extensions/y/y.lua": "-- y\n",
	"b/template.qmd": "b template\n",
	"c/_extension.yml": "title: C\nversion: 1.0.0\ncontributes:\n  filters:\n    - c.lua\n",
	"c/c.lua": "-- c\n",
	"d/_brand.yml": "color:\n  primary: d\n",
};

/**
 * Write the repository as a GitHub source archive: a `.tar.gz` that wraps every file in a
 * single `repo-<tag>/` directory.
 *
 * Each call writes a new archive, because the install operation deletes the archive it was given.
 *
 * @param parentDir - Directory the caller removes after the test
 * @returns Path to the archive
 */
export async function createSubdirectoryRepositoryArchive(parentDir: string): Promise<string> {
	const workDir = fs.mkdtempSync(path.join(parentDir, "archive-"));
	const wrapper = `repo-${SUBDIRECTORY_REPOSITORY_TAG}`;
	for (const [relativePath, content] of Object.entries(SUBDIRECTORY_REPOSITORY_FILES)) {
		const fullPath = path.join(workDir, wrapper, relativePath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content);
	}
	const archivePath = path.join(workDir, "repo.tar.gz");
	await tar.create({ gzip: true, file: archivePath, cwd: workDir }, [wrapper]);
	return archivePath;
}
