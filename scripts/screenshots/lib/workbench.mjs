/**
 * Functions that run in the workbench page.
 * A function passed to `page.evaluate` is serialised alone, so `install` defines every helper
 * inside itself and exposes them on `window.qwShot`; call it once after each window load.
 * The argument holds the sources of `arrowPath` and `unionBoxes` from geometry.mjs, so that Node and the page share one rule.
 */
export function install([arrowPathSource, unionBoxesSource]) {
	const arrowPath = new Function(`return ${arrowPathSource}`)();
	const unionBoxes = new Function(`return ${unionBoxesSource}`)();

	const PART_SELECTORS = {
		titlebar: ".part.titlebar",
		activitybar: ".part.activitybar",
		sidebar: ".part.sidebar",
		editor: ".part.editor",
		panel: ".part.panel",
		statusbar: ".part.statusbar",
		quickinput: ".quick-input-widget",
		contextmenu: ".monaco-menu",
		dialog: ".monaco-dialog-box",
	};

	const toBox = (rect) =>
		rect && rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;

	/** Context menus live in the shadow root of a `.shadow-root-host`, so a query has to look inside it too. */
	const roots = () => [
		document,
		...[...document.querySelectorAll(".shadow-root-host")].map((el) => el.shadowRoot).filter(Boolean),
	];
	const queryAll = (selector) => roots().flatMap((root) => [...root.querySelectorAll(selector)]);

	const partElement = (name) => {
		if (name === "workbench") {
			return document.body;
		}
		if (name === "contextmenu") {
			const [menuRoot] = roots().filter((root) =>
				[...root.querySelectorAll(PART_SELECTORS.contextmenu)].some((menu) => toBox(menu.getBoundingClientRect())),
			);
			return menuRoot === document ? document.body : (menuRoot ?? null);
		}
		return document.querySelector(PART_SELECTORS[name] ?? "");
	};

	const unionBox = (elements) => unionBoxes(elements.map((el) => toBox(el.getBoundingClientRect())).filter(Boolean));

	/** A part with several elements, such as a menu and its submenus, is the box that holds them all. */
	const partBoxes = () =>
		Object.fromEntries(Object.entries(PART_SELECTORS).map(([name, selector]) => [name, unionBox(queryAll(selector))]));

	const byLabel = (root, prefix) =>
		[...root.querySelectorAll("[aria-label]")].find(
			(el) => el.getAttribute("aria-label").startsWith(prefix) && toBox(el.getBoundingClientRect()),
		);

	const textNodeElement = (root, needle) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.textContent.includes(needle)) {
				const range = document.createRange();
				range.selectNodeContents(node);
				const box = toBox(range.getBoundingClientRect());
				if (box) {
					return { box, element: node.parentElement };
				}
			}
		}
		return null;
	};

	/** The box of the text, or of the menu item that holds it when `item` is set. */
	const textBox = (root, needle, item) => {
		const found = textNodeElement(root, needle);
		if (!found) {
			return null;
		}
		return item ? (toBox(found.element.closest(".action-item")?.getBoundingClientRect()) ?? found.box) : found.box;
	};

	/**
	 * Target forms: `badge` (activity bar item), `row` with `action`, `action` or `label` (aria-label
	 * prefix), and `text` (a string, or a list whose boxes are joined); `part` names where to look and
	 * defaults to the sidebar. With `item`, a text stands for its menu item. `menu` is the box of the
	 * n-th menu of a context menu and its submenus (a negative n counts from the last).
	 */
	const findTarget = (target) => {
		if (target.badge) {
			const item = byLabel(document.querySelector(".part.activitybar"), target.badge)?.closest(".action-item");
			const badge = item?.querySelector(".badge-content");
			return toBox(badge?.getBoundingClientRect()) ?? toBox(item?.getBoundingClientRect());
		}
		if (target.menu !== undefined) {
			const menus = queryAll(PART_SELECTORS.contextmenu).filter((menu) => toBox(menu.getBoundingClientRect()));
			const menu = menus.at(target.menu);
			return menu ? toBox(menu.getBoundingClientRect()) : null;
		}
		const root = partElement(target.part ?? "sidebar");
		if (!root) {
			return null;
		}
		if (target.text) {
			const boxes = [target.text].flat().map((text) => textBox(root, text, target.item));
			return boxes.every(Boolean) ? unionBoxes(boxes) : null;
		}
		const action = target.action ?? target.label;
		if (target.row) {
			const row = [...root.querySelectorAll(".monaco-list-row")].find((el) => el.textContent.includes(target.row));
			return row && action ? toBox(byLabel(row, action)?.getBoundingClientRect()) : toBox(row?.getBoundingClientRect());
		}
		return action ? toBox(byLabel(root, action)?.getBoundingClientRect()) : null;
	};

	const currentTheme = () => {
		const workbench = document.querySelector(".monaco-workbench");
		if (workbench?.classList.contains("vs-dark")) {
			return "dark";
		}
		return workbench?.classList.contains("vs") ? "light" : null;
	};

	const drawLabels = (labels, boxes) => {
		document.getElementById("qw-labels")?.remove();
		const svgNs = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(svgNs, "svg");
		svg.id = "qw-labels";
		svg.setAttribute("width", String(window.innerWidth));
		svg.setAttribute("height", String(window.innerHeight));
		svg.style.cssText = "position:fixed;inset:0;z-index:100000;pointer-events:none;overflow:visible";
		const missing = [];
		document.body.appendChild(svg);

		labels.forEach((label, index) => {
			const name = label.text ?? JSON.stringify(label.target);
			let x = 0;
			let y = 0;
			let labelText = null;
			if (label.text !== undefined) {
				const part = boxes[label.at.part];
				if (!part) {
					missing.push(name);
					return;
				}
				x = part.x + label.at.x;
				y = part.y + label.at.y;
				const text = document.createElementNS(svgNs, "text");
				labelText = text;
				text.setAttribute("x", String(x));
				text.setAttribute("y", String(y));
				text.setAttribute("fill", label.colour);
				text.style.cssText = `font:500 ${label.size ?? 30}px -apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif;paint-order:stroke;stroke:${label.outline};stroke-width:6px`;
				text.textContent = label.text;
				svg.appendChild(text);
			}
			if (!label.target) {
				return;
			}

			const box = findTarget(label.target);
			if (!box) {
				missing.push(name);
				return;
			}
			if (label.highlight) {
				const pad = 4;
				const frameRect = document.createElementNS(svgNs, "rect");
				frameRect.setAttribute("x", String(box.x - pad));
				frameRect.setAttribute("y", String(box.y - pad));
				frameRect.setAttribute("width", String(box.width + 2 * pad));
				frameRect.setAttribute("height", String(box.height + 2 * pad));
				frameRect.setAttribute("rx", "6");
				frameRect.setAttribute("fill", label.colour);
				frameRect.setAttribute("fill-opacity", "0.12");
				frameRect.setAttribute("stroke", label.colour);
				frameRect.setAttribute("stroke-width", "3");
				svg.appendChild(frameRect);
			}
			if (label.arrow === false) {
				return;
			}
			const above = label.side === "top";
			const pointsDown = label.from === "top" || label.target.action || label.target.badge;
			let end = pointsDown
				? { x: box.x + box.width / 2, y: box.y + box.height + 6 }
				: { x: box.x + box.width + 8, y: box.y + box.height / 2 };
			let start = label.from === "top" ? { x: x - 4, y: y - 20 } : { x: x - 8, y: y - 8 };
			if (above) {
				const bounds = labelText.getBBox();
				start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height + 4 };
				end = { x: box.x + box.width / 2, y: box.y - 10 };
			}

			const marker = document.createElementNS(svgNs, "marker");
			marker.setAttribute("id", `qw-head-${index}`);
			marker.setAttribute("viewBox", "0 0 10 10");
			marker.setAttribute("refX", "8");
			marker.setAttribute("refY", "5");
			marker.setAttribute("markerWidth", "5");
			marker.setAttribute("markerHeight", "5");
			marker.setAttribute("orient", "auto-start-reverse");
			const head = document.createElementNS(svgNs, "path");
			head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
			head.setAttribute("fill", label.colour);
			marker.appendChild(head);
			svg.appendChild(marker);

			const arrow = document.createElementNS(svgNs, "path");
			arrow.setAttribute("d", arrowPath(start, end, label.control ?? [0.4, 0.5]));
			arrow.setAttribute("fill", "none");
			arrow.setAttribute("stroke", label.colour);
			arrow.setAttribute("stroke-width", "4");
			arrow.setAttribute("stroke-linecap", "round");
			arrow.setAttribute("marker-end", `url(#qw-head-${index})`);
			svg.appendChild(arrow);
		});

		return missing;
	};

	window.qwShot = { partBoxes, findTarget, drawLabels, currentTheme };
}
