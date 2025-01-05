import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { findQuartoExtensions } from '../utils/extensions';

interface QuartoExtensionData {
  title?: string;
  author?: string;
  version?: string;
  contributes?: {
    filters?: any;
    formats?: any;
    metadata?: any;
    shortcodes?: any;
    'revealjs-plugins'?: any;
    project?: any;
  };
  source?: string;
}

function readYamlFile(filePath: string): QuartoExtensionData | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const data = yaml.load(fileContent) as any;
  return {
    title: data.title,
    author: data.author,
    version: data.version,
    contributes: data.contributes ? {} : undefined,
    source: data.source
  };
}

function readExtensions(workspaceFolder: string, extensions: string[]): Record<string, QuartoExtensionData> {
  const extensionsData: Record<string, QuartoExtensionData> = {};
  for (const ext of extensions) {
    let filePath = path.join(workspaceFolder, "_extensions", ext, "_extension.yml");
    if (!fs.existsSync(filePath)) {
      filePath = path.join(workspaceFolder, "_extensions", ext, "_extension.yaml");
    }
    const extData = readYamlFile(filePath);
    if (extData) {
      extensionsData[ext] = extData;
    }
  }
  return extensionsData;
}

class QuartoExtensionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly data?: QuartoExtensionData
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label}`;
    this.description = this.data ? `${this.data.version}` : '';
  }
}

class QuartoExtensionTreeDataProvider implements vscode.TreeDataProvider<QuartoExtensionTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<QuartoExtensionTreeItem | undefined | void> = new vscode.EventEmitter<QuartoExtensionTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<QuartoExtensionTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private extensionsData: Record<string, QuartoExtensionData>) {}

  getTreeItem(element: QuartoExtensionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: QuartoExtensionTreeItem): Thenable<QuartoExtensionTreeItem[]> {
    if (!element) {
      return Promise.resolve(this.getExtensionItems());
    }
    return Promise.resolve(this.getExtensionDetailItems(element));
  }

  private getExtensionItems(): QuartoExtensionTreeItem[] {
    return Object.keys(this.extensionsData).map(
      ext => new QuartoExtensionTreeItem(ext, vscode.TreeItemCollapsibleState.Collapsed, this.extensionsData[ext])
    );
  }

  private getExtensionDetailItems(element: QuartoExtensionTreeItem): QuartoExtensionTreeItem[] {
    const data = element.data;
    if (!data) {
      return [];
    }
    return [
      new QuartoExtensionTreeItem(`Title: ${data.title}`, vscode.TreeItemCollapsibleState.None),
      new QuartoExtensionTreeItem(`Author: ${data.author}`, vscode.TreeItemCollapsibleState.None),
      new QuartoExtensionTreeItem(`Version: ${data.version}`, vscode.TreeItemCollapsibleState.None),
      new QuartoExtensionTreeItem(`Source: ${data.source}`, vscode.TreeItemCollapsibleState.None),
      new QuartoExtensionTreeItem(`Contributes: ${JSON.stringify(data.contributes)}`, vscode.TreeItemCollapsibleState.None)
    ];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}

export class QuartoExtensionInstalled {
  private treeDataProvider: QuartoExtensionTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const extensionsList = findQuartoExtensions(path.join(workspaceFolder, "_extensions"));
    const extensionsData = readExtensions(workspaceFolder, extensionsList);

    this.treeDataProvider = new QuartoExtensionTreeDataProvider(extensionsData);
    const view = vscode.window.createTreeView('quartoWizard.extensionsInstalled', { treeDataProvider: this.treeDataProvider, showCollapseAll: true });
    context.subscriptions.push(view);
    context.subscriptions.push(
      vscode.commands.registerCommand('quartoWizard.extensionsInstalled.refresh', () => this.treeDataProvider.refresh())
    );
  }
}
