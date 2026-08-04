#!/usr/bin/env node
/**
 * Checks and applies Quarto extension updates across a directory tree.
 *
 * Every directory holding an `_extensions/` child is treated as a Quarto project
 * and handed to @quarto-wizard/core, so a workspace of repositories is updated in
 * one pass instead of one project at a time.
 *
 * `.quartoignore` is deliberately not consulted: it declares what `quarto use
 * template` leaves out of a generated project, which says nothing about whether
 * the installed extensions under that path should be kept up to date.
 *
 * Requires `npm run build:core`.
 *
 * Usage: node scripts/update-extensions.mjs [dir] [--source id] [--apply] [--refresh] [--cross-source] [--json] [--verbose]
 */

import { readdirSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corePath = join(__dirname, "..", "packages", "core", "dist", "index.js");

// Piping into `head` or `grep -q` closes stdout early; that is a normal way to
// read this report, not a failure worth a stack trace.
for (const stream of [process.stdout, process.stderr]) {
	stream.on("error", (error) => {
		if (error.code === "EPIPE") {
			process.exit(0);
		}
		throw error;
	});
}

/** Directories never worth descending into when looking for Quarto projects. */
const PRUNED_DIRS = new Set(["node_modules", ".git", "_site", "_freeze", ".quarto", "_extensions"]);

const USAGE = `Usage: node scripts/update-extensions.mjs [dir] [options]

  dir                Root directory to scan. Default: current directory.
  --source <id>      Only consider extensions installed from this source, as
                     recorded in _extension.yml: "mcanouil/quarto-iconify", or
                     just "quarto-iconify" to match any owner. Any "@version"
                     suffix is ignored.
  --apply            Apply the updates. Without it, only report what is available.
  --refresh          Refetch the registry before scanning, ignoring the cache.
  --cross-source     Let GitHub-sourced extensions fall back to the registry.
  --json             Emit a JSON report on stdout instead of text.
  --verbose          Also list extensions skipped for having no recorded source.
  --help             Show this message.
`;

function parseArguments(argv) {
	const options = {
		dir: null,
		source: null,
		apply: false,
		refresh: false,
		crossSource: false,
		json: false,
		verbose: false,
		help: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];

		if (argument === "--source" || argument.startsWith("--source=")) {
			const value = argument.startsWith("--source=") ? argument.slice("--source=".length) : argv[++index];
			if (!value) {
				throw new Error("--source requires a value, for example --source mcanouil/quarto-iconify");
			}
			options.source = value;
			continue;
		}

		switch (argument) {
			case "--apply":
				options.apply = true;
				break;
			case "--refresh":
				options.refresh = true;
				break;
			case "--cross-source":
				options.crossSource = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--verbose":
				options.verbose = true;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				if (argument.startsWith("-")) {
					throw new Error(`Unknown option: ${argument}`);
				}
				if (options.dir !== null) {
					throw new Error(`Unexpected extra argument: ${argument}`);
				}
				options.dir = argument;
		}
	}

	options.dir = resolve(options.dir ?? process.cwd());
	return options;
}

/**
 * Collect every directory below `root` (inclusive) that contains `_extensions/`.
 */
function findProjectRoots(root) {
	const roots = [];
	const queue = [root];

	while (queue.length > 0) {
		const current = queue.pop();

		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			// Unreadable directory: nothing to scan, and no reason to abort the walk.
			continue;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			if (entry.name === "_extensions") {
				roots.push(current);
				continue;
			}
			if (!PRUNED_DIRS.has(entry.name)) {
				queue.push(join(current, entry.name));
			}
		}
	}

	return roots.sort();
}

function formatId(id) {
	return id.owner ? `${id.owner}/${id.name}` : id.name;
}

/**
 * Build a predicate matching an installed extension against a source identifier.
 *
 * The identifier is the `source` recorded in `_extension.yml` without its version
 * ref, so `mcanouil/quarto-iconify` rather than the installed `mcanouil/iconify`.
 * A value without a slash matches the repository segment under any owner. An
 * extension with no recorded source never matches, since it has nothing to update
 * against.
 */
function createSourceMatcher(value, splitSourceRef) {
	const wanted = splitSourceRef(value.trim()).base.replace(/\/+$/, "").toLowerCase();

	if (!wanted) {
		throw new Error(`Invalid source: "${value}"`);
	}

	return (extension) => {
		const source = extension.manifest.source;
		if (!source) {
			return false;
		}

		// A source may carry a subdirectory ("owner/repo/subdir"); only the owner and
		// repository segments identify where updates come from.
		const [owner, repository] = splitSourceRef(source).base.toLowerCase().split("/");
		if (!repository) {
			return false;
		}

		return wanted.includes("/") ? `${owner}/${repository}` === wanted : repository === wanted;
	};
}

async function main() {
	const options = parseArguments(process.argv.slice(2));

	if (options.help) {
		process.stdout.write(USAGE);
		return 0;
	}

	if (!existsSync(corePath)) {
		process.stderr.write(
			`@quarto-wizard/core is not built (${corePath} is missing).\nRun \`npm run build:core\` first.\n`,
		);
		return 1;
	}

	const {
		checkForUpdates,
		applyUpdates,
		discoverInstalledExtensions,
		createAuthConfig,
		fetchRegistry,
		splitSourceRef,
	} = await import(pathToFileURL(corePath).href);

	const matchesSource = options.source === null ? null : createSourceMatcher(options.source, splitSourceRef);
	const auth = createAuthConfig();

	if (options.refresh) {
		// One forced fetch rewrites the on-disk cache, so the per-project checks below
		// all see fresh data without each of them hitting the network.
		try {
			await fetchRegistry({ auth, forceRefresh: true });
		} catch (error) {
			throw new Error(`Could not refresh the registry: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const roots = findProjectRoots(options.dir);
	const report = [];
	const totals = { roots: 0, extensions: 0, sourceless: 0, pending: 0, updated: 0, failed: 0 };

	for (const root of roots) {
		const label = relative(options.dir, root) || ".";
		const discovered = await discoverInstalledExtensions(root);
		const installed = matchesSource === null ? discovered : discovered.filter(matchesSource);

		// A project that does not carry the targeted source is not part of the report.
		if (installed.length === 0 && matchesSource !== null) {
			continue;
		}

		const sourceless = installed.filter((extension) => !extension.manifest.source);

		totals.roots += 1;
		totals.extensions += installed.length;
		totals.sourceless += sourceless.length;

		let updates;
		if (matchesSource === null) {
			updates = await checkForUpdates({ projectDir: root, auth, crossSource: options.crossSource });
		} else {
			// Check each match by its installed owner/name, which is what core addresses;
			// one source can be installed under more than one such id across projects.
			updates = [];
			for (const extension of installed) {
				updates.push(
					...(await checkForUpdates({
						projectDir: root,
						auth,
						crossSource: options.crossSource,
						extension: extension.id,
					})),
				);
			}
		}
		totals.pending += updates.length;

		const entry = {
			root: label,
			updates: updates.map((update) => ({
				extension: formatId(update.extension.id),
				currentVersion: update.currentVersion,
				latestVersion: update.latestVersion,
				source: update.source,
			})),
			skipped: sourceless.map((extension) => formatId(extension.id)),
			updated: [],
			failed: [],
		};

		if (!options.json) {
			for (const update of entry.updates) {
				process.stdout.write(
					`${label}: ${update.extension} ${update.currentVersion} -> ${update.latestVersion} (${update.source})\n`,
				);
			}
			if (options.verbose) {
				for (const name of entry.skipped) {
					process.stdout.write(`${label}: ${name} skipped, no recorded source\n`);
				}
			}
		}

		if (options.apply && updates.length > 0) {
			// The download phase reports on every chunk; one line per phase is enough.
			let lastPhase = null;
			const result = await applyUpdates(updates, {
				projectDir: root,
				auth,
				crossSource: options.crossSource,
				onProgress: ({ extension, phase, message }) => {
					const key = `${extension} ${phase}`;
					if (key === lastPhase) {
						return;
					}
					lastPhase = key;
					process.stderr.write(`${label}: ${extension} ${message}\n`);
				},
			});

			entry.updated = result.updated.map((item) => ({
				extension: formatId(item.extension.id),
				previousVersion: item.previousVersion,
				newVersion: item.newVersion,
			}));
			entry.failed = result.failed.map((item) => ({
				extension: formatId(item.extension.id),
				error: item.error,
			}));

			totals.updated += entry.updated.length;
			totals.failed += entry.failed.length;

			if (!options.json) {
				for (const item of entry.failed) {
					process.stdout.write(`${label}: ${item.extension} FAILED: ${item.error}\n`);
				}
			}
		}

		report.push(entry);
	}

	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ directory: options.dir, source: options.source, totals, projects: report }, null, "\t")}\n`,
		);
	} else {
		const summary = [
			`${totals.roots} project(s)`,
			`${totals.extensions} extension(s)`,
			`${totals.sourceless} without a source`,
			`${totals.pending} update(s) available`,
		];
		if (options.apply) {
			summary.push(`${totals.updated} updated`, `${totals.failed} failed`);
		}
		process.stdout.write(`\n${summary.join(", ")}.\n`);
	}

	return totals.failed > 0 ? 1 : 0;
}

try {
	process.exitCode = await main();
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
