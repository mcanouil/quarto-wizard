import assert from "node:assert/strict";
import test from "node:test";
import { arrowPath, assertScale, assertSameSize, cropRect, fitWindow, unionBoxes } from "../lib/geometry.mjs";

const viewport = { width: 1280, height: 800 };

test("fitWindow centres the window in a larger work area", () => {
	assert.deepEqual(fitWindow({ x: 0, y: 33, width: 1512, height: 859 }), { x: 116, y: 63, width: 1280, height: 800 });
});

test("fitWindow rejects a work area smaller than the window", () => {
	assert.throws(() => fitWindow({ x: 0, y: 0, width: 1200, height: 700 }), /1280 x 800.*1200 x 700/);
});

test("cropRect for window is the viewport", () => {
	assert.deepEqual(cropRect("window", {}, viewport), { x: 0, y: 0, width: 1280, height: 800 });
});

test("cropRect unions parts with the margin", () => {
	const parts = {
		sidebar: { x: 0, y: 35, width: 620, height: 700 },
		quickinput: { x: 300, y: 40, width: 600, height: 300 },
	};
	assert.deepEqual(cropRect(["sidebar", "quickinput"], parts, viewport), { x: 0, y: 19, width: 916, height: 732 });
});

test("cropRect keeps the margin out of parts that the frame does not name", () => {
	const parts = {
		titlebar: { x: 0, y: 0, width: 1280, height: 35 },
		activitybar: { x: 0, y: 35, width: 48, height: 743 },
		sidebar: { x: 48, y: 35, width: 400, height: 743 },
		statusbar: { x: 0, y: 778, width: 1280, height: 22 },
	};
	assert.deepEqual(cropRect(["sidebar"], parts, viewport), { x: 48, y: 35, width: 416, height: 743 });
});

test("cropRect keeps only the top of the crop when a height is given", () => {
	const parts = { sidebar: { x: 48, y: 35, width: 416, height: 743 } };
	assert.deepEqual(cropRect(["sidebar"], parts, viewport, 200), { x: 32, y: 19, width: 448, height: 200 });
	assert.deepEqual(cropRect(["sidebar"], parts, viewport, 2000).height, 775);
});

test("cropRect rejects a missing part", () => {
	assert.throws(() => cropRect(["quickinput"], { quickinput: null }, viewport), /quickinput/);
});

test("arrowPath matches the current walkthrough rule", () => {
	assert.equal(arrowPath({ x: 712, y: 54 }, { x: 603, y: 70 }, [0.52, 2.6]), "M 712 54 Q 659.68 95.6 603 70");
});

test("assertSameSize throws with the scene name when sizes differ", () => {
	assert.throws(() => assertSameSize({ width: 1, height: 2 }, { width: 1, height: 3 }, "output-log"), /output-log/);
	assert.doesNotThrow(() => assertSameSize({ width: 1, height: 2 }, { width: 1, height: 2 }, "x"));
});

test("cropRect clamps at the right and bottom edges", () => {
	const parts = { editor: { x: 700, y: 500, width: 575, height: 295 } };
	assert.deepEqual(cropRect(["editor"], parts, viewport), { x: 684, y: 484, width: 596, height: 316 });
});

test("assertScale accepts the required scale and rejects another with the value in the message", () => {
	assert.doesNotThrow(() => assertScale(2));
	assert.throws(() => assertScale(1), /scale factor.*1/);
});

test("unionBoxes holds every box", () => {
	assert.deepEqual(
		unionBoxes([
			{ x: 10, y: 20, width: 100, height: 30 },
			{ x: 40, y: 60, width: 200, height: 10 },
		]),
		{ x: 10, y: 20, width: 230, height: 50 },
	);
});

test("unionBoxes of nothing is null", () => {
	assert.equal(unionBoxes([]), null);
});
