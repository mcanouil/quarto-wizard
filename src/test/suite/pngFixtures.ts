/**
 * A PNG header declaring one size.
 *
 * The size is all any surface reads out of a raster, so a header alone stands
 * in for a whole image and nothing here has to compile one.
 */
export function pngHeader(width: number, height: number): Buffer {
	const bytes = Buffer.alloc(24);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}
