/**
 * Replaces properties for the length of one test and puts them back afterwards.
 * Call {@link Stubs.restore} from `teardown`.
 */
export class Stubs {
	private restorers: (() => void)[] = [];

	replace<T extends object, K extends keyof T>(target: T, key: K, replacement: unknown): void {
		const record = target as Record<PropertyKey, unknown>;
		const original = record[key as PropertyKey];
		record[key as PropertyKey] = replacement;
		this.restorers.push(() => {
			record[key as PropertyKey] = original;
		});
	}

	restore(): void {
		for (const restorer of this.restorers.reverse()) {
			restorer();
		}
		this.restorers = [];
	}
}
