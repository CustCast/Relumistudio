import * as vscode from 'vscode';
import { DataManager } from './dataManager';

// Interface for context
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

        const data = DataManager.getInstance();
        const line = document.lineAt(position.line).text;
        const linePrefix = line.substring(0, position.character);

        // 0. Ignore Comments
        if (line.trim().startsWith('//')) return [];

        // 1. Prefix Completion
        if (linePrefix.endsWith('#')) return this.getMapCompletions(data.flags, vscode.CompletionItemKind.Constant);
        if (linePrefix.endsWith('$')) return this.getMapCompletions(data.sysFlags, vscode.CompletionItemKind.Variable);
        if (linePrefix.endsWith('@')) return this.getMapCompletions(data.works, vscode.CompletionItemKind.Variable);

        // 2. Argument Completion
        const cmdContext = this.getCommandContext(document, position);
        
        // FIX: If not inside a command argument context, provide Command Suggestions
        if (!cmdContext) {
             const commandItems: vscode.CompletionItem[] = [];
             for (const [cmdName, def] of data.commands) {
                 const item = new vscode.CompletionItem(cmdName, vscode.CompletionItemKind.Function);
                 item.detail = def.Description || "Command";
                 commandItems.push(item);
             }
             return commandItems;
        }

        const { name, argIndex, lineText, argStart } = cmdContext;
        
        let types: string[] = [];
        let dependsOn: number | undefined;

        const hint = data.hints.get(name);
        if (hint && hint.Params) {
            const param = hint.Params.find(p => p.Index === argIndex);
            if (param && param.Type) {
                types = param.Type;
                dependsOn = param.DependsOn;
            }
        }

        if (types.length === 0) {
            const cmd = data.commands.get(name);
            if (cmd && cmd.Args && cmd.Args.length > argIndex) {
                const t = cmd.Args[argIndex].Type;
                types = Array.isArray(t) ? t : [t];
            }
        }

        if (types.length === 0) return [];

        // FIX: Explicit type
        const items: vscode.CompletionItem[] = [];

        if (types.includes('Pokemon')) {
            for (const [id, pokeName] of data.pokes) {
                const item = new vscode.CompletionItem(`${pokeName} (${id})`, vscode.CompletionItemKind.Value);
                item.insertText = id.toString();
                item.detail = `Pokemon #${id}`;
                item.sortText = pokeName;
                items.push(item);
            }
        }

        if (types.includes('Item')) {
            for (const [id, itemName] of data.items) {
                const item = new vscode.CompletionItem(`${itemName} (${id})`, vscode.CompletionItemKind.Value);
                item.insertText = id.toString();
                item.detail = `Item #${id}`;
                item.sortText = itemName;
                items.push(item);
            }
        }

        if (types.includes('Ball')) {
             for (const [ballId, itemId] of data.balls) {
                const ballName = data.items.get(itemId) || "Unknown Ball";
                const item = new vscode.CompletionItem(`${ballName} (${ballId})`, vscode.CompletionItemKind.Value);
                item.insertText = ballId.toString();
                item.detail = `Ball #${ballId}`;
                item.sortText = ballName;
                items.push(item);
            }
        }

        if (types.includes('Form') && dependsOn !== undefined) {
             const args = this.parseArgs(lineText, argStart);
             if (args[dependsOn]) {
                 const pokeId = parseInt(args[dependsOn]);
                 if (!isNaN(pokeId)) {
                     const prefix = `${pokeId}_`;
                     for (const [key, formName] of data.forms) {
                         if (key.startsWith(prefix)) {
                             const formId = key.split('_')[1];
                             const item = new vscode.CompletionItem(`${formName} (${formId})`, vscode.CompletionItemKind.EnumMember);
                             item.insertText = formId;
                             item.detail = `Form #${formId}`;
                             items.push(item);
                         }
                     }
                 }
             }
        }

        return items;
    }

    private getMapCompletions(map: Map<string, any>, kind: vscode.CompletionItemKind): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
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
        const cmdRegex = /([A-Z_][A-Z0-9_]*)\s*\(/g;
        let match;
        
        while ((match = cmdRegex.exec(line)) !== null) {
            const start = match.index + match[0].length; 
            if (start > position.character) break;

            let inString = false;
            let depth = 0;
            let argIndex = 0;
            let isClosed = false;

            for (let i = start; i < line.length; i++) {
                // If we reached the cursor position
                if (i === position.character) {
                    if (!isClosed) {
                        return { 
                            name: match[1], 
                            argStart: start, 
                            lineText: line,
                            argIndex: argIndex
                        };
                    }
                    break;
                }

                const char = line[i];
                if (char === "'") {
                    inString = !inString;
                } else if (!inString) {
                    if (char === '(') depth++;
                    else if (char === ')') {
                        if (depth > 0) depth--;
                        else isClosed = true;
                    } 
                    else if (char === ',' && depth === 0) {
                        argIndex++;
                    }
                }
            }
        }

        return null;
    }

    private parseArgs(lineText: string, argStart: number): string[] {
        const args: string[] = [];
        let current = "";
        let inString = false;
        let depth = 0;

        for (let i = argStart; i < lineText.length; i++) {
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
                        // End of command
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