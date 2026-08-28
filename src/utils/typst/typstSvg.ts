/** The intrinsic size of a compiled image, in points. */
export interface SvgSize {
	width: number;
	height: number;
}

/**
 * The root element of a Typst SVG.
 *
 * Typst writes `<svg viewBox="..." width="41.236188889pt" height="18.513pt" ...>`,
 * so the size sits on the root and never on a child. Matching the whole
 * document would find the width of the first glyph or rectangle instead, and
 * size the image from that.
 */
const ROOT_ELEMENT = /^\s*<svg\b[^>]*>/;

/** One length attribute of the root element, with an optional unit. */
function rootLength(root: string, name: string): number | undefined {
	const found = new RegExp(`\\b${name}="(-?[0-9.]+)(?:pt|px)?"`).exec(root);
	if (found === null) {
		return undefined;
	}
	const value = Number(found[1]);
	return Number.isFinite(value) ? value : undefined;
}

/** The size a root element declares, or undefined when it declares none. */
function rootSize(root: string): SvgSize | undefined {
	const width = rootLength(root, "width");
	const height = rootLength(root, "height");
	return width === undefined || height === undefined ? undefined : { width, height };
}

/** The intrinsic size the root element declares, or undefined when it has none. */
export function svgSize(svg: string): SvgSize | undefined {
	const root = ROOT_ELEMENT.exec(svg);
	return root === null ? undefined : rootSize(root[0]);
}

/**
 * The same image, scaled down so its height fits a limit.
 *
 * The `viewBox` is left alone, so the drawing still fills the element and only
 * the presented size changes. An image already inside the limit, or one whose
 * root declares no size, is returned unchanged.
 */
export function clampSvg(svg: string, maxHeight: number): string {
	const root = ROOT_ELEMENT.exec(svg);
	const size = root === null ? undefined : rootSize(root[0]);
	if (root === null || size === undefined || size.height <= maxHeight || size.height <= 0) {
		return svg;
	}
	const scale = maxHeight / size.height;
	const scaled = root[0]
		.replace(/\bwidth="(-?[0-9.]+)(pt|px)?"/, `width="${size.width * scale}$2"`)
		.replace(/\bheight="(-?[0-9.]+)(pt|px)?"/, `height="${maxHeight}$2"`);
	return scaled + svg.slice(root[0].length);
}

/** The image as a data URI, which is what every surface renders. */
export function svgDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}
