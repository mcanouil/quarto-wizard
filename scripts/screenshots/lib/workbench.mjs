/**
 * Functions that run in the workbench page.
 * A function passed to `page.evaluate` is serialised alone, so `install` defines every helper
 * inside itself and exposes them on `window.qwShot`; call it once after each window load.
 * `arrowPathSource` is the source of `arrowPath` from geometry.mjs, so that Node and the page share one rule.
 */
export function install(arrowPathSource) {
	const arrowPath = new Function(`return ${arrowPathSource}`)();

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

	const unionBox = (elements) => {
		const boxes = elements.map((el) => toBox(el.getBoundingClientRect())).filter(Boolean);
		if (boxes.length === 0) {
			return null;
		}
		const left = Math.min(...boxes.map((box) => box.x));
		const top = Math.min(...boxes.map((box) => box.y));
		const right = Math.max(...boxes.map((box) => box.x + box.width));
		const bottom = Math.max(...boxes.map((box) => box.y + box.height));
		return { x: left, y: top, width: right - left, height: bottom - top };
	};

	/** A part with several elements, such as a menu and its submenus, is the box that holds them all. */
	const partBoxes = () =>
		Object.fromEntries(Object.entries(PART_SELECTORS).map(([name, selector]) => [name, unionBox(queryAll(selector))]));

	const byLabel = (root, prefix) =>
		[...root.querySelectorAll("[aria-label]")].find(
			(el) => el.getAttribute("aria-label").startsWith(prefix) && toBox(el.getBoundingClientRect()),
		);

	const textBox = (root, needle) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.textContent.includes(needle)) {
				const range = document.createRange();
				range.selectNodeContents(node);
				const box = toBox(range.getBoundingClientRect());
				if (box) {
					return box;
				}
			}
		}
		return null;
	};

	/**
	 * Target forms: `badge` (activity bar item), `row` with `action`, `action` or `label` (aria-label
	 * prefix), and `text`; `part` names where to look and defaults to the sidebar.
	 */
	const findTarget = (target) => {
		if (target.badge) {
			const item = byLabel(document.querySelector(".part.activitybar"), target.badge)?.closest(".action-item");
			const badge = item?.querySelector(".badge-content");
			return toBox(badge?.getBoundingClientRect()) ?? toBox(item?.getBoundingClientRect());
		}
		const root = partElement(target.part ?? "sidebar");
		if (!root) {
			return null;
		}
		if (target.text) {
			return textBox(root, target.text);
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
		const svgNs = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(svgNs, "svg");
		svg.setAttribute("width", String(window.innerWidth));
		svg.setAttribute("height", String(window.innerHeight));
		svg.style.cssText = "position:fixed;inset:0;z-index:100000;pointer-events:none;overflow:visible";
		const missing = [];

		labels.forEach((label, index) => {
			const part = boxes[label.at.part];
			if (!part) {
				missing.push(label.text);
				return;
			}
			const x = part.x + label.at.x;
			const y = part.y + label.at.y;
			const text = document.createElementNS(svgNs, "text");
			text.setAttribute("x", String(x));
			text.setAttribute("y", String(y));
			text.setAttribute("fill", label.colour);
			text.style.cssText = `font:500 ${label.size ?? 30}px -apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif;paint-order:stroke;stroke:#1f1f1f;stroke-width:6px`;
			text.textContent = label.text;
			svg.appendChild(text);
			if (!label.target) {
				return;
			}

			const box = findTarget(label.target);
			if (!box) {
				missing.push(label.text);
				return;
			}
			const pointsDown = label.from === "top" || label.target.action || label.target.badge;
			const end = pointsDown
				? { x: box.x + box.width / 2, y: box.y + box.height + 6 }
				: { x: box.x + box.width + 8, y: box.y + box.height / 2 };
			const start = label.from === "top" ? { x: x - 4, y: y - 20 } : { x: x - 8, y: y - 8 };

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

		document.body.appendChild(svg);
		return missing;
	};

	window.qwShot = { partBoxes, findTarget, drawLabels, currentTheme };
}
