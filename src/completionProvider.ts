import * as vscode from 'vscode';
import { DataManager } from './dataManager';

interface CommandContext {
    name: string;
    argStart: number;
    lineText: string;
    argIndex: number;
}

export class BDSPCompletionProvider implements vscode.CompletionItemProvider {

    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[]> {

        try {
            const data = DataManager.getInstance();
            if (!data) return [];

            const line = document.lineAt(position.line).text;
            const linePrefix = line.substring(0, position.character);

            if (line.trim().startsWith('//')) return [];

            if (data.flags && linePrefix.endsWith('#')) return this.getMapCompletions(data.flags, vscode.CompletionItemKind.Constant);
            if (data.sysFlags && linePrefix.endsWith('$')) return this.getMapCompletions(data.sysFlags, vscode.CompletionItemKind.Variable);
            if (data.works && linePrefix.endsWith('@')) return this.getMapCompletions(data.works, vscode.CompletionItemKind.Variable);

            const cmdContext = this.getCommandContext(document, position);
            
            if (!cmdContext) {
                const commandItems: vscode.CompletionItem[] = [];
                if (data.commands) {
                    let cmdSafety = 0;
                    for (const [cmdName, def] of data.commands) {
                        if (token.isCancellationRequested) return [];
                        if (cmdSafety++ > 2000) break;
                        const item = new vscode.CompletionItem(cmdName, vscode.CompletionItemKind.Function);
                        item.detail = def.Description || "Command";
                        commandItems.push(item);
                    }
                }
                return commandItems;
            }

            const { name, argIndex, lineText, argStart } = cmdContext;
            
            let types: string[] = [];
            let dependsOn: number | undefined;

            // 3. Resolve Types (Strict Priority)
            if (data.hints && data.hints.has(name)) {
                // If hints exist, we USE hints. We do NOT fall back to commands.
                const hint = data.hints.get(name);
                if (hint && hint.Params) {
                    const param = hint.Params.find(p => p.Index === argIndex);
                    if (param && param.Type) {
                        types = param.Type;
                        dependsOn = param.DependsOn;
                    }
                }
            } else if (data.commands) {
                // Fallback only if no hint exists for this command
                const cmd = data.commands.get(name);
                if (cmd && cmd.Args && argIndex < cmd.Args.length) {
                    const t = cmd.Args[argIndex].Type;
                    types = Array.isArray(t) ? t : [t];
                }
            }

            if (types.length === 0) return [];

            const items: vscode.CompletionItem[] = [];

            if (types.includes('Pokemon') && data.pokes) {
                for (const [id, pokeName] of data.pokes) {
                    if (token.isCancellationRequested) return [];
                    const item = new vscode.CompletionItem(`${pokeName} (${id})`, vscode.CompletionItemKind.Value);
                    item.insertText = id.toString();
                    item.detail = `Pokemon #${id}`;
                    item.sortText = pokeName;
                    items.push(item);
                }
            }

            if (types.includes('Item') && data.items) {
                for (const [id, itemName] of data.items) {
                    if (token.isCancellationRequested) return [];
                    const item = new vscode.CompletionItem(`${itemName} (${id})`, vscode.CompletionItemKind.Value);
                    item.insertText = id.toString();
                    item.detail = `Item #${id}`;
                    item.sortText = itemName;
                    items.push(item);
                }
            }

            if (types.includes('Ball')) {
                if (data.balls && data.items) {
                    let loopSafety = 0;
                    for (const [ballId, itemId] of data.balls) {
                        if (token.isCancellationRequested) return [];
                        if (loopSafety++ > 1000) break;
                        const ballName = data.items.get(itemId) || `Unknown Ball ${itemId}`;
                        const item = new vscode.CompletionItem(`${ballName} (${ballId})`, vscode.CompletionItemKind.Value);
                        item.insertText = String(ballId);
                        item.detail = `Ball #${ballId}`;
                        item.sortText = ballName;
                        items.push(item);
                    }
                }
            }

            if (types.includes('Form') && dependsOn !== undefined && data.forms) {
                try {
                    const args = this.parseArgs(lineText, argStart);
                    if (args && args.length > dependsOn) {
                        const val = args[dependsOn];
                        if (val) {
                            const pokeId = parseInt(val.trim());
                            if (!isNaN(pokeId)) {
                                const prefix = `${pokeId}_`;
                                let formLoopSafety = 0;
                                for (const [key, formName] of data.forms) {
                                    if (token.isCancellationRequested) return [];
                                    if (formLoopSafety++ > 2000) break;
                                    if (key.startsWith(prefix)) {
                                        const parts = key.split('_');
                                        if (parts.length > 1) {
                                            const formId = parts[1];
                                            const item = new vscode.CompletionItem(`${formName} (${formId})`, vscode.CompletionItemKind.EnumMember);
                                            item.insertText = formId;
                                            item.detail = `Form #${formId}`;
                                            items.push(item);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { }
            }

            return items;

        } catch (error) {
            console.error("[BDSP-Comp] FATAL ERROR:", error);
            return [];
        }
    }

    private getMapCompletions(map: Map<string, any>, kind: vscode.CompletionItemKind): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        if (!map) return items;
        for (const [key, def] of map) {
            const cleanLabel = key.replace(/^[#$@]/, ''); 
            const item = new vscode.CompletionItem(cleanLabel, kind);
            item.detail = def.Description || key;
            item.insertText = cleanLabel; 
            items.push(item);
        }
        return items;
    }

    private getCommandContext(document: vscode.TextDocument, position: vscode.Position): CommandContext | null {
        const line = document.lineAt(position.line).text;
        
        const commentIdx = line.indexOf('//');
        if (commentIdx !== -1 && position.character > commentIdx) return null;

        const cmdRegex = /([A-Z_][A-Z0-9_]*)\s*\(/g;
        let match;
        let validContext: CommandContext | null = null;
        let safetyCounter = 0;
        
        while ((match = cmdRegex.exec(line)) !== null && safetyCounter++ < 100) {
            const start = match.index + match[0].length; 
            if (start > position.character) break;

            let inString = false;
            let depth = 0;
            let argIndex = 0;
            let closed = false;

            for (let i = start; i <= line.length; i++) {
                if (i === position.character) {
                    if (!closed) {
                        validContext = { 
                            name: match[1], 
                            argStart: start, 
                            lineText: line,
                            argIndex: argIndex
                        };
                    }
                    break;
                }

                if (i === line.length) break;

                const char = line[i];
                if (char === "'") {
                    inString = !inString;
                } else if (!inString) {
                    if (char === '(') depth++;
                    else if (char === ')') {
                        if (depth > 0) depth--;
                        else closed = true;
                    } 
                    else if (char === ',' && depth === 0) {
                        argIndex++;
                    }
                }
            }
        }

        return validContext;
    }

    private parseArgs(lineText: string, argStart: number): string[] {
        const args: string[] = [];
        let current = "";
        let inString = false;
        let depth = 0;
        let safety = 0;

        if (argStart >= lineText.length) return [];

        for (let i = argStart; i < lineText.length; i++) {
            if (safety++ > 2000) break; 

            const char = lineText[i];
            if (char === "'") {
                inString = !inString;
                current += char;
            } else if (!inString) {
                if (char === '(') {
                    depth++;
                    current += char;
                } else if (char === ')') {
                    if (depth > 0) {
                        depth--;
                        current += char;
                    } else {
                        args.push(current.trim());
                        return args;
                    }
                } else if (char === ',' && depth === 0) {
                    args.push(current.trim());
                    current = "";
                } else {
                    current += char;
                }
            } else {
                current += char;
            }
        }
        
        if (current) args.push(current.trim());
        return args;
    }
}