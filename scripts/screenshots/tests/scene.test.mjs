import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultOutputs, loadScenes, selectScenes } from "../lib/scene.mjs";

const directories = [];

test.after(() => {
	for (const directory of directories) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function writeScenes(files) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qw-scene-test-"));
	directories.push(directory);
	for (const [name, scene] of Object.entries(files)) {
		fs.writeFileSync(path.join(directory, name), JSON.stringify(scene));
	}
	return directory;
}

const minimal = (name) => ({ name, frame: "window", steps: [{ kind: "wait", text: "x" }] });

test("loadScenes reads every scene and sorts them by name", () => {
	const directory = writeScenes({ "b.json": minimal("b"), "a.json": minimal("a") });
	const scenes = loadScenes(directory);
	assert.deepEqual(
		scenes.map((scene) => scene.name),
		["a", "b"],
	);
	assert.deepEqual(scenes[0].themes, ["dark", "light"]);
	assert.deepEqual(scenes[0].labels, []);
});

test("loadScenes rejects a name that differs from the file name", () => {
	const directory = writeScenes({ "a.json": minimal("other") });
	assert.throws(() => loadScenes(directory), /a\.json.*name/);
});

test("loadScenes rejects an unknown step kind and names the file and the step index", () => {
	const directory = writeScenes({
		"a.json": { ...minimal("a"), steps: [{ kind: "wait", text: "x" }, { kind: "dance" }] },
	});
	assert.throws(() => loadScenes(directory), /a\.json.*steps\[1\].*dance/);
});

test("defaultOutputs names the light and dark docs images", () => {
	assert.deepEqual(defaultOutputs("output-log", ["dark", "light"]), {
		dark: "docs/getting-started/images/output-log-dark.png",
		light: "docs/getting-started/images/output-log-light.png",
	});
});

test("a scene with one theme has one output", () => {
	const scenes = loadScenes(path.join(import.meta.dirname, "..", "scenes"));
	const walkthrough = scenes.find((scene) => scene.name === "walkthrough-explorer-view");
	assert.deepEqual(walkthrough.outputs, { dark: "assets/walkthroughs/media/explorer-view.png" });
});

test("selectScenes with no names returns every scene", () => {
	const scenes = [minimal("a"), minimal("b")];
	assert.deepEqual(selectScenes(scenes, []), scenes);
});

test("selectScenes rejects an unknown name and lists the known ones", () => {
	const scenes = [minimal("a"), minimal("b")];
	assert.throws(() => selectScenes(scenes, ["c"]), /Unknown scene "c".*a, b/);
});

test("loadScenes rejects a step field of the wrong type and names the field", () => {
	const directory = writeScenes({
		"a.json": { ...minimal("a"), steps: [{ kind: "sidebarWidth", width: "wide" }] },
	});
	assert.throws(() => loadScenes(directory), /a\.json.*steps\[0\].*width as a number/);
});

test("loadScenes rejects a click step without a target", () => {
	const directory = writeScenes({ "a.json": { ...minimal("a"), steps: [{ kind: "click" }] } });
	assert.throws(() => loadScenes(directory), /a\.json.*steps\[0\].*text or label/);
});

test("loadScenes rejects an unknown theme", () => {
	const directory = writeScenes({ "a.json": { ...minimal("a"), themes: ["sepia"] } });
	assert.throws(() => loadScenes(directory), /a\.json: themes/);
});

test("loadScenes rejects a frame part that does not exist", () => {
	const directory = writeScenes({ "a.json": { ...minimal("a"), frame: ["sidebar", "footer"] } });
	assert.throws(() => loadScenes(directory), /a\.json: frame/);
});

test("loadScenes rejects outputs that miss a theme", () => {
	const directory = writeScenes({ "a.json": { ...minimal("a"), outputs: { dark: "a.png" } } });
	assert.throws(() => loadScenes(directory), /a\.json: outputs.*light/);
});
