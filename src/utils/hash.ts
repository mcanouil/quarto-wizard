import * as crypto from "crypto";

/**
 * Generates a hash key for a given string.
 *
 * @param {string} object - The URL to be hashed.
 * @returns {string} - The generated hash key in hexadecimal format.
 */
export function generateHashKey(object: string): string {
	return crypto.createHash("md5").update(object).digest("hex");
}
