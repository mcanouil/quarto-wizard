import http from "node:http";

export const DEFAULT_REGISTRY_URL = "https://m.canouil.dev/quarto-extensions/extensions.json";

/**
 * Downloads the registry once and serves that copy, so every scene of a run shows the same content.
 * @param {string} sourceUrl
 * @returns {Promise<{ url: string, close(): Promise<void> }>}
 */
export async function startRegistry(sourceUrl) {
	const response = await fetch(sourceUrl);
	if (!response.ok) {
		throw new Error(`Cannot download the registry from ${sourceUrl}: HTTP ${response.status}.`);
	}
	const body = await response.text();
	const server = http.createServer((_request, reply) => {
		reply.setHeader("content-type", "application/json");
		reply.end(body);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return {
		url: `http://127.0.0.1:${server.address().port}/extensions.json`,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}
