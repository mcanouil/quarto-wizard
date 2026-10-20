const INTEGER = /^([-+]?)(?:0b([01_]+)|0o([0-7_]+)|0x([0-9a-fA-F_]+)|([0-9][0-9_]*))$/;
const FLOAT = /^(?:[-+]?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?)$/;

function nonFiniteText(value: number): string {
	if (Number.isNaN(value)) {
		return ".nan";
	}
	return value > 0 ? ".inf" : "-.inf";
}

function readNumber(value: number): number | string {
	return Number.isFinite(value) ? value : nonFiniteText(value);
}

function readString(text: string): number | string {
	if (text.endsWith("_")) {
		return text;
	}
	const integer = INTEGER.exec(text);
	if (integer) {
		const [, sign, binary, octal, hex, decimal] = integer;
		const digits = (binary ?? octal ?? hex ?? decimal).replace(/_/g, "");
		const radix = binary !== undefined ? 2 : octal !== undefined ? 8 : hex !== undefined ? 16 : 10;
		const magnitude = parseInt(digits, radix);
		return readNumber(sign === "-" ? -magnitude : magnitude);
	}
	if (FLOAT.test(text)) {
		return readNumber(parseFloat(text.replace(/_/g, "")));
	}
	return text;
}

/**
 * Read a parsed YAML scalar the way Quarto does.
 *
 * The extension parses YAML with js-yaml 5.5.0, and Quarto parses it as js-yaml 4.1 does.
 * The two disagree on some numbers: Quarto reads `0b101`, `0o170`, `-0x10` and `1_000` as numbers.
 * It leaves `0B101`, `1:20` and `0x1p4` as text.
 * Quarto hands Lua a non-finite number as the text `.inf`, `-.inf` or `.nan`.
 * A parsed value does not say whether it was quoted, so a quoted `"0b101"` is read as a number too.
 * Probed on 2026-10-20 with Quarto 99.9.9 against js-yaml 5.5.0.
 *
 * @param value - A scalar, as the extension parsed it.
 * @returns The value Quarto gives Lua for the same scalar.
 */
export function readYamlScalarAsQuarto(value: unknown): unknown {
	if (typeof value === "number") {
		return readNumber(value);
	}
	if (typeof value === "string") {
		return readString(value);
	}
	return value;
}

/**
 * Read a value as Quarto does when the field takes a number and cannot take a string.
 *
 * @param value - The parsed value.
 * @param type - The `type` of the field descriptor.
 */
export function readYamlValueForType(value: unknown, type: string | string[] | undefined): unknown {
	if (type === undefined) {
		return value;
	}
	const types = Array.isArray(type) ? type : [type];
	const numeric = types.includes("number") || types.includes("integer");
	return numeric && !types.includes("string") ? readYamlScalarAsQuarto(value) : value;
}
