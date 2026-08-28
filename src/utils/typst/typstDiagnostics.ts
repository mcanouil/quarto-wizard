/**
 * One diagnostic Typst reported, mapped back onto the block body.
 *
 * Both fields are zero-based, which is what a VS Code position takes.
 */
export interface TypstDiagnostic {
	/**
	 * Zero-based line within the block body.
	 *
	 * Absent when there is no position in this block to report. That is either a
	 * failure Typst gave no position for, such as a package that would not
	 * download, or a position above the body, which belongs to the preview header
	 * or to a block the preview compiled above this one. The two position fields
	 * are always both present or both absent.
	 */
	line?: number;
	/** Zero-based column. */
	column?: number;
	/**
	 * Whether Typst gave a position and it sits above the block body.
	 *
	 * This separates the two reasons a diagnostic carries no position. A failure
	 * above the body has a place the reader can go and look at, in the preview
	 * header or in a block compiled above this one, while a package that would
	 * not download has no place at all.
	 */
	aboveBody?: boolean;
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
			// diagnostics would otherwise call a failed compile a clean block. It is
			// reported without a position, because giving it the start of the body
			// would mark a character that has nothing to do with the failure.
			diagnostics.push({ message: heading[2], severity });
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

		if (line < 0) {
			// Above the block body, which is a real place but not one in this
			// block. The injected lines are not all written by the preview: a raw
			// block compiles under every raw block before it, so the failure can
			// belong to a different block of the document. Naming a line here would
			// blame this block for it.
			diagnostics.push({ message: heading[2], severity, aboveBody: true });
			continue;
		}

		diagnostics.push({ line, column: Number(position[3]), message: heading[2], severity });
	}

	return diagnostics;
}
