#!/usr/bin/env node
/**
 * Synchronises metadata fields from root package.json to all workspace packages.
 *
 * Fields synchronised: author, license, repository, bugs, homepage
 * Version is NOT synchronised as packages may have independent versioning.
 * Keywords are merged (package-specific keywords are preserved).
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

/** Fields to copy directly from root to packages */
const SYNC_FIELDS = ['author', 'license', 'bugs', 'homepage', 'version', 'sponsor'];

/** Fields to merge (package values are preserved, root values added if missing) */
const MERGE_ARRAY_FIELDS = [];

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, data) {
	writeFileSync(filePath, JSON.stringify(data, null, '\t') + '\n');
}

function getPackageDirs() {
	const packagesDir = join(rootDir, 'packages');
	return readdirSync(packagesDir)
		.map((name) => join(packagesDir, name))
		.filter((dir) => {
			try {
				return statSync(dir).isDirectory() && statSync(join(dir, 'package.json')).isFile();
			} catch {
				return false;
			}
		});
}

function syncRepository(rootRepo, pkgPath) {
	if (!rootRepo) return undefined;

	const relativePath = pkgPath.replace(rootDir + '/', '');
	return {
		...rootRepo,
		directory: relativePath,
	};
}

// function mergeKeywords(rootKeywords, pkgKeywords) {
// 	if (!rootKeywords && !pkgKeywords) return undefined;
// 	const root = rootKeywords || [];
// 	const pkg = pkgKeywords || [];
// 	return [...new Set([...pkg, ...root])];
// }

function syncPackage(rootPkg, pkgDir) {
	const pkgPath = join(pkgDir, 'package.json');
	const pkg = readJson(pkgPath);
	const relativePath = pkgDir.replace(rootDir + '/', '');

	let changed = false;

	for (const field of SYNC_FIELDS) {
		if (rootPkg[field] !== undefined) {
			const newValue = JSON.stringify(rootPkg[field]);
			const oldValue = JSON.stringify(pkg[field]);
			if (newValue !== oldValue) {
				pkg[field] = rootPkg[field];
				changed = true;
			}
		}
	}

	if (rootPkg.repository) {
		const newRepo = syncRepository(rootPkg.repository, relativePath);
		if (JSON.stringify(newRepo) !== JSON.stringify(pkg.repository)) {
			pkg.repository = newRepo;
			changed = true;
		}
	}

	// const mergedKeywords = mergeKeywords(rootPkg.keywords, pkg.keywords);
	// if (mergedKeywords && JSON.stringify(mergedKeywords) !== JSON.stringify(pkg.keywords)) {
	// 	pkg.keywords = mergedKeywords;
	// 	changed = true;
	// }

	if (changed) {
		writeJson(pkgPath, pkg);
		console.log(`Updated: ${relativePath}/package.json`);
	} else {
		console.log(`No changes: ${relativePath}/package.json`);
	}

	return changed;
}

function main() {
	const rootPkgPath = join(rootDir, 'package.json');
	const rootPkg = readJson(rootPkgPath);

	console.log('Syncing package metadata from root package.json...\n');

	const packageDirs = getPackageDirs();
	let updatedCount = 0;

	for (const pkgDir of packageDirs) {
		if (syncPackage(rootPkg, pkgDir)) {
			updatedCount++;
		}
	}

	console.log(`\nDone. Updated ${updatedCount} of ${packageDirs.length} packages.`);

	return updatedCount > 0 ? 0 : 0;
}

main();
