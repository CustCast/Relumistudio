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
}

export interface HintParam {
    Index: number;
    Ref: string;
    Description?: string;
    Type?: string[];       // e.g. ["Pokemon", "Value"]
    DependsOn?: number;    // Index of the argument this depends on (for Forms)
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

    // Game Data Maps (From Unity Assets)
    public pokes: Map<number, string> = new Map();
    public items: Map<number, string> = new Map();
    public forms: Map<string, string> = new Map(); // Key format: "PokeID_FormID"
    public balls: Map<number, number> = new Map(); // Key: BallID -> Value: ItemID

    private static instance: DataManager;
    private constructor() {}

    public static getInstance(): DataManager {
        if (!DataManager.instance) {
            DataManager.instance = new DataManager();
        }
        return DataManager.instance;
    }

    public async loadData() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;

        const rootPath = folders[0].uri.fsPath;
        const jsonDir = path.join(rootPath, 'JSON');

        // 1. Load Script Definitions (JSON)
        this.loadGeneric(path.join(jsonDir, 'commands.json'), this.commands, 'Name');
        this.loadGeneric(path.join(jsonDir, 'hints.json'), this.hints, 'Cmd');
        this.loadGeneric(path.join(jsonDir, 'flags.json'), this.flags, 'Name');
        this.loadGeneric(path.join(jsonDir, 'sys_flags.json'), this.sysFlags, 'Name');
        this.loadGeneric(path.join(jsonDir, 'work.json'), this.works, 'Name');

        // 2. Load Game Assets (Pokemon, Items, Balls) from Unity files
        await this.loadGameAssets(rootPath);
    }

    private async loadGameAssets(rootPath: string) {
        const assetsPath = path.join(rootPath, 'Assets');
        const englishPath = path.join(assetsPath, 'format_msbt', 'en', 'english');
        
        // 1. Load Texts (Pokemon, Items, Forms)
        if (fs.existsSync(englishPath)) {
            console.log("ReLumiStudio: Parsing Game Text Assets...");
            
            this.parseUnityAsset(path.join(englishPath, 'english_ss_monsname.asset'), this.pokes);
            this.parseUnityAsset(path.join(englishPath, 'english_ss_itemname.asset'), this.items);
            this.parseUnityFormAsset(path.join(englishPath, 'english_ss_zkn_form.asset'), this.forms);
            
            console.log(`ReLumiStudio: Loaded ${this.pokes.size} Pokemon, ${this.items.size} Items.`);
        } else {
            console.warn("ReLumiStudio: Could not find Assets/format_msbt/en/english. Game data will be missing.");
        }

        // 2. Load Database (Balls)
        const uiDbPath = path.join(assetsPath, 'masterdatas', 'UIDatabase.asset');
        if (fs.existsSync(uiDbPath)) {
            console.log("ReLumiStudio: Parsing UIDatabase...");
            this.parseUIDatabase(uiDbPath, this.balls);
        }
    }

    // --- Regex Parsing Logic ---
    
    // Parses standard Unity arrays where index implies ID (Pokemon, Items)
    // Matches: "arrayIndex: 1" ... "str: Master Ball"
    private parseUnityAsset(filePath: string, targetMap: Map<number, string>) {
        if (!fs.existsSync(filePath)) return;
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const regex = /arrayIndex:\s*(\d+)[\s\S]*?str:\s*(.+)/g;
            
            let match;
            while ((match = regex.exec(content)) !== null) {
                const id = parseInt(match[1]);
                let str = match[2].trim();
                
                // Cleanup quotes if Unity serialized them
                if (str.startsWith("'") && str.endsWith("'")) {
                    str = str.slice(1, -1);
                }
                
                targetMap.set(id, str);
            }
        } catch (e) {
            console.error(`Error parsing ${path.basename(filePath)}`, e);
        }
    }

    // Parses Form assets which use "labelName" to encode the ID (ZKN_FORM_95_1)
    private parseUnityFormAsset(filePath: string, targetMap: Map<string, string>) {
        if (!fs.existsSync(filePath)) return;
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const regex = /labelName:\s*ZKN_FORM_(\d+)_(\d+)[\s\S]*?str:\s*(.+)/g;
            
            let match;
            while ((match = regex.exec(content)) !== null) {
                const pokeId = parseInt(match[1]); 
                const formId = parseInt(match[2]); 
                let str = match[3].trim();
                
                if (str.startsWith("'") && str.endsWith("'")) {
                    str = str.slice(1, -1);
                }
                
                targetMap.set(`${pokeId}_${formId}`, str);
            }
        } catch (e) {
            console.error(`Error parsing forms from ${path.basename(filePath)}`, e);
        }
    }

    // Parses UIDatabase to map Ball IDs to Item IDs
    private parseUIDatabase(filePath: string, targetMap: Map<number, number>) {
        if (!fs.existsSync(filePath)) return;
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            // Looks for - BallId: 1 \n ItemNo: 4
            const regex = /BallId:\s*(\d+)[\s\S]*?ItemNo:\s*(\d+)/g;
            
            let match;
            while ((match = regex.exec(content)) !== null) {
                targetMap.set(parseInt(match[1]), parseInt(match[2]));
            }
        } catch (e) {
            console.error(`Error parsing UIDatabase`, e);
        }
    }

    // Helper to load simple JSON lists
    private loadGeneric(filePath: string, map: Map<string, any>, keyProp: string) {
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    data.forEach(item => {
                        if (item[keyProp]) {
                            map.set(item[keyProp], item);
                        }
                    });
                }
            } catch (e) {
                console.error(`Error loading ${path.basename(filePath)}`, e);
            }
        }
    }
}