import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// --- Tree Node Types ---
export class RefItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'root' | 'category' | 'file' | 'usage',
        public readonly location?: vscode.Location,
        public readonly children: RefItem[] = []
    ) {
        super(label, collapsibleState);
        
        if (type === 'usage' && location) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [location.uri, { selection: location.range }]
            };
            this.iconPath = new vscode.ThemeIcon('go-to-file');
            this.description = `Line ${location.range.start.line + 1}`;
        }
        else if (type === 'file') {
            this.iconPath = vscode.ThemeIcon.File;
            this.description = location ? path.dirname(vscode.workspace.asRelativePath(location.uri)) : '';
        }
        else if (type === 'category') {
            this.iconPath = new vscode.ThemeIcon('symbol-folder');
        }
        else if (type === 'root') {
            this.iconPath = new vscode.ThemeIcon('symbol-event');
        }
    }
}

export class ReferenceTreeProvider implements vscode.TreeDataProvider<RefItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RefItem | undefined | null | void> = new vscode.EventEmitter<RefItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RefItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private rootItems: RefItem[] = [];
    private currentTarget: string = "";

    constructor() {}

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public async findReferences(word: string) {
        this.currentTarget = word;
        this.rootItems = []; // Clear previous
        
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Regexes
        const defRegex = new RegExp(`^\\s*${escaped}:\\s*$`);
        const jumpRegex = new RegExp(`Jump\\s*\\(\\s*'${escaped}'`);
        const callRegex = new RegExp(`Call\\s*\\(\\s*'${escaped}'`);
        
        // Fallback for others (matches word not inside Jump/Call/Def)
        // This is tricky, so we just check if it matches the word but NOT the others
        const generalRegex = new RegExp(`(?<![\\w])` + escaped + `(?![\\w])`);

        // Containers
        const definitions: RefItem[] = [];
        const jumps: Map<string, RefItem[]> = new Map(); // File -> Usages
        const calls: Map<string, RefItem[]> = new Map();
        const others: Map<string, RefItem[]> = new Map();

        const files = await vscode.workspace.findFiles('**/*.ev');

        for (const file of files) {
            const content = fs.readFileSync(file.fsPath, 'utf-8');
            if (!content.includes(word)) continue;

            const lines = content.split(/\r?\n/);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.includes('//')) {
                    const idx = line.indexOf('//');
                    // Simple check: if word is after //, skip
                    if (line.indexOf(word) > idx) continue; 
                }

                if (!generalRegex.test(line)) continue;

                const range = new vscode.Range(i, 0, i, line.length);
                const loc = new vscode.Location(file, range);
                const lineTrim = line.trim();
                const item = new RefItem(lineTrim, vscode.TreeItemCollapsibleState.None, 'usage', loc);

                if (defRegex.test(line)) {
                    // Definition is special, doesn't group by file usually since there is only 1 (ideally)
                    // But we'll list it directly under "Definition" category
                    definitions.push(item);
                }
                else if (jumpRegex.test(line)) {
                    this.addToMap(jumps, file, item);
                }
                else if (callRegex.test(line)) {
                    this.addToMap(calls, file, item);
                }
                else {
                    this.addToMap(others, file, item);
                }
            }
        }

        // Build Tree
        const root = new RefItem(word, vscode.TreeItemCollapsibleState.Expanded, 'root');
        
        // 1. Definitions
        if (definitions.length > 0) {
            root.children.push(new RefItem("Definition", vscode.TreeItemCollapsibleState.Expanded, 'category', undefined, definitions));
        }

        // 2. Jumps
        if (jumps.size > 0) {
            const jumpNodes = this.mapToNodes(jumps);
            root.children.push(new RefItem(`Jumps (${this.countMap(jumps)})`, vscode.TreeItemCollapsibleState.Collapsed, 'category', undefined, jumpNodes));
        }

        // 3. Calls
        if (calls.size > 0) {
            const callNodes = this.mapToNodes(calls);
            root.children.push(new RefItem(`Calls (${this.countMap(calls)})`, vscode.TreeItemCollapsibleState.Collapsed, 'category', undefined, callNodes));
        }

        // 4. Others
        if (others.size > 0) {
            const otherNodes = this.mapToNodes(others);
            root.children.push(new RefItem(`Other References (${this.countMap(others)})`, vscode.TreeItemCollapsibleState.Collapsed, 'category', undefined, otherNodes));
        }

        if (root.children.length === 0) {
            root.children.push(new RefItem("No references found", vscode.TreeItemCollapsibleState.None, 'usage'));
        }

        this.rootItems = [root];
        this.refresh();
    }

    private addToMap(map: Map<string, RefItem[]>, file: vscode.Uri, item: RefItem) {
        const key = file.fsPath;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(item);
    }

    private mapToNodes(map: Map<string, RefItem[]>): RefItem[] {
        const nodes: RefItem[] = [];
        map.forEach((items, pathKey) => {
            const uri = vscode.Uri.file(pathKey);
            const fileName = path.basename(pathKey);
            const fileNode = new RefItem(fileName, vscode.TreeItemCollapsibleState.Collapsed, 'file', new vscode.Location(uri, new vscode.Position(0,0)), items);
            nodes.push(fileNode);
        });
        return nodes;
    }

    private countMap(map: Map<string, RefItem[]>): number {
        let count = 0;
        map.forEach(list => count += list.length);
        return count;
    }

    getTreeItem(element: RefItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: RefItem): Promise<RefItem[]> {
        if (!element) {
            return Promise.resolve(this.rootItems);
        }
        return Promise.resolve(element.children);
    }
}