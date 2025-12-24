import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// --- Interfaces ---
export interface CommandDef {
    Name: string;
    Args: ArgDef[];
    Description?: string;
}

export interface ArgDef {
    TentativeName: string;
    Type: string | string[]; 
    Description?: string;
}

export interface HintConfig {
    Cmd: string;
    Description?: string;
    Params?: HintParam[];
    Sentence?: HintSentencePart[];
    IsEnabled?: boolean;
}

export interface HintParam {
    Index: number;
    Ref: string;
    Description?: string;
    Type?: string[]; 
    DependsOn?: number;
    Fragments?: { [key: string]: string };
    ShowZero?: string[];
}

export interface HintSentencePart {
    Text: string;
    IsRef: boolean;
}

export interface SimpleDef {
    Name: string;
    Description?: string;
}

export class DataManager {
    // Script Data Maps
    public commands: Map<string, CommandDef> = new Map();
    public hints: Map<string, HintConfig> = new Map();
    public flags: Map<string, SimpleDef> = new Map();
    public sysFlags: Map<string, SimpleDef> = new Map();
    public works: Map<string, SimpleDef> = new Map();

    // Game Data Maps
    public pokes: Map<number, string> = new Map();
    public items: Map<number, string> = new Map();
    public forms: Map<string, string> = new Map(); 
    public balls: Map<number, number> = new Map(); 

    // Event Emitter for Live Updates
    public readonly onHintsChangedEmitter = new vscode.EventEmitter<void>();

    private static instance: DataManager;
    private constructor() {}

    public static getInstance(): DataManager {
        if (!DataManager.instance) DataManager.instance = new DataManager();
        return DataManager.instance;
    }

    public async loadData() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;

        const rootPath = folders[0].uri.fsPath;
        const jsonDir = path.join(rootPath, 'JSON');

        // 1. Load JSONs
        this.loadGeneric(path.join(jsonDir, 'commands.json'), this.commands, 'Name');
        this.loadGeneric(path.join(jsonDir, 'hints.json'), this.hints, 'Cmd');
        this.loadGeneric(path.join(jsonDir, 'flags.json'), this.flags, 'Name');
        this.loadGeneric(path.join(jsonDir, 'sys_flags.json'), this.sysFlags, 'Name');
        this.loadGeneric(path.join(jsonDir, 'work.json'), this.works, 'Name');

        // 2. Load Game Assets
        await this.loadGameAssets(rootPath);
    }

    // --- HINT EDITOR METHODS ---

    // 1. Live Update (Memory Only)
    public updateHintCache(newHints: HintConfig[]) {
        newHints.forEach(h => this.hints.set(h.Cmd, h));
        this.onHintsChangedEmitter.fire(); // Trigger Inlay Refresh
    }

    // 2. Save to Disk
    public saveHintsToDisk(newHints: HintConfig[]) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;
        const filePath = path.join(folders[0].uri.fsPath, 'JSON', 'hints.json');

        try {
            // Update memory first
            this.updateHintCache(newHints);
            
            // Write to file
            fs.writeFileSync(filePath, JSON.stringify(newHints, null, 2), 'utf8');
            vscode.window.showInformationMessage('Hints saved to disk.');
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to save hints: ${e}`);
        }
    }

    // 3. Cancel/Reload
    public reloadHintsFromDisk() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;
        const filePath = path.join(folders[0].uri.fsPath, 'JSON', 'hints.json');
        
        // Clear and Reload
        this.hints.clear();
        this.loadGeneric(filePath, this.hints, 'Cmd');
        
        // Refresh UI
        this.onHintsChangedEmitter.fire();
    }

    public removeFlag(name: string) { if (this.flags.has(name)) { this.flags.delete(name); this.saveMap('flags.json', this.flags); } }
    public removeSysFlag(name: string) { if (this.sysFlags.has(name)) { this.sysFlags.delete(name); this.saveMap('sys_flags.json', this.sysFlags); } }
    public removeWork(name: string) { if (this.works.has(name)) { this.works.delete(name); this.saveMap('work.json', this.works); } }

    private saveMap(filename: string, map: Map<string, any>) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;
        const filePath = path.join(folders[0].uri.fsPath, 'JSON', filename);
        try {
            const list = Array.from(map.values()).sort((a, b) => a.Name.localeCompare(b.Name));
            fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
        } catch (e) { vscode.window.showErrorMessage(`Failed to save ${filename}: ${e}`); }
    }

    private async loadGameAssets(rootPath: string) {
        const assetsPath = path.join(rootPath, 'Assets');
        const englishPath = path.join(assetsPath, 'format_msbt', 'en', 'english');
        
        if (fs.existsSync(englishPath)) {
            this.parseUnityAsset(path.join(englishPath, 'english_ss_monsname.asset'), this.pokes);
            this.parseUnityAsset(path.join(englishPath, 'english_ss_itemname.asset'), this.items);
            this.parseUnityFormAsset(path.join(englishPath, 'english_ss_zkn_form.asset'), this.forms);
        }
        const uiDbPath = path.join(assetsPath, 'masterdatas', 'UIDatabase.asset');
        if (fs.existsSync(uiDbPath)) {
            this.parseUIDatabase(uiDbPath, this.balls);
        }
    }

    private parseUnityAsset(filePath: string, targetMap: Map<number, string>) {
        if (!fs.existsSync(filePath)) return;
        const content = fs.readFileSync(filePath, 'utf-8');
        const regex = /arrayIndex:\s*(\d+)[\s\S]*?str:\s*(.+)/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            let str = match[2].trim();
            if (str.startsWith("'") && str.endsWith("'")) str = str.slice(1, -1);
            targetMap.set(parseInt(match[1]), str);
        }
    }

    private parseUnityFormAsset(filePath: string, targetMap: Map<string, string>) {
        if (!fs.existsSync(filePath)) return;
        const content = fs.readFileSync(filePath, 'utf-8');
        const regex = /labelName:\s*ZKN_FORM_(\d+)_(\d+)[\s\S]*?str:\s*(.+)/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            let str = match[3].trim();
            if (str.startsWith("'") && str.endsWith("'")) str = str.slice(1, -1);
            targetMap.set(`${parseInt(match[1])}_${parseInt(match[2])}`, str);
        }
    }

    private parseUIDatabase(filePath: string, targetMap: Map<number, number>) {
        if (!fs.existsSync(filePath)) return;
        const content = fs.readFileSync(filePath, 'utf-8');
        const regex = /BallId:\s*(\d+)[\s\S]*?ItemNo:\s*(\d+)/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            targetMap.set(parseInt(match[1]), parseInt(match[2]));
        }
    }

    private loadGeneric(filePath: string, map: Map<string, any>, keyProp: string) {
        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (Array.isArray(data)) {
                    data.forEach(item => { if (item[keyProp]) map.set(item[keyProp], item); });
                }
            } catch (e) { console.error(`Error loading ${path.basename(filePath)}`, e); }
        }
    }
}