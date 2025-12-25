import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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
    public commands: Map<string, CommandDef> = new Map();
    public hints: Map<string, HintConfig> = new Map();
    public flags: Map<string, SimpleDef> = new Map();
    public sysFlags: Map<string, SimpleDef> = new Map();
    public works: Map<string, SimpleDef> = new Map();

    public pokes: Map<number, string> = new Map();
    public items: Map<number, string> = new Map();
    public forms: Map<string, string> = new Map(); 
    public balls: Map<number, number> = new Map(); 

    public messages: Map<string, Map<string, string>> = new Map();

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

        this.loadGeneric(path.join(jsonDir, 'commands.json'), this.commands, 'Name');
        this.loadGeneric(path.join(jsonDir, 'hints.json'), this.hints, 'Cmd');
        this.loadGeneric(path.join(jsonDir, 'flags.json'), this.flags, 'Name');
        this.loadGeneric(path.join(jsonDir, 'sys_flags.json'), this.sysFlags, 'Name');
        this.loadGeneric(path.join(jsonDir, 'work.json'), this.works, 'Name');

        await this.loadGameAssets(rootPath);
    }

    private async loadGameAssets(rootPath: string) {
        const assetsPath = path.join(rootPath, 'Assets');
        const englishPath = path.join(assetsPath, 'format_msbt', 'en', 'english');
        const searchPath = fs.existsSync(englishPath) ? englishPath : assetsPath;

        if (fs.existsSync(searchPath)) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(searchPath, '**/*.asset'));
            for (const file of files) {
                const fileName = path.basename(file.fsPath, '.asset');
                if (fileName.includes('monsname')) this.parseUnityAsset(file.fsPath, this.pokes);
                else if (fileName.includes('itemname')) this.parseUnityAsset(file.fsPath, this.items);
                else if (fileName.includes('zkn_form')) this.parseUnityFormAsset(file.fsPath, this.forms);
                else if (!fileName.includes('UIDatabase')) {
                    await this.parseMessageAsset(file.fsPath, fileName);
                }
            }
        }

        const uiDbPath = path.join(assetsPath, 'masterdatas', 'UIDatabase.asset');
        if (fs.existsSync(uiDbPath)) {
            this.parseUIDatabase(uiDbPath, this.balls);
        }
        
        console.log(`[DataManager] Loaded ${this.messages.size} message files.`);
    }

    private async parseMessageAsset(filePath: string, fileName: string) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (!content.includes('labelDataArray')) return;

            const rawName = fileName;
            const shortName = rawName.replace(/^english_/, '').replace(/^ss_/, '');
            const labelMap = new Map<string, string>();
            const lines = content.split(/\r?\n/);
            
            let inLabelArray = false;
            let currentLabel = "";
            let currentFullText = ""; 
            
            // Temporary Parser State
            let wordStr: string | null = null;
            let wordEventID: number | null = null;
            let wordTagIndex: number = -1;
            
            // --- UPDATED: Tag Map Stores Group ID ---
            // List of { globalIndex, groupID }
            let currentLabelTags: { id: number, group: number }[] = []; 
            let tempTagIndexValue: number = -1;
            let tempGroupIDValue: number = 1; // Default to 1 (Name)

            let inTagData = false;
            let inWordData = false;

            const commitWord = () => {
                if (wordStr !== null) {
                    currentFullText += wordStr;
                }
                
                if (wordTagIndex !== -1) {
                    // Check if we have a mapping
                    if (wordTagIndex < currentLabelTags.length) {
                        const tagDef = currentLabelTags[wordTagIndex];
                        // ENCODE FORMAT: {Index:Group} -> {0:2}
                        currentFullText += `{${tagDef.id}:${tagDef.group}}`;
                    } else {
                        // Fallback (assume Group 1)
                        currentFullText += `{${wordTagIndex}:1}`;
                    }
                }

                if (wordEventID !== null) {
                    if (wordEventID === 1) currentFullText += "{n}";
                    else if (wordEventID === 3) currentFullText += "{r}";
                    else if (wordEventID === 4) currentFullText += "{f}";
                    else if (wordEventID === 0 || wordEventID === 2 || wordEventID >= 5) { /* No op */ }
                    else currentFullText += "{n}";
                }
                
                wordStr = null;
                wordEventID = null;
                wordTagIndex = -1;
            };

            const resetLabelState = () => {
                currentFullText = "";
                wordStr = null;
                wordEventID = null;
                wordTagIndex = -1;
                currentLabelTags = []; 
                inTagData = false;
                inWordData = false;
                tempTagIndexValue = -1;
                tempGroupIDValue = 1;
            };

            for (let i = 0; i < lines.length; i++) {
                const rawLine = lines[i];
                const trimmed = rawLine.trim();
                const isNewItem = rawLine.trimStart().startsWith("-");
                const cleanLine = trimmed.replace(/^- /, ''); 

                if (cleanLine.startsWith("labelDataArray:")) {
                    inLabelArray = true;
                    continue;
                }

                if (inLabelArray) {
                    if (cleanLine.startsWith("labelName:")) {
                        commitWord(); 
                        if (currentLabel && currentFullText) {
                            labelMap.set(currentLabel.toLowerCase(), currentFullText);
                        }
                        currentLabel = cleanLine.substring("labelName:".length).trim();
                        resetLabelState();
                    }
                    
                    else if (cleanLine.startsWith("tagDataArray:")) {
                        inTagData = true;
                        inWordData = false;
                    }
                    else if (inTagData) {
                        if (cleanLine.startsWith("wordDataArray:")) {
                            if (tempTagIndexValue !== -1) {
                                currentLabelTags.push({ id: tempTagIndexValue, group: tempGroupIDValue });
                                tempTagIndexValue = -1;
                                tempGroupIDValue = 1;
                            }
                            inTagData = false;
                            inWordData = true;
                        } 
                        else if (cleanLine.startsWith("labelName:")) {
                            inTagData = false;
                            i--; continue;
                        }
                        else {
                            if (isNewItem && tempTagIndexValue !== -1) {
                                currentLabelTags.push({ id: tempTagIndexValue, group: tempGroupIDValue });
                                tempTagIndexValue = -1;
                                tempGroupIDValue = 1;
                            }
                            if (cleanLine.startsWith("tagIndex:")) {
                                const val = cleanLine.substring("tagIndex:".length).trim();
                                const id = parseInt(val);
                                if (!isNaN(id)) tempTagIndexValue = id;
                            }
                            // NEW: Capture Group ID
                            else if (cleanLine.startsWith("groupID:")) {
                                const val = cleanLine.substring("groupID:".length).trim();
                                const id = parseInt(val);
                                if (!isNaN(id)) tempGroupIDValue = id;
                            }
                        }
                    }

                    else if (inWordData) {
                        if (cleanLine.startsWith("labelName:")) {
                            inWordData = false;
                            i--; continue;
                        }
                        if (isNewItem) commitWord();

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
                        else if (cleanLine.startsWith("tagIndex:")) {
                            const val = cleanLine.substring("tagIndex:".length).trim();
                            const id = parseInt(val);
                            if (!isNaN(id)) wordTagIndex = id;
                        }
                    }
                }
            }
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