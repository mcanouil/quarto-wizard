import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { startRegistry } from "../lib/registry.mjs";

test("startRegistry serves the downloaded JSON", async () => {
	const body = JSON.stringify({ "a/b": { name: "b" } });
	const source = http.createServer((_request, response) => response.end(body));
	await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
	const sourceUrl = `http://127.0.0.1:${source.address().port}/extensions.json`;

	const registry = await startRegistry(sourceUrl);
	try {
		source.close();
		const response = await fetch(registry.url);
		assert.equal(await response.text(), body);
	} finally {
		await registry.close();
	}
	await assert.rejects(fetch(registry.url));
});
