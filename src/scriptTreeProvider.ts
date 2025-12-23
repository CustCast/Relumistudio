import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ScriptTreeProvider implements vscode.TreeDataProvider<ScriptItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ScriptItem | undefined | null | void> = new vscode.EventEmitter<ScriptItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ScriptItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ScriptItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ScriptItem): Promise<ScriptItem[]> {
        // 1. Root Level: List all .ev files in the workspace
        if (!element) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return [];

            // Find all .ev files
            const files = await vscode.workspace.findFiles('**/*.ev');
            
            return files.sort((a, b) => path.basename(a.fsPath).localeCompare(path.basename(b.fsPath)))
                .map(fileUri => {
                    const fileName = path.basename(fileUri.fsPath);
                    // Collapsed state means it has children (scripts)
                    return new ScriptItem(fileName, vscode.TreeItemCollapsibleState.Collapsed, 'file', fileUri);
                });
        }

        // 2. Child Level: List "Scripts" (Labels) inside a file
        if (element.type === 'file' && element.resourceUri) {
            try {
                const content = fs.readFileSync(element.resourceUri.fsPath, 'utf-8');
                const scriptLabels = this.parseLabels(content);
                
                return scriptLabels.map(labelInfo => {
                    return new ScriptItem(labelInfo.name, vscode.TreeItemCollapsibleState.None, 'script', element.resourceUri, labelInfo.line);
                });
            } catch (e) {
                console.error("Error parsing file:", e);
                return [];
            }
        }

        return [];
    }

    // Regex to find labels like "Script_Name:"
    private parseLabels(content: string): { name: string, line: number }[] {
        const lines = content.split('\n');
        const results = [];
        const regex = /^\s*([A-Za-z0-9_]+):/;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(regex);
            if (match) {
                results.push({ name: match[1], line: i });
            }
        }
        return results;
    }
}

export class ScriptItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'file' | 'script',
        public readonly fileUri?: vscode.Uri,
        public readonly line?: number
    ) {
        super(label, collapsibleState);
        this.resourceUri = type === 'file' ? fileUri : undefined;
        
        if (type === 'file') {
            this.iconPath = vscode.ThemeIcon.File;
            this.contextValue = 'file';
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-function');
            this.contextValue = 'script';
            this.description = `Ln ${line! + 1}`;
            
            // Add click command to jump to line
            this.command = {
                command: 'vscode.open',
                title: 'Open Script',
                arguments: [
                    fileUri,
                    { selection: new vscode.Range(line || 0, 0, line || 0, 0) }
                ]
            };
        }
    }
}