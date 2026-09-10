/**
 * The raster a hover renders, beside `typstSvg.ts` which holds the vector one.
 *
 * A hover carries its image inside a data URI, and the length of that URI is
 * what the markdown renderer gives up on. A raster of the size actually shown
 * is shorter than the vector for everything but the simplest drawing, because
 * a page of glyph outlines costs an outline per glyph however small it is
 * drawn, while a raster costs the pixels on screen and nothing more.
 */

/** The size a raster declares, in pixels. */
export interface RasterSize {
	width: number;
	height: number;
}

/** The eight bytes every PNG starts with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Where the header chunk keeps the width, once the signature and length are past. */
const WIDTH_AT = 16;

/** The whole of a header: the signature, one chunk length, `IHDR` and two sizes. */
const HEADER_BYTES = 24;

/** Points to the inch, which is what `--ppi` is counted in. */
const POINTS_PER_INCH = 72;

/**
 * The size a raster declares, or nothing when the bytes declare none.
 *
 * Read from the file rather than worked out from the resolution asked for, so
 * a rounding difference between this and Typst cannot leave the hover naming a
 * height the image does not have.
 */
export function pngSize(png: Buffer): RasterSize | undefined {
	if (png.length < HEADER_BYTES || !png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
		return undefined;
	}
	// The first chunk of a PNG is always the header. Reading the size out of
	// whatever chunk happens to be first would size the image from pixel data.
	if (png.subarray(12, 16).toString("ascii") !== "IHDR") {
		return undefined;
	}
	const width = png.readUInt32BE(WIDTH_AT);
	const height = png.readUInt32BE(WIDTH_AT + 4);
	return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * The resolution one block compiles at, for a hover that shows `maxHeight`.
 *
 * Twice the height on screen, so the image is still sharp on a dense display,
 * and twice the height on screen rather than twice the page: a page taller than
 * the hover shows is scaled down before a reader sees it, and every pixel above
 * that ratio is length in the URI that buys nothing.
 *
 * A page of no height keeps the plain resolution, because there is no ratio to
 * take and nothing to divide by.
 */
export function rasterPpi(pageHeight: number, maxHeight: number): number {
	const whole = POINTS_PER_INCH * 2;
	if (pageHeight <= maxHeight || pageHeight <= 0) {
		return whole;
	}
	return (whole * maxHeight) / pageHeight;
}

/** The raster as a data URI, which is what a hover renders. */
export function pngDataUri(png: Buffer): string {
	return `data:image/png;base64,${png.toString("base64")}`;
}
