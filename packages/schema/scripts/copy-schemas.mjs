import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const repoRoot = join(pkgRoot, "..", "..");

const versions = [
	{ src: "extension-schema.json", out: join("v1", "extension-schema.json") },
	{ src: "extension-schema-v2.json", out: join("v2", "extension-schema.json") },
];

const distValidation = join(pkgRoot, "dist", "validation");
mkdirSync(distValidation, { recursive: true });

const docsBase = join(repoRoot, "docs", "assets", "schema");

for (const { src, out } of versions) {
	const srcPath = join(pkgRoot, "src", "validation", src);
	cpSync(srcPath, join(distValidation, src));
	const docsTarget = join(docsBase, out);
	mkdirSync(dirname(docsTarget), { recursive: true });
	cpSync(srcPath, docsTarget);
}

// The Lua reference validator is published for other projects to depend on, so
// it goes to the documentation site only. It is not part of the library API, and
// nothing consumes it from the npm tarball.
const luaTarget = join(docsBase, "v2", "schema.lua");
mkdirSync(dirname(luaTarget), { recursive: true });
cpSync(join(pkgRoot, "src", "validation", "schema.lua"), luaTarget);
