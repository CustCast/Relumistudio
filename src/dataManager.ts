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
    Id?: number; // Added ID field
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
    
    // Mapping: MessageLabel (lowercase) -> SpeakerLabel (e.g. DLP_SPEAKERS_NAME_OAK)
    public msgWindowData: Map<string, string> = new Map();

    public messages: Map<string, Map<string, string>> = new Map();

    public readonly onHintsChangedEmitter = new vscode.EventEmitter<void>();
    public readonly onDataLoadedEmitter = new vscode.EventEmitter<void>();

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
        
        this.onDataLoadedEmitter.fire();
    }

    private async loadGameAssets(rootPath: string) {
        const assetsPath = path.join(rootPath, 'Assets');
        
        // 1. Scan English Message Files
        const englishPath = path.join(assetsPath, 'format_msbt', 'en', 'english');
        
        if (fs.existsSync(englishPath)) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(englishPath, '**/*.asset'));
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

        // 2. Load MsgWindowData
        const msgWindowPath = path.join(assetsPath, 'md', 'msgwindowdata', 'MsgWindowData.asset');
        if (fs.existsSync(msgWindowPath)) {
            this.parseMsgWindowData(msgWindowPath);
        } else {
            const msgWindowFiles = await vscode.workspace.findFiles('**/MsgWindowData.asset');
            if (msgWindowFiles.length > 0) {
                 this.parseMsgWindowData(msgWindowFiles[0].fsPath);
            }
        }

        // 3. UI Database
        const uiDbPath = path.join(assetsPath, 'masterdatas', 'UIDatabase.asset');
        if (fs.existsSync(uiDbPath)) {
            this.parseUIDatabase(uiDbPath, this.balls);
        }
        
        console.log(`[DataManager] Loaded ${this.messages.size} message files, ${this.msgWindowData.size} speaker mappings.`);
    }

    private async parseMessageAsset(filePath: string, fileName: string) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            
            const isSpeakerFile = fileName.includes('dlp_speakers_name') || fileName.includes('dlp_speaker_name');
            
            if (!content.includes('labelDataArray') && !isSpeakerFile) return;

            const rawName = fileName;
            const shortName = rawName.replace(/^english_/, '').replace(/^ss_/, '');
            const labelMap = new Map<string, string>();
            const lines = content.split(/\r?\n/);
            
            let inLabelArray = isSpeakerFile; 
            let currentLabel = "";
            let currentFullText = ""; 
            let wordStr: string | null = null;
            let wordEventID: number | null = null;
            let wordTagIndex: number = -1;
            let currentLabelTags: { id: number, group: number }[] = []; 
            let tempTagIndexValue: number = -1;
            let tempGroupIDValue: number = 1;
            let inTagData = false;
            let inWordData = false;

            const commitWord = () => {
                if (wordStr !== null) currentFullText += wordStr;
                if (wordTagIndex !== -1) {
                    if (wordTagIndex < currentLabelTags.length) {
                        const tagDef = currentLabelTags[wordTagIndex];
                        currentFullText += `{${tagDef.id}:${tagDef.group}}`;
                    } else {
                        currentFullText += `{${wordTagIndex}:1}`;
                    }
                }
                if (wordEventID !== null) {
                    if (wordEventID === 1) currentFullText += "{n}";
                    else if (wordEventID === 3) currentFullText += "{r}";
                    else if (wordEventID === 4) currentFullText += "{f}";
                    else if (wordEventID === 0 || wordEventID === 2 || wordEventID >= 5) { }
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
                const cleanLine = rawLine.trim().replace(/^- /, ''); 

                if (cleanLine.startsWith("labelDataArray:")) {
                    inLabelArray = true;
                    continue;
                }

                if (inLabelArray) {
                    if (cleanLine.startsWith("labelName:")) {
                        commitWord(); 
                        if (currentLabel && currentFullText) labelMap.set(currentLabel.toLowerCase(), currentFullText);
                        const match = cleanLine.match(/labelName:\s*(.+)/);
                        if (match) currentLabel = match[1].trim();
                        else currentLabel = cleanLine.substring("labelName:".length).trim();
                        resetLabelState();
                    }
                    else if (cleanLine.startsWith("tagDataArray:")) {
                        inTagData = true;
                        inWordData = false;
                    }
                    else if (inTagData) {
                        if (cleanLine.startsWith("wordDataArray:")) {
                            if (tempTagIndexValue !== -1) currentLabelTags.push({ id: tempTagIndexValue, group: tempGroupIDValue });
                            inTagData = false;
                            inWordData = true;
                        } 
                        else if (cleanLine.startsWith("labelName:")) {
                            inTagData = false;
                            i--; continue;
                        }
                        else {
                            if (rawLine.trimStart().startsWith("-") && tempTagIndexValue !== -1) {
                                currentLabelTags.push({ id: tempTagIndexValue, group: tempGroupIDValue });
                            }
                            if (cleanLine.startsWith("tagIndex:")) {
                                const val = parseInt(cleanLine.substring("tagIndex:".length).trim());
                                if (!isNaN(val)) tempTagIndexValue = val;
                            }
                            else if (cleanLine.startsWith("groupID:")) {
                                const val = parseInt(cleanLine.substring("groupID:".length).trim());
                                if (!isNaN(val)) tempGroupIDValue = val;
                            }
                        }
                    }
                    else if (inWordData) {
                        if (cleanLine.startsWith("labelName:")) {
                            inWordData = false;
                            i--; continue;
                        }
                        if (rawLine.trimStart().startsWith("-")) commitWord();

                        if (cleanLine.startsWith("str:")) {
                            const match = cleanLine.match(/str:\s*(.+)/);
                            if (match) {
                                let val = match[1].trim();
                                if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
                                wordStr = val;
                            }
                        }
                        else if (cleanLine.startsWith("eventID:")) {
                            const val = parseInt(cleanLine.substring("eventID:".length).trim());
                            if (!isNaN(val)) wordEventID = val;
                        }
                        else if (cleanLine.startsWith("tagIndex:")) {
                            const val = parseInt(cleanLine.substring("tagIndex:".length).trim());
                            if (!isNaN(val)) wordTagIndex = val;
                        }
                    }
                }
            }
            commitWord();
            if (currentLabel && currentFullText) labelMap.set(currentLabel.toLowerCase(), currentFullText);

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

    private parseMsgWindowData(filePath: string) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split(/\r?\n/);
            let currentLabel: string | null = null;
            
            const labelRegex = /^(?:- )?(?:label|labelName)\s*:\s*(.+)/i;
            const talkRegex = /^(?:talk_label|talkLabel)\s*:\s*(.+)/i;

            for (const line of lines) {
                const trimmed = line.trim();
                const labelMatch = trimmed.match(labelRegex);
                if (labelMatch) {
                    let val = labelMatch[1].trim();
                    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
                    currentLabel = val;
                }
                const talkMatch = trimmed.match(talkRegex);
                if (talkMatch && currentLabel) {
                    let val = talkMatch[1].trim();
                    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
                    this.msgWindowData.set(currentLabel.toLowerCase(), val);
                }
            }
        } catch (e) {
            console.error("Error parsing MsgWindowData", e);
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
        if (fileData && fileData.has(cleanLabel)) return fileData.get(cleanLabel)!;
        return null;
    }

    public getSpeaker(messageLabel: string): string | null {
        const speakerLabel = this.msgWindowData.get(messageLabel.toLowerCase());
        if (!speakerLabel) return null;
        const possibleKeys = ['dlp_speakers_name', 'english_dlp_speakers_name', 'dlp_speaker_name', 'english_dlp_speaker_name'];
        for (const key of possibleKeys) {
            const fileData = this.messages.get(key);
            if (fileData && fileData.has(speakerLabel.toLowerCase())) return fileData.get(speakerLabel.toLowerCase())!;
        }
        return speakerLabel;
    }

    public updateHintCache(newHints: HintConfig[]) { newHints.forEach(h => this.hints.set(h.Cmd, h)); this.onHintsChangedEmitter.fire(); }
    public saveHintsToDisk(newHints: HintConfig[]) { /* ... */ }
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