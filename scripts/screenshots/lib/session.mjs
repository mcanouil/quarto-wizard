import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron";
import { _electron as electron } from "playwright-core";
import { arrowPath, assertSameSize, cropRect, fitWindow, WINDOW } from "./geometry.mjs";
import { install } from "./workbench.mjs";

const THEME_NAMES = { dark: "Default Dark Modern", light: "Default Light Modern" };
const FRAME = {
	margin: 40,
	radius: 10,
	dark: { background: "#000000", border: "#3c3c3c", shadow: "rgba(0,0,0,0.6)" },
	light: { background: "#ffffff", border: "#c8c8c8", shadow: "rgba(0,0,0,0.25)" },
};
const STEP_TIMEOUT = 30000;
const PROJECT_FOLDER = "sample-project";
const isMac = process.platform === "darwin";

// The VS Code IPC socket path must stay under 103 characters, so the profile lives in a short folder.
const work = path.join(os.tmpdir(), "qw-screenshots");
const userData = path.join(work, "user-data");
const extensionsDir = path.join(work, "extensions");
const projectsDir = path.join(work, "projects");
const settingsFile = path.join(userData, "User", "settings.json");

function writeSettings(changes) {
	const current = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf8")) : {};
	fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
	fs.writeFileSync(settingsFile, JSON.stringify({ ...current, ...changes }, null, 2));
}

function prepareProfile(registryUrl) {
	fs.rmSync(settingsFile, { force: true });
	writeSettings({
		"workbench.colorTheme": THEME_NAMES.dark,
		"workbench.startupEditor": "none",
		"workbench.tips.enabled": false,
		"workbench.secondarySideBar.defaultVisibility": "hidden",
		"chat.disableAIFeatures": true,
		"update.mode": "none",
		"extensions.autoCheckUpdates": false,
		"telemetry.telemetryLevel": "off",
		"window.restoreWindows": "none",
		"window.dialogStyle": "custom",
		"window.menuStyle": "custom",
		"security.workspace.trust.enabled": false,
		"git.enabled": false,
		"editor.occurrencesHighlight": "off",
		"editor.selectionHighlight": false,
		"quartoWizard.registry.url": registryUrl,
	});
}

function installQuartoExtension(cli) {
	execFileSync(
		cli,
		[`--user-data-dir=${userData}`, `--extensions-dir=${extensionsDir}`, "--install-extension", "quarto.quarto"],
		{ stdio: "inherit" },
	);
}

/** Builds the project copy of a scene and applies its `write` and `setVersion` steps. */
function prepareProject(repo, scene) {
	const project = path.join(projectsDir, scene.name, PROJECT_FOLDER);
	fs.rmSync(project, { recursive: true, force: true });
	fs.cpSync(path.join(repo, "docs", "_extensions"), path.join(project, "_extensions"), { recursive: true });
	fs.writeFileSync(path.join(project, "_quarto.yml"), 'project:\n  title: "Sample project"\n');
	fs.writeFileSync(path.join(project, "report.qmd"), '---\ntitle: "Report"\n---\n\nHello.\n');

	scene.steps.forEach((step, index) => {
		if (step.kind === "write") {
			const file = path.join(project, step.file);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, step.content);
		} else if (step.kind === "setVersion") {
			setVersion(project, step, `Scene ${scene.name}, step ${index} (setVersion)`);
		}
	});
	return project;
}

function setVersion(project, { extension, version }, where) {
	const manifest = path.join(project, "_extensions", extension, "_extension.yml");
	const text = fs.readFileSync(manifest, "utf8");
	const repository = /^source: ([^@\n]+)/m.exec(text)?.[1];
	if (!repository) {
		throw new Error(`${where}: ${manifest} has no source; pick an extension installed from GitHub or the registry.`);
	}
	fs.writeFileSync(
		manifest,
		text.replace(/^version: .*$/m, `version: ${version}`).replace(/^source: .*$/m, `source: ${repository}@${version}`),
	);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(description, check, timeout = STEP_TIMEOUT) {
	const deadline = Date.now() + timeout;
	for (;;) {
		try {
			const value = await check();
			if (value) {
				return value;
			}
		} catch {
			// The page may be navigating; try again until the deadline.
		}
		if (Date.now() > deadline) {
			throw new Error(description);
		}
		await sleep(250);
	}
}

/** Waits for the workbench of `project` and prepares it for the steps. */
async function workbenchPage(app, project) {
	const folder = path.basename(project);
	return poll(
		`The workbench for ${folder} did not load.`,
		async () => {
			for (const page of app.windows().reverse()) {
				const ready = await page.evaluate(
					(name) => document.title.includes(name) && Boolean(document.querySelector(".part.sidebar")),
					folder,
				);
				if (ready) {
					await page.evaluate(install, arrowPath.toString());
					return page;
				}
			}
			return null;
		},
		60000,
	);
}

async function sizeWindow(app, page) {
	const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
		const [win] = BrowserWindow.getAllWindows();
		if (win.isFullScreen()) win.setFullScreen(false);
		if (win.isMaximized()) win.unmaximize();
		return screen.getDisplayMatching(win.getBounds()).workArea;
	});
	const target = fitWindow(bounds);
	await app.evaluate(({ BrowserWindow }, content) => {
		const [win] = BrowserWindow.getAllWindows();
		win.setContentBounds(content);
	}, target);
	const viewport = await poll(
		"The window did not reach its size.",
		async () => {
			const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
			return size.width === WINDOW.width && size.height === WINDOW.height ? size : null;
		},
		10000,
	);
	return viewport;
}

async function setTheme(page, scene, theme) {
	writeSettings({ "workbench.colorTheme": THEME_NAMES[theme] });
	await poll(
		`Scene ${scene}: the ${theme} theme did not apply`,
		() => page.evaluate(() => window.qwShot.currentTheme()).then((current) => current === theme),
		15000,
	);
	await sleep(800);
}

const find = (page, target) => page.evaluate((t) => window.qwShot.findTarget(t), target);

async function runStep(page, step) {
	switch (step.kind) {
		case "command":
			await page.keyboard.press(isMac ? "Meta+Shift+P" : "Control+Shift+P");
			await sleep(500);
			await page.keyboard.type(step.title);
			await sleep(800);
			await page.keyboard.press("Enter");
			await sleep(1500);
			return;
		case "type":
			await page.keyboard.type(step.text, { delay: 30 });
			await sleep(800);
			return;
		case "key":
			await page.keyboard.press(step.key);
			await sleep(800);
			return;
		case "open":
			await page.keyboard.press(isMac ? "Meta+P" : "Control+P");
			await sleep(500);
			await page.keyboard.type(step.file);
			await sleep(800);
			await page.keyboard.press("Enter");
			await sleep(1500);
			return;
		case "click": {
			const target = { text: step.text, label: step.label, part: step.part ?? "workbench" };
			const box = await poll("target not found", () => find(page, target), 10000);
			await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: step.button ?? "left" });
			await sleep(1000);
			return;
		}
		case "expand": {
			const box = await poll("target not found", () => find(page, { row: step.row }), 10000);
			await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
			await page.keyboard.press("ArrowRight");
			await sleep(1500);
			return;
		}
		case "wait":
			if (step.selector) {
				await page.waitForSelector(step.selector, { state: "visible", timeout: step.timeout ?? STEP_TIMEOUT });
			} else {
				await poll(
					"target not found",
					() => find(page, { text: step.text, part: "workbench" }),
					step.timeout ?? STEP_TIMEOUT,
				);
			}
			await sleep(500);
			return;
		case "sidebarWidth": {
			const sidebar = await page.locator(".part.sidebar").boundingBox();
			await page.mouse.move(sidebar.x + sidebar.width, sidebar.y + sidebar.height / 2);
			await page.mouse.down();
			await page.mouse.move(sidebar.x + step.width, sidebar.y + sidebar.height / 2, { steps: 10 });
			await page.mouse.up();
			await sleep(800);
			return;
		}
		default:
			return;
	}
}

async function runSteps(page, scene) {
	for (const [index, step] of scene.steps.entries()) {
		try {
			await runStep(page, step);
		} catch (error) {
			throw new Error(`Scene ${scene.name}, step ${index} (${step.kind}): ${error.message}`, { cause: error });
		}
	}
}

/** Runs in the Electron main process: crops and frames a PNG in an offscreen window at twice the CSS size. */
async function frame({ BrowserWindow }, { png, viewport, crop, margin, radius, colours }) {
	const html = `<!doctype html><html><body style="margin:0;zoom:2;background:${colours.background}">
		<div style="margin:${margin}px;width:${crop.width}px;height:${crop.height}px;border-radius:${radius}px;overflow:hidden;position:relative;
			box-shadow:0 0 0 1px ${colours.border},0 20px 50px ${colours.shadow}">
			<img style="position:absolute;left:${-crop.x}px;top:${-crop.y}px;width:${viewport.width}px;height:${viewport.height}px" src="data:image/png;base64,${png}">
		</div></body></html>`;
	const win = new BrowserWindow({
		show: false,
		width: (crop.width + 2 * margin) * 2,
		height: (crop.height + 2 * margin) * 2,
		useContentSize: true,
		webPreferences: { offscreen: true },
	});
	await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const image = await win.webContents.capturePage();
	win.destroy();
	return image.toPNG().toString("base64");
}

const pngSize = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

async function captureTheme(app, page, scene, theme, geometry) {
	if (theme !== "dark" || (await page.evaluate(() => window.qwShot.currentTheme())) !== "dark") {
		await setTheme(page, scene.name, theme);
	}
	const png = (await page.screenshot()).toString("base64");
	const framed = await app.evaluate(frame, {
		png,
		viewport: geometry.viewport,
		crop: geometry.crop,
		margin: FRAME.margin,
		radius: FRAME.radius,
		colours: FRAME[theme],
	});
	return Buffer.from(framed, "base64");
}

async function runScene(app, scene, project, repo) {
	const page = await workbenchPage(app, project);
	const viewport = await sizeWindow(app, page);
	await sleep(4000);

	await setTheme(page, scene.name, scene.themes[0]);
	await runSteps(page, scene);
	await page.mouse.move(0, 0);
	await sleep(500);

	const boxes = await page.evaluate(() => window.qwShot.partBoxes());
	const crop = cropRect(scene.frame, boxes, viewport);
	const missing = await page.evaluate(
		([labels, parts]) => window.qwShot.drawLabels(labels, parts),
		[scene.labels, boxes],
	);
	if (missing.length > 0) {
		throw new Error(`Scene ${scene.name}: labels without a target on screen: ${missing.join(", ")}.`);
	}
	await sleep(300);

	const images = {};
	for (const theme of scene.themes) {
		images[theme] = await captureTheme(app, page, scene, theme, { viewport, crop });
	}
	if (images.dark && images.light) {
		assertSameSize(pngSize(images.dark), pngSize(images.light), scene.name);
	}
	return Object.fromEntries(
		scene.themes.map((theme) => {
			const output = path.join(repo, scene.outputs[theme]);
			fs.writeFileSync(output, images[theme]);
			return [theme, output];
		}),
	);
}

/**
 * Runs every scene in a fresh VS Code window of one downloaded build and returns the files it wrote.
 * Opening another folder in a running window does nothing when the window is driven by Playwright,
 * so each scene launches and closes its own window.
 * @param {object[]} scenes
 * @param {{ repo: string, registryUrl: string }} options
 * @returns {Promise<string[]>}
 */
export async function runScenes(scenes, { repo, registryUrl }) {
	fs.rmSync(projectsDir, { recursive: true, force: true });
	prepareProfile(registryUrl);
	const executablePath = await downloadAndUnzipVSCode("stable");
	const [cli] = resolveCliArgsFromVSCodeExecutablePath(executablePath);
	installQuartoExtension(cli);

	const written = [];
	for (const scene of scenes) {
		console.log(`Scene ${scene.name}`);
		const project = prepareProject(repo, scene);
		const app = await electron.launch({
			executablePath,
			args: [
				project,
				`--extensionDevelopmentPath=${repo}`,
				`--user-data-dir=${userData}`,
				`--extensions-dir=${extensionsDir}`,
				"--disable-workspace-trust",
				"--skip-welcome",
				"--skip-release-notes",
			],
			env: { ...process.env },
		});
		try {
			const files = await runScene(app, scene, project, repo);
			for (const file of Object.values(files)) {
				console.log(`Wrote ${path.relative(repo, file)}.`);
				written.push(file);
			}
		} finally {
			await app.close();
		}
	}
	return written;
}
