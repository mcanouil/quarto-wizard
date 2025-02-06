"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExtensionItems = createExtensionItems;
exports.showExtensionQuickPick = showExtensionQuickPick;
const vscode = __importStar(require("vscode"));
const extensions_1 = require("../utils/extensions");
function createExtensionItems(extensions) {
    return extensions.map((ext) => ({
        label: (0, extensions_1.formatExtensionLabel)(ext),
        description: (0, extensions_1.getGitHubLink)(ext),
        buttons: [
            {
                iconPath: new vscode.ThemeIcon("github"),
                tooltip: "Open GitHub Repository",
            },
        ],
        url: (0, extensions_1.getGitHubLink)(ext),
    }));
}
async function showExtensionQuickPick(extensionsList, recentlyInstalled) {
    const groupedExtensions = [
        {
            label: "Recently Installed",
            kind: vscode.QuickPickItemKind.Separator,
        },
        ...createExtensionItems(recentlyInstalled),
        {
            label: "All Extensions",
            kind: vscode.QuickPickItemKind.Separator,
        },
        ...createExtensionItems(extensionsList.filter((ext) => !recentlyInstalled.includes(ext))).sort((a, b) => a.label.localeCompare(b.label)),
    ];
    const quickPick = vscode.window.createQuickPick();
    quickPick.items = groupedExtensions;
    quickPick.placeholder = "Select Quarto extensions to install";
    quickPick.canSelectMany = true;
    quickPick.matchOnDescription = true;
    quickPick.onDidTriggerItemButton((e) => {
        const url = e.item.url;
        if (url) {
            vscode.env.openExternal(vscode.Uri.parse(url));
        }
    });
    return new Promise((resolve) => {
        quickPick.onDidAccept(() => {
            resolve(quickPick.selectedItems);
            quickPick.hide();
        });
        quickPick.show();
    });
}
//# sourceMappingURL=extensionsQuickPick.js.map