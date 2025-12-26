import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DataManager } from './dataManager';

// Types of nodes in our tree
type ExplorerNodeType = 
    | 'root' 
    | 'folder' 
    | 'file' 
    | 'event' 
    | 'flag' 
    | 'sysflag'
    | 'work' 
    | 'command' 
    | 'category' 
    | 'usage-file' 
    | 'usage-event';

export class ExplorerNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: ExplorerNodeType,
        public readonly resourceUri?: vscode.Uri,
        public readonly contextData?: any,
        public readonly description?: string
    ) {
        super(label, collapsibleState);
        
        // --- Icons ---
        if (type === 'folder') this.iconPath = vscode.ThemeIcon.Folder;
        else if (type === 'file') this.iconPath = vscode.ThemeIcon.File;
        else if (type === 'event') this.iconPath = new vscode.ThemeIcon('symbol-event');
        else if (type === 'flag') this.iconPath = new vscode.ThemeIcon('flag');
        else if (type === 'sysflag') this.iconPath = new vscode.ThemeIcon('shield');
        else if (type === 'work') this.iconPath = new vscode.ThemeIcon('tools');
        else if (type === 'command') this.iconPath = new vscode.ThemeIcon('terminal');
        else if (type === 'category') this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        else if (type === 'usage-file') this.iconPath = vscode.ThemeIcon.File;
        else if (type === 'usage-event') this.iconPath = new vscode.ThemeIcon('symbol-method');

        // --- Commands ---
        if (type === 'file' && resourceUri) {
            this.command = {
                command: 'vscode.open',
                title: 'Open Script',
                arguments: [resourceUri]
            };
        }
        if (type === 'event' && resourceUri && contextData?.position) {
            this.command = {
                command: 'vscode.open',
                title: 'Open Event',
                arguments: [resourceUri, { selection: new vscode.Range(contextData.position, contextData.position) }]
            };
        }
        if (type === 'usage-event' && resourceUri && contextData?.position) {
            this.command = {
                command: 'vscode.open',
                title: 'Go to Usage',
                arguments: [resourceUri, { selection: new vscode.Range(contextData.position, contextData.position) }]
            };
        }
        if (label.startsWith("Filtering by:")) {
             this.command = {
                command: 'relumistudio.clearExplorerFilter',
                title: 'Clear Filter',
                arguments: []
            };
            this.iconPath = new vscode.ThemeIcon('filter-remove');
        }
    }
}

export class RelumiExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ExplorerNode | undefined | null | void> = new vscode.EventEmitter<ExplorerNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ExplorerNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private _filterString: string = "";
    private _usedWordsCache: Map<string, number> | undefined;

    constructor() {
        DataManager.getInstance().onDataLoadedEmitter.event(() => this.refresh());
    }

    public refresh(clearCache: boolean = true): void {
        if (clearCache) {
            this._usedWordsCache = undefined;
        }
        this._onDidChangeTreeData.fire();
    }

    public setFilter(filter: string) {
        this._filterString = filter.toLowerCase();
        this.refresh(false); 
    }

    public getFilterString(): string {
        return this._filterString;
    }

    getTreeItem(element: ExplorerNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ExplorerNode): Promise<ExplorerNode[]> {
        const data = DataManager.getInstance();

        // --- 1. Root Nodes ---
        if (!element) {
            const roots: ExplorerNode[] = [];

            // 1. Scripts
            let scriptsCount = 0;
            const folders = vscode.workspace.workspaceFolders;
            if (folders) {
                const scriptsUri = vscode.Uri.joinPath(folders[0].uri, 'scripts');
                if (fs.existsSync(scriptsUri.fsPath)) {
                    const nodes = await this.getFiles(scriptsUri);
                    scriptsCount = this.filterNodes(nodes).length;
                }
            }
            if (scriptsCount > 0 || !this._filterString) {
                roots.push(new ExplorerNode(`Scripts (${scriptsCount})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
            }

            // Prepare Usage Cache
            if (!this._usedWordsCache) {
                this._usedWordsCache = await this.scanWorkspaceForWords();
            }
            const usedWords = this._usedWordsCache!;

            // 2. Flags
            const flagNodes = Array.from(data.flags.values()).filter(f => usedWords.has(f.Name));
            const filteredFlags = this.filterDataNodes(flagNodes);
            if (filteredFlags.length > 0 || !this._filterString) {
                roots.push(new ExplorerNode(`Flags (${filteredFlags.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
            }

            // 3. SysFlags
            const sysFlagNodes = Array.from(data.sysFlags.values()).filter(f => usedWords.has(f.Name));
            const filteredSysFlags = this.filterDataNodes(sysFlagNodes);
            if (filteredSysFlags.length > 0 || !this._filterString) {
                roots.push(new ExplorerNode(`SysFlags (${filteredSysFlags.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
            }

            // 4. Works
            const workNodes = Array.from(data.works.values()).filter(w => usedWords.has(w.Name));
            const filteredWorks = this.filterDataNodes(workNodes);
            if (filteredWorks.length > 0 || !this._filterString) {
                roots.push(new ExplorerNode(`Works (${filteredWorks.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
            }

            // 5. Unused Flags
            const unusedFlagNodes = Array.from(data.flags.values()).filter(f => !usedWords.has(f.Name));
            const filteredUnusedFlags = this.filterDataNodes(unusedFlagNodes);
            if (filteredUnusedFlags.length > 0 || !this._filterString) {
                roots.push(new ExplorerNode(`Unused Flags (${filteredUnusedFlags.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
            }

            // 6. Unused SysFlags
            const unusedSysFlagNodes = Array.from(data.sysFlags.values()).filter(f => !usedWords.has(f.Name));
            const filteredUnusedSysFlags = this.filterDataNodes(unusedSysFlagNodes);
            if (filteredUnusedSysFlags.length > 0 || !this._filterString) {
                roots.push(new ExplorerNode(`Unused SysFlags (${filteredUnusedSysFlags.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
            }

            // 7. Unused Works
            const unusedWorkNodes = Array.from(data.works.values()).filter(w => !usedWords.has(w.Name));
            const filteredUnusedWorks = this.filterDataNodes(unusedWorkNodes);
            if (filteredUnusedWorks.length > 0 || !this._filterString) {
                roots.push(new ExplorerNode(`Unused Works (${filteredUnusedWorks.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
            }

            // 8. Commands
            const cmdNodes = Array.from(data.commands.values());
            const filteredCmds = this.filterDataNodes(cmdNodes);
            if (filteredCmds.length > 0 || !this._filterString) {
                roots.push(new ExplorerNode(`Commands (${filteredCmds.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
            }

            if (this._filterString) {
                const clearNode = new ExplorerNode(
                    `Filtering by: "${this._filterString}"`, 
                    vscode.TreeItemCollapsibleState.None, 
                    'category',
                    undefined,
                    undefined,
                    "Click to Clear"
                );
                roots.unshift(clearNode);
            }
            return roots;
        }

        // --- CHILD GENERATION ---

        if (element.label.startsWith("Scripts")) {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders) return [];
            const scriptsUri = vscode.Uri.joinPath(folders[0].uri, 'scripts');
            if (fs.existsSync(scriptsUri.fsPath)) {
                return this.filterNodes(await this.getFiles(scriptsUri));
            }
            return [new ExplorerNode("No 'scripts' folder", vscode.TreeItemCollapsibleState.None, 'root')];
        }

        if (element.type === 'folder' && element.resourceUri) {
            return this.filterNodes(await this.getFiles(element.resourceUri));
        }

        if (element.type === 'file' && element.resourceUri) {
            return this.getEventsInFile(element.resourceUri);
        }

        const usedWords = this._usedWordsCache || new Map<string, number>();

        // Flags
        if (element.label.startsWith("Flags")) {
            const list = Array.from(data.flags.values())
                .filter(f => usedWords.has(f.Name))
                .sort((a, b) => (a.Id || 0) - (b.Id || 0));
            
            return this.filterDataNodes(list).map(f => {
                const count = usedWords.get(f.Name) || 0;
                const label = f.Id !== undefined ? `[${f.Id}] ${f.Name} (${count})` : `${f.Name} (${count})`;
                return new ExplorerNode(label, vscode.TreeItemCollapsibleState.Collapsed, 'flag', undefined, { name: f.Name, type: 'flag' }, f.Description);
            });
        }

        // SysFlags
        if (element.label.startsWith("SysFlags")) {
            const list = Array.from(data.sysFlags.values())
                .filter(f => usedWords.has(f.Name))
                .sort((a, b) => (a.Id || 0) - (b.Id || 0));
            
            return this.filterDataNodes(list).map(f => {
                const count = usedWords.get(f.Name) || 0;
                const label = f.Id !== undefined ? `[${f.Id}] ${f.Name} (${count})` : `${f.Name} (${count})`;
                return new ExplorerNode(label, vscode.TreeItemCollapsibleState.Collapsed, 'sysflag', undefined, { name: f.Name, type: 'sysflag' }, f.Description);
            });
        }

        // Works
        if (element.label.startsWith("Works")) {
            const list = Array.from(data.works.values())
                .filter(w => usedWords.has(w.Name))
                .sort((a, b) => (a.Id || 0) - (b.Id || 0));
            
            return this.filterDataNodes(list).map(w => {
                const count = usedWords.get(w.Name) || 0;
                const label = w.Id !== undefined ? `[${w.Id}] ${w.Name} (${count})` : `${w.Name} (${count})`;
                return new ExplorerNode(label, vscode.TreeItemCollapsibleState.Collapsed, 'work', undefined, { name: w.Name, type: 'work' }, w.Description);
            });
        }

        // Usage Drilldown
        if ((element.type === 'flag' || element.type === 'sysflag' || element.type === 'work') && element.contextData) {
            return await this.findUsageFiles(element.contextData.name, element.type);
        }

        if (element.type === 'usage-file' && element.contextData) {
            return this.findUsageEvents(element.contextData.uri, element.contextData.keyword);
        }

        // Unused
        if (element.label.startsWith("Unused Flags")) {
            const list = Array.from(data.flags.values())
                .filter(f => !usedWords.has(f.Name))
                .sort((a, b) => (a.Id || 0) - (b.Id || 0));
            return this.filterDataNodes(list).map(f => {
                const label = f.Id !== undefined ? `[${f.Id}] ${f.Name}` : f.Name;
                return new ExplorerNode(label, vscode.TreeItemCollapsibleState.None, 'flag', undefined, undefined, "Unused");
            });
        }

        if (element.label.startsWith("Unused SysFlags")) {
            const list = Array.from(data.sysFlags.values())
                .filter(f => !usedWords.has(f.Name))
                .sort((a, b) => (a.Id || 0) - (b.Id || 0));
            return this.filterDataNodes(list).map(f => {
                const label = f.Id !== undefined ? `[${f.Id}] ${f.Name}` : f.Name;
                return new ExplorerNode(label, vscode.TreeItemCollapsibleState.None, 'sysflag', undefined, undefined, "Unused");
            });
        }

        if (element.label.startsWith("Unused Works")) {
            const list = Array.from(data.works.values())
                .filter(w => !usedWords.has(w.Name))
                .sort((a, b) => (a.Id || 0) - (b.Id || 0));
            return this.filterDataNodes(list).map(w => {
                const label = w.Id !== undefined ? `[${w.Id}] ${w.Name}` : w.Name;
                return new ExplorerNode(label, vscode.TreeItemCollapsibleState.None, 'work', undefined, undefined, "Unused");
            });
        }

        if (element.label.startsWith("Commands")) {
            const list = Array.from(data.commands.values())
                .sort((a, b) => a.Name.localeCompare(b.Name));
            return this.filterDataNodes(list).map(c => {
                const count = usedWords.get(c.Name) || 0;
                return new ExplorerNode(`${c.Name} (${count})`, vscode.TreeItemCollapsibleState.None, 'command', undefined, undefined, c.Description);
            });
        }

        return [];
    }

    // --- HELPER METHODS ---

    private filterNodes(nodes: ExplorerNode[]): ExplorerNode[] {
        if (!this._filterString) return nodes;
        return nodes.filter(n => 
            n.label.toLowerCase().includes(this._filterString) || 
            (n.description && n.description.toLowerCase().includes(this._filterString))
        );
    }

    private filterDataNodes<T extends { Name: string, Id?: number, Description?: string }>(items: T[]): T[] {
        if (!this._filterString) return items;
        return items.filter(item => {
            const nameMatch = item.Name.toLowerCase().includes(this._filterString);
            const idMatch = item.Id ? item.Id.toString().includes(this._filterString) : false;
            const descMatch = item.Description ? item.Description.toLowerCase().includes(this._filterString) : false;
            return nameMatch || idMatch || descMatch;
        });
    }

    private async getFiles(folderUri: vscode.Uri): Promise<ExplorerNode[]> {
        const entries = await vscode.workspace.fs.readDirectory(folderUri);
        const nodes: ExplorerNode[] = [];
        for (const [name, type] of entries) {
            if (name.startsWith('.')) continue;
            const uri = vscode.Uri.joinPath(folderUri, name);
            if (type === vscode.FileType.Directory) {
                nodes.push(new ExplorerNode(name, vscode.TreeItemCollapsibleState.Collapsed, 'folder', uri));
            } else if (type === vscode.FileType.File && name.endsWith('.ev')) {
                nodes.push(new ExplorerNode(name, vscode.TreeItemCollapsibleState.Collapsed, 'file', uri));
            }
        }
        return nodes.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.label.localeCompare(b.label);
        });
    }

    private getEventsInFile(fileUri: vscode.Uri): ExplorerNode[] {
        const content = fs.readFileSync(fileUri.fsPath, 'utf-8');
        const nodes: ExplorerNode[] = [];
        const lines = content.split(/\r?\n/);
        const regex = /^([a-zA-Z0-9_]+):/;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(regex);
            if (match) {
                nodes.push(new ExplorerNode(match[1], vscode.TreeItemCollapsibleState.None, 'event', fileUri, { position: new vscode.Position(i, 0) }));
            }
        }
        return nodes;
    }

    private async findUsageFiles(keyword: string, type: 'flag' | 'sysflag' | 'work'): Promise<ExplorerNode[]> {
        // SysFlags usually start with '$', Flags '#', Works '@'
        let prefix = '#';
        if (type === 'sysflag') prefix = '$';
        if (type === 'work') prefix = '@';
        
        const searchToken = prefix + keyword;
        const nodes: ExplorerNode[] = [];
        const files = await vscode.workspace.findFiles('**/*.ev');

        for (const file of files) {
            const content = fs.readFileSync(file.fsPath, 'utf-8');
            if (content.includes(searchToken)) {
                const regex = new RegExp(searchToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                const count = (content.match(regex) || []).length;
                
                nodes.push(new ExplorerNode(`${path.basename(file.fsPath)} (${count})`, vscode.TreeItemCollapsibleState.Collapsed, 'usage-file', file, { keyword: searchToken, uri: file }));
            }
        }
        return nodes;
    }

    private findUsageEvents(fileUri: vscode.Uri, keyword: string): ExplorerNode[] {
        const content = fs.readFileSync(fileUri.fsPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const nodes: ExplorerNode[] = [];
        let currentEvent = "Global / Top Level";

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const eventMatch = line.match(/^([a-zA-Z0-9_]+):/);
            if (eventMatch) currentEvent = eventMatch[1];

            if (line.includes(keyword) && !line.trim().startsWith(';')) {
                nodes.push(new ExplorerNode(currentEvent, vscode.TreeItemCollapsibleState.None, 'usage-event', fileUri, { position: new vscode.Position(i, 0) }, `Line ${i + 1}`));
            }
        }
        return nodes;
    }

    private async scanWorkspaceForWords(): Promise<Map<string, number>> {
        const usageMap = new Map<string, number>();
        const files = await vscode.workspace.findFiles('**/*.ev');
        for (const file of files) {
            const content = fs.readFileSync(file.fsPath, 'utf-8');
            const words = content.split(/[^a-zA-Z0-9_]+/);
            for (const w of words) {
                if (w) usageMap.set(w, (usageMap.get(w) || 0) + 1);
            }
        }
        return usageMap;
    }
}