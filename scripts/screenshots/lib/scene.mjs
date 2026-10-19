import fs from "node:fs";
import path from "node:path";

const THEMES = ["dark", "light"];
const FRAME_PARTS = ["activitybar", "sidebar", "editor", "panel", "statusbar", "quickinput", "contextmenu", "dialog"];

const STEP_FIELDS = {
	command: { title: "string" },
	type: { text: "string" },
	key: { key: "string" },
	click: {},
	expand: { row: "string" },
	wait: {},
	open: { file: "string" },
	write: { file: "string", content: "string" },
	setVersion: { extension: "string", version: "string" },
	sidebarWidth: { width: "number" },
};

/**
 * @param {string} name
 * @param {string[]} themes
 * @returns {{ dark?: string, light?: string }}
 */
export function defaultOutputs(name, themes) {
	return Object.fromEntries(themes.map((theme) => [theme, `docs/getting-started/images/${name}-${theme}.png`]));
}

function validateStep(step, where) {
	if (typeof step !== "object" || step === null || !(step.kind in STEP_FIELDS)) {
		throw new Error(
			`${where}: unknown step kind "${step?.kind}"; known kinds are ${Object.keys(STEP_FIELDS).join(", ")}.`,
		);
	}
	for (const [field, type] of Object.entries(STEP_FIELDS[step.kind])) {
		if (typeof step[field] !== type) {
			throw new Error(`${where}: a "${step.kind}" step needs ${field} as a ${type}.`);
		}
	}
	if (step.kind === "click" && step.text === undefined && step.label === undefined) {
		throw new Error(`${where}: a "${step.kind}" step needs text or label.`);
	}
	if (step.kind === "wait" && step.text === undefined && step.selector === undefined) {
		throw new Error(`${where}: a "wait" step needs text or selector.`);
	}
}

function validateLabel(label, where) {
	const fail = (message) => {
		throw new Error(`${where}: ${message}`);
	};
	const highlightOnly = label.text === undefined && label.highlight === true && label.arrow === false;
	if (!highlightOnly) {
		if (typeof label.text !== "string" || typeof label.colour !== "string") {
			fail("a label needs text and colour as strings.");
		}
		const at = label.at;
		if (!at || typeof at.part !== "string" || typeof at.x !== "number" || typeof at.y !== "number") {
			fail("a label needs at as { part, x, y }.");
		}
	} else if (typeof label.colour !== "string") {
		fail("a highlight needs colour as a string.");
	}
	const target = label.target;
	if (label.highlight !== undefined && typeof label.highlight !== "boolean") {
		fail("highlight must be true or false.");
	}
	if (label.arrow !== undefined && typeof label.arrow !== "boolean") {
		fail("arrow must be true or false.");
	}
	if (label.side !== undefined && label.side !== "top") {
		fail('side must be "top".');
	}
	if (label.highlight && !target) {
		fail("a highlight needs a target.");
	}
	if (target === undefined) {
		return;
	}
	const text = target.text;
	if (
		text !== undefined &&
		typeof text !== "string" &&
		!(Array.isArray(text) && text.length > 0 && text.every((item) => typeof item === "string"))
	) {
		fail("target.text must be a string or a list of strings.");
	}
	if (target.menu !== undefined && !Number.isInteger(target.menu)) {
		fail("target.menu must be an integer.");
	}
	if (target.item !== undefined && typeof target.item !== "boolean") {
		fail("target.item must be true or false.");
	}
}

function validateScene(raw, file) {
	const fail = (field, message) => {
		throw new Error(`${file}: ${field} ${message}`);
	};
	if (raw.name !== path.basename(file, ".json")) {
		fail("name", `must equal the file name "${path.basename(file, ".json")}", got "${raw.name}".`);
	}
	const themes = raw.themes ?? THEMES;
	if (!Array.isArray(themes) || themes.length === 0 || themes.some((theme) => !THEMES.includes(theme))) {
		fail("themes", `must be a list of ${THEMES.join(" and ")}.`);
	}
	const frame = raw.frame;
	if (
		frame !== "window" &&
		!(Array.isArray(frame) && frame.length > 0 && frame.every((part) => FRAME_PARTS.includes(part)))
	) {
		fail("frame", `must be "window" or a list of ${FRAME_PARTS.join(", ")}.`);
	}
	if (!Array.isArray(raw.steps)) {
		fail("steps", "must be a list.");
	}
	raw.steps.forEach((step, index) => validateStep(step, `${file}: steps[${index}]`));
	const labels = raw.labels ?? [];
	labels.forEach((label, index) => validateLabel(label, `${file}: labels[${index}]`));
	const development = raw.development ?? true;
	if (typeof development !== "boolean") {
		fail("development", "must be true or false.");
	}
	if (raw.height !== undefined && !(typeof raw.height === "number" && raw.height > 0)) {
		fail("height", "must be a positive number of pixels.");
	}
	const outputs = raw.outputs ?? defaultOutputs(raw.name, themes);
	for (const theme of themes) {
		if (typeof outputs[theme] !== "string") {
			fail("outputs", `must name a file for the ${theme} theme.`);
		}
	}
	return { name: raw.name, themes, outputs, frame, height: raw.height, development, steps: raw.steps, labels };
}

/**
 * @param {string} directory
 */
export function loadScenes(directory) {
	return fs
		.readdirSync(directory)
		.filter((file) => file.endsWith(".json"))
		.map((file) => validateScene(JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")), file))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {{ name: string }[]} scenes
 * @param {string[]} names
 */
export function selectScenes(scenes, names) {
	if (names.length === 0) {
		return scenes;
	}
	const known = scenes.map((scene) => scene.name);
	return names.map((name) => {
		const scene = scenes.find((candidate) => candidate.name === name);
		if (!scene) {
			throw new Error(`Unknown scene "${name}". Known scenes: ${known.join(", ")}.`);
		}
		return scene;
	});
}
