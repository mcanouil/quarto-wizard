import * as crypto from "crypto";

/**
 * Generates a hash key for a given string.
 *
 * @param {string} input - The string to be hashed.
 * @returns {string} - The generated hash key in hexadecimal format.
 */
export function generateHashKey(input: string): string {
	return crypto.createHash("sha256").update(input).digest("hex");
}
