import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const repoRoot = join(pkgRoot, "..", "..");

// `dist` is omitted for the Lua reference validator: other projects depend on
// it through the documentation site, and nothing reads it from the npm tarball.
const published = [
	{ src: "extension-schema.json", docs: join("v1", "extension-schema.json"), dist: "extension-schema.json" },
	{ src: "extension-schema-v2.json", docs: join("v2", "extension-schema.json"), dist: "extension-schema-v2.json" },
	{ src: "schema.lua", docs: join("v2", "schema.lua") },
];

const srcValidation = join(pkgRoot, "src", "validation");
const distValidation = join(pkgRoot, "dist", "validation");
mkdirSync(distValidation, { recursive: true });

const docsBase = join(repoRoot, "docs", "assets", "schema");

for (const { src, docs, dist } of published) {
	const srcPath = join(srcValidation, src);
	if (dist) {
		cpSync(srcPath, join(distValidation, dist));
	}
	const docsTarget = join(docsBase, docs);
	mkdirSync(dirname(docsTarget), { recursive: true });
	cpSync(srcPath, docsTarget);
}
