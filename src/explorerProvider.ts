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
    | 'macro'
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
        else if (type === 'macro') this.iconPath = new vscode.ThemeIcon('symbol-snippet');
        else if (type === 'command') this.iconPath = new vscode.ThemeIcon('terminal');
        else if (type === 'category') this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        else if (type === 'usage-file') this.iconPath = vscode.ThemeIcon.File;
        else if (type === 'usage-event') this.iconPath = new vscode.ThemeIcon('symbol-method');

        // --- Commands ---
        if (type === 'file' && resourceUri) {
            this.command = { command: 'vscode.open', title: 'Open Script', arguments: [resourceUri] };
        }
        if (type === 'event' && resourceUri && contextData?.position) {
            this.command = { command: 'vscode.open', title: 'Open Event', arguments: [resourceUri, { selection: new vscode.Range(contextData.position, contextData.position) }] };
        }
        if (type === 'usage-event' && resourceUri && contextData?.position) {
            this.command = { command: 'vscode.open', title: 'Go to Usage', arguments: [resourceUri, { selection: new vscode.Range(contextData.position, contextData.position) }] };
        }
        if (label.startsWith("Filtering by:")) {
             this.command = { command: 'relumistudio.clearExplorerFilter', title: 'Clear Filter', arguments: [] };
             this.iconPath = new vscode.ThemeIcon('filter-remove');
        }
    }
}

export class RelumiExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ExplorerNode | undefined | null | void> = new vscode.EventEmitter<ExplorerNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ExplorerNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private _filterString: string = "";
    private _usedWordsCache: Map<string, number> | undefined;

    // viewId determines which section this provider controls
    constructor(private viewId: string) {
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

        // =========================================================
        // 1. ROOT LEVEL (Decide based on viewId)
        // =========================================================
        if (!element) {
            const roots: ExplorerNode[] = [];

            // Add Filter Banner if active (only to the top of the list)
            if (this._filterString) {
                roots.push(new ExplorerNode(
                    `Filtering by: "${this._filterString}"`, 
                    vscode.TreeItemCollapsibleState.None, 
                    'category',
                    undefined, undefined, "Click to Clear"
                ));
            }

            // --- VIEW: SCRIPTS ---
            if (this.viewId === 'relumi-scripts') {
                const folders = vscode.workspace.workspaceFolders;
                if (folders) {
                    const scriptsUri = vscode.Uri.joinPath(folders[0].uri, 'scripts');
                    if (fs.existsSync(scriptsUri.fsPath)) {
                        // Return files directly at root level
                        return roots.concat(this.filterNodes(await this.getFiles(scriptsUri)));
                    }
                }
                return [new ExplorerNode("No 'scripts' folder", vscode.TreeItemCollapsibleState.None, 'root')];
            }

            // Prepare Cache for Data Views
            if (!this._usedWordsCache) {
                this._usedWordsCache = await this.scanWorkspaceForWords();
            }
            const usedWords = this._usedWordsCache!;

            // --- VIEW: DATA (Flags, SysFlags, Works) ---
            if (this.viewId === 'relumi-data') {
                // Flags
                const flagNodes = Array.from(data.flags.values()).filter(f => usedWords.has(f.Name));
                const filteredFlags = this.filterDataNodes(flagNodes);
                if (filteredFlags.length > 0 || !this._filterString) {
                    roots.push(new ExplorerNode(`Flags (${filteredFlags.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
                }
                // SysFlags
                const sysFlagNodes = Array.from(data.sysFlags.values()).filter(f => usedWords.has(f.Name));
                const filteredSysFlags = this.filterDataNodes(sysFlagNodes);
                if (filteredSysFlags.length > 0 || !this._filterString) {
                    roots.push(new ExplorerNode(`SysFlags (${filteredSysFlags.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
                }
                // Works
                const workNodes = Array.from(data.works.values()).filter(w => usedWords.has(w.Name));
                const filteredWorks = this.filterDataNodes(workNodes);
                if (filteredWorks.length > 0 || !this._filterString) {
                    roots.push(new ExplorerNode(`Works (${filteredWorks.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
                }
                return roots;
            }

            // --- VIEW: COMMANDS (Commands, Macros) ---
            if (this.viewId === 'relumi-commands') {
                // Commands
                const usedCmdNodes = Array.from(data.commands.values()).filter(c => usedWords.has(c.Name));
                const filteredUsedCmds = this.filterDataNodes(usedCmdNodes);
                if (filteredUsedCmds.length > 0 || !this._filterString) {
                    roots.push(new ExplorerNode(`Commands (${filteredUsedCmds.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
                }
                // Macros
                const macroKeys = Array.from(usedWords.keys()).filter(k => k.startsWith('_MACRO_'));
                const filteredMacros = this.filterStringList(macroKeys);
                if (filteredMacros.length > 0 || !this._filterString) {
                    roots.push(new ExplorerNode(`Macros (${filteredMacros.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
                }
                return roots;
            }

            // --- VIEW: ANALYSIS (Unused) ---
            if (this.viewId === 'relumi-analysis') {
                const uFlags = this.filterDataNodes(Array.from(data.flags.values()).filter(f => !usedWords.has(f.Name)));
                if(uFlags.length > 0) roots.push(new ExplorerNode(`Unused Flags (${uFlags.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));

                const uSys = this.filterDataNodes(Array.from(data.sysFlags.values()).filter(f => !usedWords.has(f.Name)));
                if(uSys.length > 0) roots.push(new ExplorerNode(`Unused SysFlags (${uSys.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));

                const uWorks = this.filterDataNodes(Array.from(data.works.values()).filter(w => !usedWords.has(w.Name)));
                if(uWorks.length > 0) roots.push(new ExplorerNode(`Unused Works (${uWorks.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));

                const uCmds = this.filterDataNodes(Array.from(data.commands.values()).filter(c => !usedWords.has(c.Name)));
                if(uCmds.length > 0) roots.push(new ExplorerNode(`Unused Commands (${uCmds.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category'));
                
                return roots;
            }

            return [];
        }

        // =========================================================
        // 2. CHILD GENERATION (Shared Logic)
        // =========================================================

        const usedWords = this._usedWordsCache || new Map<string, number>();

        // Scripts & Folders
        if (element.type === 'folder' && element.resourceUri) {
            return this.filterNodes(await this.getFiles(element.resourceUri));
        }
        if (element.type === 'file' && element.resourceUri) {
            return this.getEventsInFile(element.resourceUri);
        }

        // Data Categories
        if (element.label.startsWith("Flags")) {
            const list = Array.from(data.flags.values()).filter(f => usedWords.has(f.Name)).sort((a, b) => (a.Id || 0) - (b.Id || 0));
            return this.filterDataNodes(list).map(f => this.createDataNode(f, usedWords.get(f.Name), 'flag'));
        }
        if (element.label.startsWith("SysFlags")) {
            const list = Array.from(data.sysFlags.values()).filter(f => usedWords.has(f.Name)).sort((a, b) => (a.Id || 0) - (b.Id || 0));
            return this.filterDataNodes(list).map(f => this.createDataNode(f, usedWords.get(f.Name), 'sysflag'));
        }
        if (element.label.startsWith("Works")) {
            const list = Array.from(data.works.values()).filter(w => usedWords.has(w.Name)).sort((a, b) => (a.Id || 0) - (b.Id || 0));
            return this.filterDataNodes(list).map(w => this.createDataNode(w, usedWords.get(w.Name), 'work'));
        }
        
        // Command Categories
        if (element.label.startsWith("Commands")) {
            const list = Array.from(data.commands.values()).filter(c => usedWords.has(c.Name)).sort((a, b) => a.Name.localeCompare(b.Name));
            return this.filterDataNodes(list).map(c => this.createDataNode(c, usedWords.get(c.Name), 'command'));
        }
        if (element.label.startsWith("Macros")) {
            const macroKeys = Array.from(usedWords.keys()).filter(k => k.startsWith('_MACRO_')).sort();
            return this.filterStringList(macroKeys).map(m => {
                return new ExplorerNode(`${m} (${usedWords.get(m)||0})`, vscode.TreeItemCollapsibleState.Collapsed, 'macro', undefined, {name: m, type: 'macro'}, "Macro");
            });
        }

        // Unused Categories
        if (element.label.startsWith("Unused Flags")) {
            const list = Array.from(data.flags.values()).filter(f => !usedWords.has(f.Name));
            return this.filterDataNodes(list).map(f => new ExplorerNode(f.Name, vscode.TreeItemCollapsibleState.None, 'flag', undefined, undefined, "Unused"));
        }
        if (element.label.startsWith("Unused SysFlags")) {
            const list = Array.from(data.sysFlags.values()).filter(f => !usedWords.has(f.Name));
            return this.filterDataNodes(list).map(f => new ExplorerNode(f.Name, vscode.TreeItemCollapsibleState.None, 'sysflag', undefined, undefined, "Unused"));
        }
        if (element.label.startsWith("Unused Works")) {
            const list = Array.from(data.works.values()).filter(w => !usedWords.has(w.Name));
            return this.filterDataNodes(list).map(w => new ExplorerNode(w.Name, vscode.TreeItemCollapsibleState.None, 'work', undefined, undefined, "Unused"));
        }
        if (element.label.startsWith("Unused Commands")) {
            const list = Array.from(data.commands.values()).filter(c => !usedWords.has(c.Name));
            return this.filterDataNodes(list).map(c => new ExplorerNode(c.Name, vscode.TreeItemCollapsibleState.None, 'command', undefined, undefined, c.Description));
        }

        // Usage Drilldown
        if ((element.type === 'flag' || element.type === 'sysflag' || element.type === 'work' || element.type === 'command' || element.type === 'macro') && element.contextData) {
            return await this.findUsageFiles(element.contextData.name, element.type);
        }
        if (element.type === 'usage-file' && element.contextData) {
            return this.findUsageEvents(element.contextData.uri, element.contextData.keyword);
        }

        return [];
    }

    // --- HELPERS ---

    private createDataNode(item: any, count: number | undefined, type: ExplorerNodeType): ExplorerNode {
        const c = count || 0;
        const idStr = item.Id !== undefined ? `[${item.Id}] ` : '';
        const label = `${idStr}${item.Name} (${c})`;
        // Unused items might not need collapsible state if we don't drill down
        const state = c > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        return new ExplorerNode(label, state, type, undefined, { name: item.Name, type: type }, item.Description);
    }

    private readContent(uri: vscode.Uri): string {
        const openDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        if (openDoc) return openDoc.getText();
        return fs.readFileSync(uri.fsPath, 'utf-8');
    }

    private filterNodes(nodes: ExplorerNode[]): ExplorerNode[] {
        if (!this._filterString) return nodes;
        return nodes.filter(n => n.label.toLowerCase().includes(this._filterString));
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

    private filterStringList(items: string[]): string[] {
        if (!this._filterString) return items;
        return items.filter(item => item.toLowerCase().includes(this._filterString));
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
                const content = this.readContent(uri);
                const eventCount = (content.match(/^([a-zA-Z0-9_]+):/gm) || []).length;
                nodes.push(new ExplorerNode(`${name} (${eventCount})`, vscode.TreeItemCollapsibleState.Collapsed, 'file', uri));
            }
        }
        return nodes.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.label.localeCompare(b.label);
        });
    }

    private getEventsInFile(fileUri: vscode.Uri): ExplorerNode[] {
        const content = this.readContent(fileUri);
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

    private async findUsageFiles(keyword: string, type: string): Promise<ExplorerNode[]> {
        let searchToken = keyword;
        let isWholeWord = false;
        if (type === 'flag') searchToken = '#' + keyword;
        else if (type === 'sysflag') searchToken = '$' + keyword;
        else if (type === 'work') searchToken = '@' + keyword;
        else if (type === 'command' || type === 'macro') isWholeWord = true;

        const nodes: ExplorerNode[] = [];
        const files = await vscode.workspace.findFiles('**/*.ev');
        const wholeWordRegex = isWholeWord ? new RegExp(`\\b${keyword}\\b`, 'g') : null;

        for (const file of files) {
            const content = this.readContent(file);
            let matchCount = 0;
            if (isWholeWord) {
                const matches = content.match(wholeWordRegex!);
                matchCount = matches ? matches.length : 0;
            } else {
                if (content.includes(searchToken)) {
                    const regex = new RegExp(searchToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                    matchCount = (content.match(regex) || []).length;
                }
            }
            if (matchCount > 0) {
                const nextStepKeyword = isWholeWord ? keyword : searchToken;
                nodes.push(new ExplorerNode(`${path.basename(file.fsPath)} (${matchCount})`, vscode.TreeItemCollapsibleState.Collapsed, 'usage-file', file, { keyword: nextStepKeyword, uri: file }));
            }
        }
        return nodes;
    }

    private findUsageEvents(fileUri: vscode.Uri, keyword: string): ExplorerNode[] {
        const content = this.readContent(fileUri);
        const lines = content.split(/\r?\n/);
        const nodes: ExplorerNode[] = [];
        let currentEvent = "Global / Top Level";
        const isWholeWord = /^[a-zA-Z0-9_]+$/.test(keyword); 
        const regex = isWholeWord ? new RegExp(`\\b${keyword}\\b`) : null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const eventMatch = line.match(/^([a-zA-Z0-9_]+):/);
            if (eventMatch) currentEvent = eventMatch[1];
            if (line.trim().startsWith(';')) continue;

            let isMatch = false;
            if (isWholeWord) isMatch = regex!.test(line);
            else isMatch = line.includes(keyword);

            if (isMatch) {
                nodes.push(new ExplorerNode(currentEvent, vscode.TreeItemCollapsibleState.None, 'usage-event', fileUri, { position: new vscode.Position(i, 0) }, `Line ${i + 1}`));
            }
        }
        return nodes;
    }

    private async scanWorkspaceForWords(): Promise<Map<string, number>> {
        const usageMap = new Map<string, number>();
        const files = await vscode.workspace.findFiles('**/*.ev');
        for (const file of files) {
            const content = this.readContent(file);
            const words = content.split(/[^a-zA-Z0-9_]+/);
            for (const w of words) {
                if (w) usageMap.set(w, (usageMap.get(w) || 0) + 1);
            }
        }
        return usageMap;
    }
}