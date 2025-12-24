import * as vscode from 'vscode';

export class ScriptTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {
        // Refresh tree when active editor changes
        vscode.window.onDidChangeActiveTextEditor(() => this.refresh());
        vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent): void {
        if (vscode.window.activeTextEditor && changeEvent.document.uri.toString() === vscode.window.activeTextEditor.document.uri.toString()) {
            this.refresh();
        }
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        // If we are inside an element, return empty (flat list for now)
        if (element) {
            return Promise.resolve([]);
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'bdsp') {
            return Promise.resolve([]);
        }

        // FIX: Explicitly type the array
        const items: vscode.TreeItem[] = [];
        
        const text = editor.document.getText();
        const lines = text.split('\n');
        
        // Regex to match "LabelName:" at start of line
        const regex = /^\s*([A-Za-z0-9_]+):/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = regex.exec(line);
            if (match) {
                const labelName = match[1];
                const item = new vscode.TreeItem(labelName, vscode.TreeItemCollapsibleState.None);
                
                item.iconPath = new vscode.ThemeIcon('symbol-method');
                item.description = `Line ${i + 1}`;
                
                // Clicking the item jumps to the line
                item.command = {
                    command: 'editor.action.goToLocations',
                    title: 'Go to Label',
                    arguments: [
                        editor.document.uri,
                        new vscode.Position(i, 0),
                        [],
                        "goto",
                        ""
                    ]
                };
                
                items.push(item);
            }
        }

        return Promise.resolve(items);
    }
}