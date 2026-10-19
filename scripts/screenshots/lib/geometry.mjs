/** @typedef {{ x: number, y: number, width: number, height: number }} Box */

export const WINDOW = { width: 1280, height: 800 };
export const CROP_MARGIN = 16;

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
	const left = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.x)) - CROP_MARGIN));
	const top = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.y)) - CROP_MARGIN));
	const right = Math.min(viewport.width, Math.ceil(Math.max(...boxes.map((box) => box.x + box.width)) + CROP_MARGIN));
	const bottom = Math.min(
		viewport.height,
		Math.ceil(Math.max(...boxes.map((box) => box.y + box.height)) + CROP_MARGIN),
	);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * @param {{ x: number, y: number }} start
 * @param {{ x: number, y: number }} end
 * @param {[number, number]} control
 */
export function arrowPath(start, end, control) {
	const cx = end.x + (start.x - end.x) * control[0];
	const cy = start.y + (end.y - start.y) * control[1];
	return `M ${start.x} ${start.y} Q ${round(cx)} ${round(cy)} ${end.x} ${end.y}`;
}

const round = (value) => Math.round(value * 100) / 100;

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
