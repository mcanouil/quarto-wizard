import * as dns from "dns";

export function checkInternetConnection(): Promise<boolean> {
	return new Promise((resolve) => {
		dns.lookup("github.com", (err) => {
			if (err && err.code === "ENOTFOUND") {
				resolve(false);
			} else {
				resolve(true);
			}
		});
	});
}
