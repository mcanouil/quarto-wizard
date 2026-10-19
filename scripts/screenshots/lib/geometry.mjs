/** @typedef {{ x: number, y: number, width: number, height: number }} Box */

export const WINDOW = { width: 1280, height: 800 };
export const CROP_MARGIN = 16;
const CHROME_PARTS = ["titlebar", "activitybar", "sidebar", "editor", "panel", "statusbar"];

/**
 * @param {Box} workArea
 * @returns {Box}
 */
export function fitWindow(workArea) {
	if (workArea.width < WINDOW.width || workArea.height < WINDOW.height) {
		throw new Error(
			`The window needs ${WINDOW.width} x ${WINDOW.height} pixels, but the work area is ${workArea.width} x ${workArea.height}. Use a larger screen.`,
		);
	}
	return {
		x: workArea.x + Math.round((workArea.width - WINDOW.width) / 2),
		y: workArea.y + Math.round((workArea.height - WINDOW.height) / 2),
		...WINDOW,
	};
}

/**
 * The margin never reaches into a workbench part that the frame does not name, so the image has no
 * slivers of the title bar, the activity bar or the status bar.
 * @param {"window" | string[]} frame
 * @param {Record<string, Box | null>} parts
 * @param {{ width: number, height: number }} viewport
 * @returns {Box}
 */
export function cropRect(frame, parts, viewport) {
	if (frame === "window") {
		return { x: 0, y: 0, width: viewport.width, height: viewport.height };
	}
	const boxes = frame.map((name) => {
		if (!parts[name]) {
			throw new Error(`The frame names "${name}", but that part is not open.`);
		}
		return parts[name];
	});
	let left = Math.floor(Math.min(...boxes.map((box) => box.x)) - CROP_MARGIN);
	let top = Math.floor(Math.min(...boxes.map((box) => box.y)) - CROP_MARGIN);
	let right = Math.ceil(Math.max(...boxes.map((box) => box.x + box.width)) + CROP_MARGIN);
	let bottom = Math.ceil(Math.max(...boxes.map((box) => box.y + box.height)) + CROP_MARGIN);
	const union = {
		left: Math.min(...boxes.map((box) => box.x)),
		top: Math.min(...boxes.map((box) => box.y)),
		right: Math.max(...boxes.map((box) => box.x + box.width)),
		bottom: Math.max(...boxes.map((box) => box.y + box.height)),
	};
	for (const name of CHROME_PARTS.filter((part) => !frame.includes(part))) {
		const box = parts[name];
		if (!box) {
			continue;
		}
		if (box.x + box.width <= union.left) left = Math.max(left, box.x + box.width);
		if (box.x >= union.right) right = Math.min(right, box.x);
		if (box.y + box.height <= union.top) top = Math.max(top, box.y + box.height);
		if (box.y >= union.bottom) bottom = Math.min(bottom, box.y);
	}
	left = Math.max(0, left);
	top = Math.max(0, top);
	right = Math.min(viewport.width, right);
	bottom = Math.min(viewport.height, bottom);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Self-contained, because the workbench page receives its source.
 * @param {{ x: number, y: number }} start
 * @param {{ x: number, y: number }} end
 * @param {[number, number]} control
 */
export function arrowPath(start, end, control) {
	const cx = end.x + (start.x - end.x) * control[0];
	const cy = start.y + (end.y - start.y) * control[1];
	const round = (value) => Math.round(value * 100) / 100;
	return `M ${start.x} ${start.y} Q ${round(cx)} ${round(cy)} ${end.x} ${end.y}`;
}

/**
 * @param {{ width: number, height: number }} a
 * @param {{ width: number, height: number }} b
 * @param {string} scene
 */
export function assertSameSize(a, b, scene) {
	if (a.width !== b.width || a.height !== b.height) {
		throw new Error(
			`Scene ${scene}: the dark image is ${a.width} x ${a.height} but the light image is ${b.width} x ${b.height}.`,
		);
	}
}
