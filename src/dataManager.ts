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

    // Message Data [FileName (lowercase) -> [Label (lowercase) -> Text]]
    public messages: Map<string, Map<string, string>> = new Map();

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

        // 1. Load Definitions
        this.loadGeneric(path.join(jsonDir, 'commands.json'), this.commands, 'Name');
        this.loadGeneric(path.join(jsonDir, 'hints.json'), this.hints, 'Cmd');
        this.loadGeneric(path.join(jsonDir, 'flags.json'), this.flags, 'Name');
        this.loadGeneric(path.join(jsonDir, 'sys_flags.json'), this.sysFlags, 'Name');
        this.loadGeneric(path.join(jsonDir, 'work.json'), this.works, 'Name');

        // 2. Load Assets & Messages
        await this.loadGameAssets(rootPath);
    }

    private async loadGameAssets(rootPath: string) {
        const assetsPath = path.join(rootPath, 'Assets');
        const englishPath = path.join(assetsPath, 'format_msbt', 'en', 'english');
        
        // Search path: Look in specific english folder, fallback to Assets root
        const searchPath = fs.existsSync(englishPath) ? englishPath : assetsPath;

        if (fs.existsSync(searchPath)) {
            // Find all .asset files
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(searchPath, '**/*.asset'));

            for (const file of files) {
                const fileName = path.basename(file.fsPath, '.asset');

                // 1. Parse Game Data (Pokemon/Items/Forms)
                if (fileName.includes('monsname')) this.parseUnityAsset(file.fsPath, this.pokes);
                else if (fileName.includes('itemname')) this.parseUnityAsset(file.fsPath, this.items);
                else if (fileName.includes('zkn_form')) this.parseUnityFormAsset(file.fsPath, this.forms);
                
                // 2. Parse Messages (Skip known non-message files)
                else if (!fileName.includes('UIDatabase')) {
                    await this.parseMessageAsset(file.fsPath, fileName);
                }
            }
        }

        // Load UIDatabase
        const uiDbPath = path.join(assetsPath, 'masterdatas', 'UIDatabase.asset');
        if (fs.existsSync(uiDbPath)) {
            this.parseUIDatabase(uiDbPath, this.balls);
        }
        
        console.log(`[DataManager] Loaded ${this.messages.size} message files.`);
    }

    // --- UNITY ASSET PARSERS ---

    // Parses english_*.asset files for Messages
    private async parseMessageAsset(filePath: string, fileName: string) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (!content.includes('labelDataArray')) return;

            // Determine logical names
            const rawName = fileName;
            const shortName = rawName.replace(/^english_/, '').replace(/^ss_/, '');
            
            const labelMap = new Map<string, string>();

            const lines = content.split(/\r?\n/);
            
            let inLabelArray = false;
            let currentLabel = "";
            let currentFullText = ""; 
            
            let wordStr: string | null = null;
            let wordEventID: number | null = null;
            let inWordData = false;

            const commitWord = () => {
                if (wordStr !== null) {
                    currentFullText += wordStr;
                    if (wordEventID !== null) {
                        if (wordEventID === 1) currentFullText += "{n}";
                        else if (wordEventID === 3) currentFullText += "{r}";
                        else if (wordEventID === 4) currentFullText += "{f}";
                        else if (wordEventID === 0 || wordEventID === 2 || wordEventID >= 5) { /* No op */ }
                        else currentFullText += "{n}";
                    } else {
                        currentFullText += "{n}";
                    }
                }
                wordStr = null;
                wordEventID = null;
            };

            for (let i = 0; i < lines.length; i++) {
                const rawLine = lines[i];
                const trimmed = rawLine.trim();
                
                // FIX: Check for dash BEFORE stripping it to detect new list items
                const isNewItem = rawLine.trimStart().startsWith("-");
                
                // Strip dash for property checking
                const cleanLine = trimmed.replace(/^- /, ''); 

                if (cleanLine.startsWith("labelDataArray:")) {
                    inLabelArray = true;
                    continue;
                }

                if (inLabelArray) {
                    if (cleanLine.startsWith("labelName:")) {
                        commitWord(); // Commit any pending word
                        
                        // Save previous label
                        if (currentLabel && currentFullText) {
                            labelMap.set(currentLabel.toLowerCase(), currentFullText);
                        }
                        
                        // Start new label
                        currentLabel = cleanLine.substring("labelName:".length).trim();
                        currentFullText = "";
                        wordStr = null;
                        wordEventID = null;
                        inWordData = false;
                    }
                    else if (cleanLine.startsWith("wordDataArray:")) {
                        inWordData = true;
                    }
                    else if (inWordData) {
                        // Check for exit via new label properties
                        if (cleanLine.startsWith("arrayIndex:") || cleanLine.startsWith("labelName:")) {
                            inWordData = false;
                            // Re-evaluate this line in next loop if necessary, but here we just stop word processing
                            // Note: We don't verify if this is valid YAML structure traversal, but it works for Unity dumps.
                            
                            // If it's a sibling property of label (like arrayIndex), we just ignore it for now
                        } 
                        else {
                            // FIX: If this line started with "-", it means a NEW WORD in the array
                            if (isNewItem) {
                                commitWord();
                            }

                            if (cleanLine.startsWith("str:")) {
                                let val = cleanLine.substring("str:".length).trim();
                                if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
                                wordStr = val;
                            }
                            else if (cleanLine.startsWith("eventID:")) {
                                const val = cleanLine.substring("eventID:".length).trim();
                                const id = parseInt(val);
                                if (!isNaN(id)) wordEventID = id;
                            }
                        }
                    }
                }
            }
            // Final Commit
            commitWord();
            if (currentLabel && currentFullText) {
                labelMap.set(currentLabel.toLowerCase(), currentFullText);
            }

            this.messages.set(rawName.toLowerCase(), labelMap);
            this.messages.set(shortName.toLowerCase(), labelMap);

        } catch (e) {
            console.error(`Error parsing message file ${fileName}`, e);
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

    public getMessage(fileName: string, label: string): string | null {
        const cleanFile = fileName.toLowerCase();
        const cleanLabel = label.toLowerCase();
        const fileData = this.messages.get(cleanFile);
        if (fileData && fileData.has(cleanLabel)) {
            return fileData.get(cleanLabel)!;
        }
        return null;
    }

    public updateHintCache(newHints: HintConfig[]) { newHints.forEach(h => this.hints.set(h.Cmd, h)); this.onHintsChangedEmitter.fire(); }
    public saveHintsToDisk(newHints: HintConfig[]) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;
        const filePath = path.join(folders[0].uri.fsPath, 'JSON', 'hints.json');
        try { this.updateHintCache(newHints); fs.writeFileSync(filePath, JSON.stringify(newHints, null, 2), 'utf8'); vscode.window.showInformationMessage('Hints saved.'); } 
        catch (e) { vscode.window.showErrorMessage(`Save failed: ${e}`); }
    }
    public reloadHintsFromDisk() { /* ... */ }
    public removeFlag(name: string) { if (this.flags.has(name)) { this.flags.delete(name); this.saveMap('flags.json', this.flags); } }
    public removeSysFlag(name: string) { if (this.sysFlags.has(name)) { this.sysFlags.delete(name); this.saveMap('sys_flags.json', this.sysFlags); } }
    public removeWork(name: string) { if (this.works.has(name)) { this.works.delete(name); this.saveMap('work.json', this.works); } }
    private saveMap(filename: string, map: Map<string, any>) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;
        const filePath = path.join(folders[0].uri.fsPath, 'JSON', filename);
        try { const list = Array.from(map.values()).sort((a, b) => a.Name.localeCompare(b.Name)); fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8'); } catch (e) {}
    }
}