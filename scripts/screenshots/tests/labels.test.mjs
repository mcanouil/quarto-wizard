import assert from "node:assert/strict";
import test from "node:test";
import { LIGHT_COLOURS, OUTLINE, labelsForTheme } from "../lib/labels.mjs";

const luminance = (hex) => {
	const [r, g, b] = [1, 3, 5].map((start) => {
		const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
};

test("labelsForTheme keeps the colour and uses the dark outline for the dark theme", () => {
	const [label] = labelsForTheme([{ text: "a", colour: "#9be38a" }], "dark");
	assert.equal(label.colour, "#9be38a");
	assert.equal(label.outline, OUTLINE.dark);
});

test("labelsForTheme swaps in the light variant and the white outline for the light theme", () => {
	const [label] = labelsForTheme([{ text: "a", colour: "#9be38a" }], "light");
	assert.equal(label.colour, LIGHT_COLOURS["#9be38a"]);
	assert.equal(label.outline, OUTLINE.light);
});

test("labelsForTheme rejects a colour without a light variant", () => {
	assert.throws(() => labelsForTheme([{ text: "a", colour: "#123456" }], "light"), /"a".*#123456/);
});

test("every light variant has a contrast of at least 4.5 on white", () => {
	for (const [dark, light] of Object.entries(LIGHT_COLOURS)) {
		assert.ok(contrast(light, "#ffffff") >= 4.5, `${dark} -> ${light} has contrast ${contrast(light, "#ffffff")}`);
	}
});
