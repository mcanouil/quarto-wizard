import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ZipArchive } from "archiver";
import * as tar from "tar";
import {
	detectArchiveFormat,
	extractArchive,
	readArchiveExtensions,
	findExtensionRoot,
	cleanupExtraction,
} from "../src/archive/extract.js";
import { extractZip } from "../src/archive/zip.js";
import { extractTar } from "../src/archive/tar.js";
import { SecurityError } from "../src/errors.js";

/**
 * Create a ZIP archive from a source directory.
 * Cross-platform alternative to execSync('zip ...').
 */
async function createZipArchive(sourceDir: string, zipPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const output = fs.createWriteStream(zipPath);
		const archive = new ZipArchive({ zlib: { level: 9 } });

		output.on("close", () => resolve());
		archive.on("error", (err) => reject(err));

		archive.pipe(output);
		archive.directory(sourceDir, false);
		archive.finalize();
	});
}

/**
 * Create a TAR.GZ archive from a source directory.
 * Cross-platform alternative to execSync('tar ...').
 */
async function createTarArchive(sourceDir: string, tarPath: string): Promise<void> {
	await tar.create(
		{
			gzip: true,
			file: tarPath,
			cwd: sourceDir,
		},
		["."],
	);
}

/** Byte offsets and widths of the ustar header fields this helper writes. */
const USTAR_CHECKSUM_OFFSET = 148;
const USTAR_CHECKSUM_WIDTH = 8;
const USTAR_BLOCK_SIZE = 512;

/**
 * Build a single ustar header block.
 *
 * @param name - Entry name
 * @param typeflag - ustar type flag ("0" file, "1" hard link, "2" symbolic link)
 * @param linkname - Link target, for link entries
 */
function createUstarHeader(name: string, typeflag: string, linkname: string): Buffer {
	const header = Buffer.alloc(USTAR_BLOCK_SIZE);
	const write = (value: string, offset: number, length: number) => {
		header.write(value.slice(0, length), offset, length, "utf8");
	};

	write(name, 0, 100);
	write("0000644\0", 100, 8); // mode
	write("0000000\0", 108, 8); // uid
	write("0000000\0", 116, 8); // gid
	write("00000000000\0", 124, 12); // size: link entries carry no data
	write("00000000000\0", 136, 12); // mtime
	header.fill(" ", USTAR_CHECKSUM_OFFSET, USTAR_CHECKSUM_OFFSET + USTAR_CHECKSUM_WIDTH);
	write(typeflag, 156, 1);
	write(linkname, 157, 100);
	write("ustar\0", 257, 6);
	write("00", 263, 2);

	let checksum = 0;
	for (const byte of header) {
		checksum += byte;
	}
	write(`${checksum.toString(8).padStart(6, "0")}\0 `, USTAR_CHECKSUM_OFFSET, USTAR_CHECKSUM_WIDTH);

	return header;
}

/**
 * Write an uncompressed tar containing one regular file and one link entry.
 *
 * The header is assembled by hand rather than by archiving a real link with `tar.create`:
 * node-tar's writer emits a late, unhandled stream error when it walks a hard link, which
 * made this suite fail intermittently. Building the bytes directly also makes the fixture
 * independent of what the host filesystem permits, so the tests no longer skip themselves
 * on platforms without link support.
 *
 * @param tarPath - Destination archive path
 * @param typeflag - "1" for a hard link, "2" for a symbolic link
 * @param linkName - Name of the link entry
 * @param targetName - Name of the file the link points at
 */
async function createTarWithLinkEntry(
	tarPath: string,
	typeflag: "1" | "2",
	linkName: string,
	targetName: string,
): Promise<void> {
	const content = Buffer.from("link-target\n", "utf8");
	const paddedContent = Buffer.alloc(Math.ceil(content.length / USTAR_BLOCK_SIZE) * USTAR_BLOCK_SIZE);
	content.copy(paddedContent);

	const fileHeader = createUstarHeader(targetName, "0", "");
	fileHeader.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
	// Rewriting the size invalidates the checksum computed for a zero-length entry.
	fileHeader.fill(" ", USTAR_CHECKSUM_OFFSET, USTAR_CHECKSUM_OFFSET + USTAR_CHECKSUM_WIDTH);
	let checksum = 0;
	for (const byte of fileHeader) {
		checksum += byte;
	}
	fileHeader.write(`${checksum.toString(8).padStart(6, "0")}\0 `, USTAR_CHECKSUM_OFFSET, USTAR_CHECKSUM_WIDTH, "utf8");

	await fs.promises.writeFile(
		tarPath,
		Buffer.concat([
			fileHeader,
			paddedContent,
			createUstarHeader(linkName, typeflag, targetName),
			// Two zero blocks mark the end of the archive.
			Buffer.alloc(USTAR_BLOCK_SIZE * 2),
		]),
	);
}

describe("detectArchiveFormat", () => {
	it("detects zip format", () => {
		expect(detectArchiveFormat("file.zip")).toBe("zip");
		expect(detectArchiveFormat("FILE.ZIP")).toBe("zip");
	});

	it("detects tarball formats", () => {
		expect(detectArchiveFormat("file.tar.gz")).toBe("tarball");
		expect(detectArchiveFormat("file.tgz")).toBe("tarball");
		expect(detectArchiveFormat("file.tar")).toBe("tarball");
	});

	it("returns null for unknown formats", () => {
		expect(detectArchiveFormat("file.txt")).toBeNull();
		expect(detectArchiveFormat("file.rar")).toBeNull();
	});
});

describe("findExtensionRoot", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ext-root-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("finds manifest in root directory", async () => {
		await fs.promises.writeFile(path.join(tempDir, "_extension.yml"), "title: Test");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBe(tempDir);
	});

	it("finds manifest in subdirectory (GitHub archive style)", async () => {
		const subDir = path.join(tempDir, "repo-main");
		await fs.promises.mkdir(subDir);
		await fs.promises.writeFile(path.join(subDir, "_extension.yml"), "title: Test");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBe(subDir);
	});

	it("finds manifest with .yaml extension", async () => {
		await fs.promises.writeFile(path.join(tempDir, "_extension.yaml"), "title: Test");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBe(tempDir);
	});

	it("returns null when no manifest found", async () => {
		const root = await findExtensionRoot(tempDir);

		expect(root).toBeNull();
	});

	it("returns null when manifest is deeper than max depth", async () => {
		// Create a deeply nested directory structure (7 levels deep > MAX_FIND_DEPTH of 5)
		let current = tempDir;
		for (let i = 0; i < 7; i++) {
			current = path.join(current, `level${i}`);
			await fs.promises.mkdir(current);
		}
		await fs.promises.writeFile(path.join(current, "_extension.yml"), "title: Deep");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBeNull();
	});

	it("finds manifest at exactly the max depth", async () => {
		// Create directory structure at depth 5 (within MAX_FIND_DEPTH)
		let current = tempDir;
		for (let i = 0; i < 4; i++) {
			current = path.join(current, `level${i}`);
			await fs.promises.mkdir(current);
		}
		await fs.promises.writeFile(path.join(current, "_extension.yml"), "title: AtLimit");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBe(current);
	});
});

describe("readArchiveExtensions", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ext-roots-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	async function writeExtension(dir: string, title: string): Promise<void> {
		await fs.promises.mkdir(dir, { recursive: true });
		await fs.promises.writeFile(path.join(dir, "_extension.yml"), `title: ${title}`);
	}

	function names(extensions: { id: { name: string } }[]): string[] {
		return extensions.map((ext) => ext.id.name).sort();
	}

	it("returns every extension when the repository root has no _extensions/", async () => {
		const repo = path.join(tempDir, "owner-repo-main");
		await writeExtension(path.join(repo, "docs", "_extensions", "mcanouil", "iconify"), "iconify");
		await writeExtension(path.join(repo, "pkg", "_extensions", "mcanouil", "pastel"), "pastel");

		const { extensions: found } = await readArchiveExtensions(tempDir);

		expect(names(found)).toEqual(["iconify", "pastel"]);
	});

	it("keeps only the repository root _extensions/ when it is populated", async () => {
		// Mirrors a GitHub archive of an extension repository that also builds a docs site.
		const repo = path.join(tempDir, "mcanouil-quarto-code-window-8a3af22");
		await writeExtension(path.join(repo, "_extensions", "code-window"), "code-window");
		await writeExtension(path.join(repo, "docs", "_extensions", "mcanouil", "atelier"), "atelier");
		await writeExtension(path.join(repo, "docs", "_extensions", "mcanouil", "gitlink"), "gitlink");

		const { extensions: found } = await readArchiveExtensions(tempDir);

		expect(names(found)).toEqual(["code-window"]);
	});

	it("keeps every extension in the repository root _extensions/", async () => {
		const repo = path.join(tempDir, "owner-repo-main");
		await writeExtension(path.join(repo, "_extensions", "mcanouil", "first"), "first");
		await writeExtension(path.join(repo, "_extensions", "mcanouil", "second"), "second");
		await writeExtension(path.join(repo, "docs", "_extensions", "mcanouil", "vendored"), "vendored");

		const { extensions: found } = await readArchiveExtensions(tempDir);

		expect(names(found)).toEqual(["first", "second"]);
	});

	it("applies the repository root _extensions/ rule without a wrapper directory", async () => {
		await writeExtension(path.join(tempDir, "_extensions", "code-window"), "code-window");
		await writeExtension(path.join(tempDir, "docs", "_extensions", "mcanouil", "atelier"), "atelier");

		const { extensions: found } = await readArchiveExtensions(tempDir);

		expect(names(found)).toEqual(["code-window"]);
	});

	it("drops extensions matched by the repository .quartoignore", async () => {
		const repo = path.join(tempDir, "owner-repo-main");
		await fs.promises.mkdir(repo, { recursive: true });
		await fs.promises.writeFile(path.join(repo, ".quartoignore"), "# the docs site\ndocs\n");
		await writeExtension(path.join(repo, "pkg", "_extensions", "mcanouil", "pastel"), "pastel");
		await writeExtension(path.join(repo, "docs", "_extensions", "mcanouil", "iconify"), "iconify");

		const { extensions: found } = await readArchiveExtensions(tempDir);

		expect(names(found)).toEqual(["pastel"]);
	});

	it("keeps the unfiltered set when .quartoignore would discard everything", async () => {
		const repo = path.join(tempDir, "owner-repo-main");
		await fs.promises.mkdir(repo, { recursive: true });
		await fs.promises.writeFile(path.join(repo, ".quartoignore"), "docs\n");
		await writeExtension(path.join(repo, "docs", "_extensions", "mcanouil", "iconify"), "iconify");

		const { extensions: found } = await readArchiveExtensions(tempDir);

		expect(names(found)).toEqual(["iconify"]);
	});

	it("does not mistake a lone _extensions/ directory for an archive wrapper", async () => {
		await writeExtension(path.join(tempDir, "_extensions", "mcanouil", "only"), "only");

		const { extensions: found } = await readArchiveExtensions(tempDir);

		expect(names(found)).toEqual(["only"]);
	});

	it("returns an empty array when the archive holds no extension", async () => {
		await fs.promises.mkdir(path.join(tempDir, "owner-repo-main", "docs"), { recursive: true });

		const { extensions: found } = await readArchiveExtensions(tempDir);

		expect(found).toEqual([]);
	});
});

describe("cleanupExtraction", () => {
	it("removes extraction directory", async () => {
		const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cleanup-test-"));
		expect(fs.existsSync(tempDir)).toBe(true);

		await cleanupExtraction(tempDir);

		expect(fs.existsSync(tempDir)).toBe(false);
	});

	it("does not throw for non-existent directory", async () => {
		await expect(cleanupExtraction("/non/existent/path")).resolves.not.toThrow();
	});
});

describe("ZIP extraction", () => {
	let tempDir: string;
	let zipPath: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "zip-test-"));

		const sourceDir = path.join(tempDir, "source");
		await fs.promises.mkdir(sourceDir);
		await fs.promises.writeFile(path.join(sourceDir, "_extension.yml"), "title: Test Extension\nversion: 1.0.0");
		await fs.promises.writeFile(path.join(sourceDir, "filter.lua"), "-- filter code");

		zipPath = path.join(tempDir, "test.zip");
		await createZipArchive(sourceDir, zipPath);
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("extracts zip archive", async () => {
		const destDir = path.join(tempDir, "dest");

		const files = await extractZip(zipPath, destDir);

		expect(files.length).toBeGreaterThan(0);
		expect(fs.existsSync(path.join(destDir, "_extension.yml"))).toBe(true);
	});

	it("reports progress", async () => {
		const destDir = path.join(tempDir, "dest");
		const progressFiles: string[] = [];

		await extractZip(zipPath, destDir, {
			onProgress: (file) => progressFiles.push(file),
		});

		expect(progressFiles.length).toBeGreaterThan(0);
	});

	it("rejects hard links in tar archives", async () => {
		const hardLinkTarPath = path.join(tempDir, "hardlink.tar");
		await createTarWithLinkEntry(hardLinkTarPath, "1", "hardlink.txt", "original.txt");

		const destDir = path.join(tempDir, "dest-hardlink");

		await expect(extractTar(hardLinkTarPath, destDir)).rejects.toThrow(SecurityError);
	});
});

describe("TAR extraction", () => {
	let tempDir: string;
	let tarPath: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tar-test-"));

		const sourceDir = path.join(tempDir, "source");
		await fs.promises.mkdir(sourceDir);
		await fs.promises.writeFile(path.join(sourceDir, "_extension.yml"), "title: Test Extension\nversion: 1.0.0");
		await fs.promises.writeFile(path.join(sourceDir, "filter.lua"), "-- filter code");

		tarPath = path.join(tempDir, "test.tar.gz");
		await createTarArchive(sourceDir, tarPath);
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("extracts tar.gz archive", async () => {
		const destDir = path.join(tempDir, "dest");

		const files = await extractTar(tarPath, destDir);

		expect(files.length).toBeGreaterThan(0);
		expect(fs.existsSync(path.join(destDir, "_extension.yml"))).toBe(true);
	});

	it("reports progress", async () => {
		const destDir = path.join(tempDir, "dest");
		const progressFiles: string[] = [];

		await extractTar(tarPath, destDir, {
			onProgress: (file) => progressFiles.push(file),
		});

		expect(progressFiles.length).toBeGreaterThan(0);
	});

	it("rejects symbolic links in tar archives", async () => {
		const symlinkTarPath = path.join(tempDir, "symlink.tar");
		await createTarWithLinkEntry(symlinkTarPath, "2", "link.txt", "target.txt");

		const destDir = path.join(tempDir, "dest-symlink");

		await expect(extractTar(symlinkTarPath, destDir)).rejects.toThrow(SecurityError);
	});

	it("rejects tar archives exceeding max size", async () => {
		const destDir = path.join(tempDir, "dest-oversize");

		await expect(extractTar(tarPath, destDir, { maxSize: 10 })).rejects.toThrow(SecurityError);
	});
});

describe("extractArchive", () => {
	let tempDir: string;
	let zipPath: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "extract-test-"));

		const sourceDir = path.join(tempDir, "source");
		await fs.promises.mkdir(sourceDir);
		await fs.promises.writeFile(path.join(sourceDir, "_extension.yml"), "title: Test");

		zipPath = path.join(tempDir, "test.zip");
		await createZipArchive(sourceDir, zipPath);
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("extracts and detects format", async () => {
		const result = await extractArchive(zipPath);

		try {
			expect(result.format).toBe("zip");
			expect(result.files.length).toBeGreaterThan(0);
			expect(fs.existsSync(result.extractDir)).toBe(true);
		} finally {
			await cleanupExtraction(result.extractDir);
		}
	});
});

describe("security checks", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "security-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("rejects archives exceeding max size", async () => {
		const largeContent = "x".repeat(1024);
		const sourceDir = path.join(tempDir, "source");
		await fs.promises.mkdir(sourceDir);
		await fs.promises.writeFile(path.join(sourceDir, "large.txt"), largeContent);

		const zipPath = path.join(tempDir, "large.zip");
		await createZipArchive(sourceDir, zipPath);

		const destDir = path.join(tempDir, "dest");

		await expect(extractZip(zipPath, destDir, { maxSize: 100 })).rejects.toThrow(SecurityError);
	});
});
