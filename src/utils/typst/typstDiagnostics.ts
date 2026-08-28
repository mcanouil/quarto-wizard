/**
 * One diagnostic Typst reported, mapped back onto the block body.
 *
 * Both fields are zero-based, which is what a VS Code position takes.
 */
export interface TypstDiagnostic {
	/** Zero-based line within the block body. */
	line: number;
	/** Zero-based column. */
	column: number;
	/** The message, without its severity prefix. */
	message: string;
	severity: "error" | "warning";
}

/** The first line of a diagnostic, which carries the severity and the message. */
const HEADING = /^(error|warning): (.+)$/;

/**
 * The second line, which carries the position.
 *
 * Only `<stdin>` counts. A preamble read from disk reports its own path, and
 * mapping that line onto the block would point at unrelated text.
 */
const POSITION = /^\s*┌─\s*<stdin>:(\d+):(\d+)/;

/**
 * Every diagnostic in a Typst run, mapped onto the block body.
 *
 * Typst writes the message and the position on separate lines:
 *
 * ```text
 * error: expected pattern
 *   ┌─ <stdin>:2:4
 * ```
 *
 * so a reader that looks only for `<stdin>:line:column` finds the position and
 * loses every message. The two are paired here instead.
 *
 * @param stderr - The captured standard error of the compiler.
 * @param injectedLines - How many lines the assembled source adds above the
 *   block body, which is what the reported line has to lose.
 */
export function parseTypstStderr(stderr: string, injectedLines: number): TypstDiagnostic[] {
	const lines = stderr.split(/\r?\n/);
	const diagnostics: TypstDiagnostic[] = [];

	for (let index = 0; index < lines.length - 1; index++) {
		const heading = HEADING.exec(lines[index]);
		if (heading === null) {
			continue;
		}
		const position = POSITION.exec(lines[index + 1]);
		if (position === null) {
			continue;
		}
		diagnostics.push({
			// Typst mixes its bases, which was checked against the caret it prints:
			// for `#let a = ` it reports 1:8, and the caret sits at index 8 of that
			// line. So the line counts from one and the column counts from zero.
			// A position inside the injected header is not a place in the block, so
			// it clamps to the first line.
			line: Math.max(0, Number(position[1]) - 1 - injectedLines),
			column: Number(position[2]),
			message: heading[2],
			severity: heading[1] as "error" | "warning",
		});
	}

	return diagnostics;
}
