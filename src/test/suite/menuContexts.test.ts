import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const VIEW = "quartoWizard.extensionsInstalled";

interface MenuEntry {
	command: string;
	when: string;
	group: string;
}

type Token =
	| { type: "op"; value: "(" | ")" | "&&" | "||" | "!" | "==" | "=~" }
	| { type: "word"; value: string }
	| { type: "regex"; value: RegExp };

function fail(when: string): never {
	throw new Error(`Unsupported when syntax: ${when}`);
}

function tokenise(when: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;
	while (index < when.length) {
		const rest = when.slice(index);
		const space = /^\s+/.exec(rest);
		if (space) {
			index += space[0].length;
			continue;
		}
		const op = /^(&&|\|\||==|=~|[()!])/.exec(rest);
		if (op) {
			tokens.push({ type: "op", value: op[1] as "(" | ")" | "&&" | "||" | "!" | "==" | "=~" });
			index += op[0].length;
			continue;
		}
		const regex = /^\/((?:\\.|[^/\\])+)\/([a-z]*)/.exec(rest);
		if (regex && tokens.at(-1)?.value === "=~") {
			tokens.push({ type: "regex", value: new RegExp(regex[1], regex[2]) });
			index += regex[0].length;
			continue;
		}
		const word = /^[\w.-]+/.exec(rest);
		if (word) {
			tokens.push({ type: "word", value: word[0] });
			index += word[0].length;
			continue;
		}
		fail(when);
	}
	return tokens;
}

/**
 * Evaluates the subset of the `when` syntax that the item menus of the extensions view use.
 * Throws on any other syntax, so a new clause cannot pass unchecked.
 */
function evaluateViewItem(when: string, contextValue: string): boolean {
	const tokens = tokenise(when);
	let position = 0;
	const context: Record<string, string> = { view: VIEW, viewItem: contextValue };
	const peek = (): Token | undefined => tokens[position];
	const isOp = (value: string): boolean => peek()?.type === "op" && peek()?.value === value;

	const parseOr = (): boolean => {
		let value = parseAnd();
		while (isOp("||")) {
			position += 1;
			value = parseAnd() || value;
		}
		return value;
	};
	const parseAnd = (): boolean => {
		let value = parseUnary();
		while (isOp("&&")) {
			position += 1;
			value = parseUnary() && value;
		}
		return value;
	};
	const parseUnary = (): boolean => {
		if (isOp("!")) {
			position += 1;
			return !parseUnary();
		}
		if (isOp("(")) {
			position += 1;
			const value = parseOr();
			if (!isOp(")")) fail(when);
			position += 1;
			return value;
		}
		return parseComparison();
	};
	const parseComparison = (): boolean => {
		const key = tokens[position++];
		const operator = tokens[position++];
		const operand = tokens[position++];
		if (key?.type !== "word" || !(key.value in context) || operator?.type !== "op") fail(when);
		const actual = context[key.value];
		if (operator.value === "==" && operand?.type === "word") return actual === operand.value;
		if (operator.value === "=~" && operand?.type === "regex") return operand.value.test(actual);
		return fail(when);
	};

	const result = parseOr();
	if (position !== tokens.length) fail(when);
	return result;
}

const ITEM_MENUS: readonly MenuEntry[] = (
	JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8")).contributes.menus[
		"view/item/context"
	] as MenuEntry[]
).filter((entry) => entry.when.startsWith(`view == ${VIEW} && `));

const UPDATE = "quartoWizard.extensionsInstalled.update";
const REINSTALL = "quartoWizard.extensionsInstalled.reinstall";
const REMOVE = "quartoWizard.extensionsInstalled.remove";
const OPEN_SOURCE = "quartoWizard.extensionsInstalled.openSource";
const REVEAL = "quartoWizard.extensionsInstalled.revealInExplorer";
const INSTALL = "quartoWizard.installExtension";
const TEMPLATE = "quartoWizard.useTemplate";
const REMOVE_MULTIPLE = "quartoWizard.extensionsInstalled.removeMultiple";
const HIDE = "quartoWizard.extensionsInstalled.hideProject";

/** The menus of each tree-item state, as `package.json` shows them. */
const MENU_STATES: { name: string; contextValue: string; menus: [string, string][] }[] = [
	{
		name: "extension with a GitHub or registry source",
		contextValue: "quartoExtensionItem:update:reinstall:remove:openSource:reveal",
		menus: [
			[UPDATE, "inline@3"],
			[REMOVE, "inline@4"],
			[OPEN_SOURCE, "inline@5"],
			[UPDATE, "navigation@1"],
			[REINSTALL, "navigation@1"],
			[REMOVE, "navigation@2"],
			[OPEN_SOURCE, "navigation@3"],
			[REVEAL, "navigation@4"],
		],
	},
	{
		name: "extension with another source",
		contextValue: "quartoExtensionItem:reinstall:remove:openSource:reveal",
		menus: [
			[REINSTALL, "inline@3"],
			[REMOVE, "inline@4"],
			[OPEN_SOURCE, "inline@5"],
			[REINSTALL, "navigation@1"],
			[REMOVE, "navigation@2"],
			[OPEN_SOURCE, "navigation@3"],
			[REVEAL, "navigation@4"],
		],
	},
	{
		name: "extension without a source",
		contextValue: "quartoExtensionItem:remove:reveal",
		menus: [
			[REMOVE, "inline@4"],
			[REMOVE, "navigation@2"],
			[REVEAL, "navigation@4"],
		],
	},
	{
		name: "extension of an installed embedded parent",
		contextValue: "quartoExtensionItem:openSource:reveal",
		menus: [
			[OPEN_SOURCE, "inline@5"],
			[OPEN_SOURCE, "navigation@3"],
			[REVEAL, "navigation@4"],
		],
	},
	{
		name: "extension that embeds itself",
		contextValue: "quartoExtensionItem:reveal",
		menus: [[REVEAL, "navigation@4"]],
	},
	{
		name: "project folder",
		contextValue: "quartoExtensionWorkspaceFolder:install:template:removeMultiple:hide",
		menus: [
			[INSTALL, "inline@1"],
			[TEMPLATE, "inline@2"],
			[REMOVE_MULTIPLE, "inline@3"],
			[HIDE, "inline@4"],
			[HIDE, "navigation@5"],
		],
	},
	{
		name: "folder of an installed embedded parent",
		contextValue: "quartoExtensionWorkspaceFolder:hide",
		menus: [
			[HIDE, "inline@4"],
			[HIDE, "navigation@5"],
		],
	},
];

function sortMenus(menus: [string, string][]): [string, string][] {
	return [...menus].sort(([a, b], [c, d]) => `${b} ${a}`.localeCompare(`${d} ${c}`));
}

suite("Menu Contexts Test Suite", () => {
	for (const state of MENU_STATES) {
		test(`the ${state.name} shows its menus`, () => {
			const shown = ITEM_MENUS.filter((entry) => evaluateViewItem(entry.when, state.contextValue)).map(
				(entry): [string, string] => [entry.command, entry.group],
			);

			assert.deepStrictEqual(sortMenus(shown), sortMenus(state.menus));
		});
	}

	test("remove does not match removeMultiple", () => {
		const removeEntries = ITEM_MENUS.filter((entry) => entry.command === REMOVE);

		assert.ok(removeEntries.length > 0);
		for (const entry of removeEntries) {
			assert.strictEqual(evaluateViewItem(entry.when, "quartoExtensionWorkspaceFolder:removeMultiple"), false);
		}
	});

	test("the evaluator rejects unknown syntax", () => {
		assert.throws(() => evaluateViewItem("viewItem in someList", "quartoExtensionItem"), /Unsupported when syntax/);
	});
});
