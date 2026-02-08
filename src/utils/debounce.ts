/**
 * A debounced function with cancel and flush methods.
 */
export type DebouncedFunction<T extends (...args: never[]) => void> = T & {
	cancel: () => void;
	flush: () => void;
};

/**
 * Creates a debounced version of the provided function that delays invocation
 * until after the specified delay has elapsed since the last call.
 * Only the arguments from the most recent call are used when the function fires.
 *
 * @param fn - The function to debounce.
 * @param delay - The delay in milliseconds.
 * @returns A debounced version of the function with cancel and flush methods.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): DebouncedFunction<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let pendingArgs: any[] | undefined;

	const debounced = ((...args: unknown[]) => {
		pendingArgs = args;
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			timeoutId = undefined;
			const captured = pendingArgs;
			pendingArgs = undefined;
			if (captured) {
				fn(...captured);
			}
		}, delay);
	}) as DebouncedFunction<T>;

	debounced.cancel = () => {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
			timeoutId = undefined;
		}
		pendingArgs = undefined;
	};

	debounced.flush = () => {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
			timeoutId = undefined;
		}
		if (pendingArgs) {
			const captured = pendingArgs;
			pendingArgs = undefined;
			fn(...captured);
		}
	};

	return debounced;
}
