import * as path from "node:path";
import type { QuartoProjectRoot } from "../utils/quartoProjectDiscovery";

/**
 * A leaf node representing a single Quarto project root.
 */
export interface ProjectLeafNode {
	kind: "project";
	label: string;
	root: QuartoProjectRoot;
}

/**
 * An intermediate folder node grouping sibling project roots that share a parent path.
 */
export interface ProjectGroupNode {
	kind: "group";
	label: string;
	fsPath: string;
	children: ProjectTreeNode[];
}

export type ProjectTreeNode = ProjectLeafNode | ProjectGroupNode;

interface MutableNode {
	label: string;
	fsPath: string;
	project?: QuartoProjectRoot;
	childrenByLabel: Map<string, MutableNode>;
}

/**
 * Builds a hierarchical tree from a flat list of Quarto project roots.
 *
 * Each workspace folder owns its own subtree (rooted at the workspace folder name).
 * Single-child chains are collapsed by joining labels with `/`, so a project that
 * does not share its parent with any sibling renders as a single flat label.
 */
export function buildProjectTree(roots: readonly QuartoProjectRoot[]): ProjectTreeNode[] {
	if (roots.length === 0) {
		return [];
	}

	const workspaceOrder: string[] = [];
	const byWorkspace = new Map<string, QuartoProjectRoot[]>();
	for (const root of roots) {
		const key = root.workspaceFolder.uri.fsPath;
		let bucket = byWorkspace.get(key);
		if (!bucket) {
			bucket = [];
			byWorkspace.set(key, bucket);
			workspaceOrder.push(key);
		}
		bucket.push(root);
	}

	const topLevel: ProjectTreeNode[] = [];
	for (const folderPath of workspaceOrder) {
		const folderRoots = byWorkspace.get(folderPath) ?? [];
		const folder = folderRoots[0].workspaceFolder;
		const trieRoot: MutableNode = {
			label: folder.name,
			fsPath: folderPath,
			childrenByLabel: new Map(),
		};

		for (const project of folderRoots) {
			const relative = path.relative(folderPath, project.fsPath);
			if (relative === "" || relative === ".") {
				trieRoot.project = project;
				continue;
			}
			const segments = relative.split(path.sep).filter((segment) => segment.length > 0);
			let current = trieRoot;
			let currentPath = folderPath;
			for (const segment of segments) {
				currentPath = path.join(currentPath, segment);
				let child = current.childrenByLabel.get(segment);
				if (!child) {
					child = {
						label: segment,
						fsPath: currentPath,
						childrenByLabel: new Map(),
					};
					current.childrenByLabel.set(segment, child);
				}
				current = child;
			}
			current.project = project;
		}

		topLevel.push(collapseAndConvert(trieRoot));
	}

	return topLevel;
}

function collapseAndConvert(node: MutableNode): ProjectTreeNode {
	const childNodes: ProjectTreeNode[] = [];
	for (const child of node.childrenByLabel.values()) {
		childNodes.push(collapseAndConvert(child));
	}

	if (!node.project && childNodes.length === 1) {
		const only = childNodes[0];
		const mergedLabel = `${node.label}/${only.label}`;
		if (only.kind === "project") {
			return { kind: "project", label: mergedLabel, root: only.root };
		}
		return { kind: "group", label: mergedLabel, fsPath: only.fsPath, children: only.children };
	}

	if (node.project && childNodes.length === 0) {
		return { kind: "project", label: node.label, root: node.project };
	}

	return { kind: "group", label: node.label, fsPath: node.fsPath, children: childNodes };
}
