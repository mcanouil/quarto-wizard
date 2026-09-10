import * as assert from "assert";
import { pngDataUri, pngSize, rasterPpi } from "../../utils/typst/typstRaster";
import { pngHeader } from "./pngFixtures";

suite("Typst Raster Test Suite", () => {
	test("Should read the size a PNG header declares", () => {
		assert.deepStrictEqual(pngSize(pngHeader(800, 400)), { width: 800, height: 400 });
	});

	test("Should read no size from bytes that are not a PNG", () => {
		// Typst answers a raster request with a raster, and a build that answered
		// with anything else would otherwise be sized from whatever those bytes
		// happen to hold at the offset a header keeps its dimensions at.
		assert.strictEqual(pngSize(Buffer.from("<svg></svg>", "utf-8")), undefined);
		assert.strictEqual(pngSize(Buffer.alloc(0)), undefined);
		// The signature is right and the file stops before the size.
		assert.strictEqual(pngSize(pngHeader(800, 400).subarray(0, 18)), undefined);
		// A PNG whose first chunk is not the header declares no size here.
		const wrongChunk = pngHeader(800, 400);
		wrongChunk.write("IDAT", 12, "ascii");
		assert.strictEqual(pngSize(wrongChunk), undefined);
		// A size of zero is not a size, and dividing by it would follow.
		assert.strictEqual(pngSize(pngHeader(800, 0)), undefined);
	});

	test("Should render twice the height a hover shows, and never twice the page", () => {
		// A raster carries a fixed number of pixels, so rendering the whole page at
		// twice its natural size wastes every pixel the hover then scales away. The
		// resolution follows the height on screen instead.
		//
		// 72 points to the inch, so 144 is a page shown whole on a dense display.
		assert.strictEqual(rasterPpi(100, 200), 144);
		assert.strictEqual(rasterPpi(200, 200), 144);
		// Taller than the hover shows: the resolution falls by the same ratio the
		// image is scaled down by, which is what keeps a dense page inside a URI.
		assert.strictEqual(rasterPpi(400, 200), 72);
		assert.strictEqual(rasterPpi(800, 200), 36);
		// A page of no height would divide by zero.
		assert.strictEqual(rasterPpi(0, 200), 144);
	});

	test("Should carry the raster as a data URI a hover can render", () => {
		assert.ok(pngDataUri(pngHeader(2, 2)).startsWith("data:image/png;base64,"));
	});
});
