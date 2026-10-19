#!/usr/bin/env node
/**
 * Captures a labelled screenshot of the Extensions Installed view, as described by a scene file.
 *
 * Usage: node scripts/screenshots/capture.mjs [scene.json]
 * Default scene: scripts/screenshots/explorer-view.json. Run `npm run webpack` first.
 *
 * The script copies the scene's extensions into a throwaway Quarto project, sets one of them back a
 * version so the view shows an update, and launches the VS Code build that the tests use with the
 * development build of the extension and the Quarto extension, in a throwaway profile.
 * It sizes the window to fit the screen, draws the labels over the live elements they point at,
 * frames the capture, and writes the PNG named by the scene.
 *
 * Set GITHUB_TOKEN to check updates against GitHub; without it the view reports the registry.
 * The output depends on the screen and the fonts, so the script is a tool to refresh the image by
 * hand, not a test.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron";
import { _electron as electron } from "playwright-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scenePath = path.resolve(process.argv[2] ?? path.join(repo, "scripts", "screenshots", "explorer-view.json"));
const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));

const WINDOW = { width: 1624, height: 968, margin: 60 };
const FRAME = { margin: 40, radius: 10, background: "#000000" };

if (!fs.existsSync(path.join(repo, "dist", "extension.js"))) {
	throw new Error("dist/extension.js is missing. Run `npm run webpack` first.");
}

// The VS Code IPC socket path must stay under 103 characters, so the profile lives in a short folder.
const work = path.join(os.tmpdir(), "qw-screenshots");
fs.rmSync(path.join(work, "project"), { recursive: true, force: true });
const project = path.join(work, "project");
const userData = path.join(work, "user-data");
const extensionsDir = path.join(work, "extensions");

function prepareProject() {
	fs.cpSync(path.join(repo, scene.extensions), path.join(project, "_extensions"), { recursive: true });
	fs.writeFileSync(path.join(project, "_quarto.yml"), 'project:\n  title: "Sample project"\n');
	fs.writeFileSync(path.join(project, "report.qmd"), '---\ntitle: "Report"\n---\n\nHello.\n');

	const manifest = path.join(project, "_extensions", scene.outdated.id, "_extension.yml");
	const text = fs.readFileSync(manifest, "utf8");
	const repository = /^source: ([^@\n]+)/m.exec(text)?.[1];
	if (!repository) {
		throw new Error(`${manifest} has no source; pick an extension installed from GitHub or the registry.`);
	}
	fs.writeFileSync(
		manifest,
		text
			.replace(/^version: .*$/m, `version: ${scene.outdated.version}`)
			.replace(/^source: .*$/m, `source: ${repository}@${scene.outdated.version}`),
	);
}

function prepareProfile() {
	fs.mkdirSync(path.join(userData, "User"), { recursive: true });
	fs.writeFileSync(
		path.join(userData, "User", "settings.json"),
		JSON.stringify(
			{
				"workbench.colorTheme": "Default Dark Modern",
				"workbench.startupEditor": "none",
				"workbench.tips.enabled": false,
				"workbench.secondarySideBar.defaultVisibility": "hidden",
				"chat.disableAIFeatures": true,
				"update.mode": "none",
				"extensions.autoCheckUpdates": false,
				"telemetry.telemetryLevel": "off",
				"window.restoreWindows": "none",
				"security.workspace.trust.enabled": false,
				"git.enabled": false,
				"editor.occurrencesHighlight": "off",
				"editor.selectionHighlight": false,
			},
			null,
			2,
		),
	);
}

function installQuartoExtension(executablePath) {
	const [cli] = resolveCliArgsFromVSCodeExecutablePath(executablePath);
	execFileSync(
		cli,
		[`--user-data-dir=${userData}`, `--extensions-dir=${extensionsDir}`, "--install-extension", "quarto.quarto"],
		{ stdio: "inherit" },
	);
}

async function runCommand(page, title) {
	await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P");
	await page.waitForTimeout(500);
	await page.keyboard.type(title);
	await page.waitForTimeout(800);
	await page.keyboard.press("Enter");
	await page.waitForTimeout(1500);
}

/**
 * Runs in the workbench page: finds each label's target, draws the labels and arrows in an SVG
 * overlay, and returns the targets it could not find.
 */
function drawLabels(labels) {
	const sidebar = document.querySelector(".part.sidebar");
	const parts = {
		editor: document.querySelector(".part.editor"),
		sidebar,
		panel: document.querySelector(".part.panel"),
	};
	const rows = [...sidebar.querySelectorAll(".monaco-list-row")];
	const byLabel = (root, prefix) =>
		[...root.querySelectorAll("[aria-label]")].find((el) => el.getAttribute("aria-label").startsWith(prefix));
	const textBox = (needle) => {
		const walker = document.createTreeWalker(sidebar, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.textContent.includes(needle)) {
				const range = document.createRange();
				range.selectNodeContents(node);
				return range.getBoundingClientRect();
			}
		}
		return null;
	};
	const targetBox = (target) => {
		if (target.badge) {
			const item = byLabel(document.querySelector(".part.activitybar"), target.badge)?.closest(".action-item");
			const badge = item?.querySelector(".badge-content");
			return badge && badge.getBoundingClientRect().width > 0
				? badge.getBoundingClientRect()
				: item?.getBoundingClientRect();
		}
		if (target.text) {
			return textBox(target.text);
		}
		const root = target.row ? rows.find((row) => row.textContent.includes(target.row)) : sidebar;
		return root ? byLabel(root, target.action)?.getBoundingClientRect() : null;
	};

	const svgNs = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(svgNs, "svg");
	svg.setAttribute("width", String(window.innerWidth));
	svg.setAttribute("height", String(window.innerHeight));
	svg.style.cssText = "position:fixed;inset:0;z-index:100000;pointer-events:none;overflow:visible";
	const missing = [];

	labels.forEach((label, index) => {
		const part = parts[label.at.part].getBoundingClientRect();
		const x = part.x + label.at.x;
		const y = part.y + label.at.y;
		const text = document.createElementNS(svgNs, "text");
		text.setAttribute("x", String(x));
		text.setAttribute("y", String(y));
		text.setAttribute("fill", label.colour);
		text.style.cssText = `font:500 ${label.size ?? 30}px -apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif;paint-order:stroke;stroke:#1f1f1f;stroke-width:6px`;
		text.textContent = label.text;
		svg.appendChild(text);
		if (!label.target) {
			return;
		}

		const box = targetBox(label.target);
		if (!box) {
			missing.push(label.text);
			return;
		}
		const pointsDown = label.from === "top" || label.target.action || label.target.badge;
		const end = pointsDown
			? { x: box.x + box.width / 2, y: box.y + box.height + 6 }
			: { x: box.x + box.width + 8, y: box.y + box.height / 2 };
		const start = label.from === "top" ? { x: x - 4, y: y - 20 } : { x: x - 8, y: y - 8 };
		const [cx, cy] = label.control ?? [0.4, 0.5];
		const control = { x: end.x + (start.x - end.x) * cx, y: start.y + (end.y - start.y) * cy };

		const marker = document.createElementNS(svgNs, "marker");
		marker.setAttribute("id", `qw-head-${index}`);
		marker.setAttribute("viewBox", "0 0 10 10");
		marker.setAttribute("refX", "8");
		marker.setAttribute("refY", "5");
		marker.setAttribute("markerWidth", "5");
		marker.setAttribute("markerHeight", "5");
		marker.setAttribute("orient", "auto-start-reverse");
		const head = document.createElementNS(svgNs, "path");
		head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
		head.setAttribute("fill", label.colour);
		marker.appendChild(head);
		svg.appendChild(marker);

		const arrow = document.createElementNS(svgNs, "path");
		arrow.setAttribute("d", `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`);
		arrow.setAttribute("fill", "none");
		arrow.setAttribute("stroke", label.colour);
		arrow.setAttribute("stroke-width", "4");
		arrow.setAttribute("stroke-linecap", "round");
		arrow.setAttribute("marker-end", `url(#qw-head-${index})`);
		svg.appendChild(arrow);
	});

	document.body.appendChild(svg);
	return missing;
}

/** Runs in the Electron main process: frames a PNG in an offscreen window at twice the CSS size. */
async function frame({ BrowserWindow }, { png, width, height, margin, radius, background }) {
	const outer = { width: width + 2 * margin, height: height + 2 * margin };
	const html = `<!doctype html><html><body style="margin:0;zoom:2;background:${background}">
		<div style="margin:${margin}px;width:${width}px;height:${height}px;border-radius:${radius}px;overflow:hidden;
			box-shadow:0 0 0 1px #3c3c3c,0 20px 50px rgba(0,0,0,0.6)">
			<img style="display:block;width:${width}px;height:${height}px" src="data:image/png;base64,${png}">
		</div></body></html>`;
	const win = new BrowserWindow({
		show: false,
		width: outer.width * 2,
		height: outer.height * 2,
		useContentSize: true,
		webPreferences: { offscreen: true },
	});
	await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const image = await win.webContents.capturePage();
	win.destroy();
	return image.toPNG().toString("base64");
}

prepareProject();
prepareProfile();
const executablePath = await downloadAndUnzipVSCode("stable");
installQuartoExtension(executablePath);

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
	const page = await app.firstWindow();
	await app.evaluate(({ BrowserWindow, screen }, size) => {
		const [win] = BrowserWindow.getAllWindows();
		if (win.isFullScreen()) win.setFullScreen(false);
		if (win.isMaximized()) win.unmaximize();
		const area = screen.getDisplayMatching(win.getBounds()).workArea;
		const width = Math.min(size.width, area.width - 2 * size.margin);
		const height = Math.min(size.height, area.height - 2 * size.margin);
		win.setBounds({
			x: area.x + Math.round((area.width - width) / 2),
			y: area.y + Math.round((area.height - height) / 2),
			width,
			height,
		});
	}, WINDOW);
	await page.waitForTimeout(4000);

	await runCommand(page, "Quarto Wizard: Show Quarto Wizard Log Output");
	await runCommand(page, "Quarto Wizard: Focus on Extensions Installed View");
	await page.waitForTimeout(8000);

	const sidebar = await page.locator(".part.sidebar").boundingBox();
	await page.mouse.move(sidebar.x + sidebar.width, sidebar.y + sidebar.height / 2);
	await page.mouse.down();
	await page.mouse.move(sidebar.x + scene.sidebarWidth, sidebar.y + sidebar.height / 2, { steps: 10 });
	await page.mouse.up();
	await page.waitForTimeout(800);

	await page.locator(`.part.sidebar .monaco-list-row:has-text("${scene.expand}")`).first().click();
	await page.keyboard.press("ArrowRight");
	await page.waitForTimeout(1500);
	await page.locator(".part.editor").click({ position: { x: 600, y: 200 } });
	await page.mouse.move(0, 0);
	await page.waitForTimeout(500);

	const missing = await page.evaluate(drawLabels, scene.labels);
	if (missing.length > 0) {
		throw new Error(`Labels without a target on screen: ${missing.join(", ")}.`);
	}
	await page.waitForTimeout(300);

	const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
	const png = (await page.screenshot()).toString("base64");
	const framed = await app.evaluate(frame, { png, ...viewport, ...FRAME });
	const output = path.join(repo, scene.output);
	fs.writeFileSync(output, Buffer.from(framed, "base64"));
	console.log(`Wrote ${path.relative(repo, output)}.`);
} finally {
	await app.close();
}
