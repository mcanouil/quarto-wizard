import * as crypto from "crypto";

export function generateHashKey(url: string): string {
	return crypto.createHash("md5").update(url).digest("hex");
}
