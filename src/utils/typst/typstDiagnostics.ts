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
 * The second line, which names a file and a position in it.
 *
 * The file matters. Only `<stdin>` is the block being compiled: a preamble read
 * from disk reports its own path, and mapping that line onto the block would
 * point at unrelated text. A diagnostic with no position line at all is a
 * different case again, and is kept.
 */
const POSITION = /^\s*┌─\s*(\S+):(\d+):(\d+)/;

/**
 * Every heading Typst wrote, with no position and no mapping.
 *
 * `parseTypstStderr` skips a diagnostic that names a file other than `<stdin>`,
 * because there is nothing in the block to mark. That can leave a failed
 * compile with no mapped diagnostic at all, and a caller which then says
 * nothing was reported contradicts both the log and the fact that no image
 * came back. Reading the headings gives it something true to say.
 */
export function typstMessages(stderr: string): { severity: "error" | "warning"; message: string }[] {
	const messages: { severity: "error" | "warning"; message: string }[] = [];
	for (const line of stderr.split(/\r?\n/)) {
		const heading = HEADING.exec(line);
		if (heading !== null) {
			messages.push({ severity: heading[1] as "error" | "warning", message: heading[2] });
		}
	}
	return messages;
}

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

	for (let index = 0; index < lines.length; index++) {
		const heading = HEADING.exec(lines[index]);
		if (heading === null) {
			continue;
		}

		const severity = heading[1] as "error" | "warning";
		const position = index + 1 < lines.length ? POSITION.exec(lines[index + 1]) : null;

		if (position === null) {
			// A failure to read the input, or to fetch a package, has nothing to
			// point at. It still has to be reported: a caller that counts
			// diagnostics would otherwise call a failed compile a clean block.
			diagnostics.push({ line: 0, column: 0, message: heading[2], severity });
			continue;
		}

		if (position[1] !== "<stdin>") {
			// A real place, but not one in this block, so there is nothing here to
			// mark and nothing useful to say about where it is.
			continue;
		}

		// Typst mixes its bases, which was checked against the caret it prints:
		// for `#let a = ` it reports 1:8, and the caret sits at index 8 of that
		// line. So the line counts from one and the column counts from zero.
		const line = Number(position[2]) - 1 - injectedLines;

		diagnostics.push({
			// A position inside the injected header is not a place in the block, so
			// it points at the start of the body instead. The column goes with it:
			// a column measured against a header line means nothing on the first
			// line of the body, and would put the mark at an arbitrary character.
			line: Math.max(0, line),
			column: line < 0 ? 0 : Number(position[3]),
			message: heading[2],
			severity,
		});
	}

	return diagnostics;
}
