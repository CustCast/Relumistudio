import * as vscode from 'vscode';
import { DataManager } from './dataManager';

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
            if (line.trim().startsWith('//')) return [];

            // Handle Prefixes
            const linePrefix = line.substring(0, position.character);
            if (data.flags && linePrefix.endsWith('#')) return this.getMapCompletions(data.flags, vscode.CompletionItemKind.Constant);
            if (data.sysFlags && linePrefix.endsWith('$')) return this.getMapCompletions(data.sysFlags, vscode.CompletionItemKind.Variable);
            if (data.works && linePrefix.endsWith('@')) return this.getMapCompletions(data.works, vscode.CompletionItemKind.Variable);

            const cmdContext = this.getCommandContext(document, position);
            
            // A. Top-Level Command Suggestion
            if (!cmdContext) {
                const commandItems: vscode.CompletionItem[] = [];
                if (data.hints) {
                    let cmdSafety = 0;
                    for (const [cmdName, def] of data.hints) {
                        if (token.isCancellationRequested) return [];
                        if (cmdSafety++ > 2000) break; 
                        const item = new vscode.CompletionItem(cmdName, vscode.CompletionItemKind.Function);
                        item.detail = def.Description || "Command";
                        if (def.Id !== undefined) item.detail = `[${def.Id}] ${item.detail}`;
                        commandItems.push(item);
                    }
                }
                return commandItems;
            }

            // B. Argument Suggestion
            const { name, argIndex } = cmdContext;
            
            let types: string[] = [];
            let dependsOn: number | undefined;

            if (data.hints && data.hints.has(name)) {
                const hint = data.hints.get(name);
                if (hint && hint.Params) {
                    const param = hint.Params.find(p => p.Index === argIndex);
                    if (param && param.Type) {
                        types = param.Type;
                        dependsOn = param.DependsOn;
                    }
                }
            } 

            if (!types || types.length === 0) return [];
            if (types.length === 1 && types[0] === 'Value') return [];

            const items: vscode.CompletionItem[] = [];

            if (types.includes('Pokemon') && data.pokes) {
                for (const [id, pokeName] of data.pokes) {
                    const item = new vscode.CompletionItem(`${pokeName} (${id})`, vscode.CompletionItemKind.Value);
                    item.insertText = id.toString();
                    item.detail = `Pokemon #${id}`;
                    item.sortText = pokeName;
                    items.push(item);
                }
            }

            if (types.includes('Item') && data.items) {
                for (const [id, itemName] of data.items) {
                    const item = new vscode.CompletionItem(`${itemName} (${id})`, vscode.CompletionItemKind.Value);
                    item.insertText = id.toString();
                    item.detail = `Item #${id}`;
                    item.sortText = itemName;
                    items.push(item);
                }
            }

            if (types.includes('Ball') && data.balls) {
                for (const [ballId, itemId] of data.balls) {
                    const ballName = data.items.get(itemId) || `Unknown Ball ${itemId}`;
                    const item = new vscode.CompletionItem(`${ballName} (${ballId})`, vscode.CompletionItemKind.Value);
                    item.insertText = String(ballId);
                    item.detail = `Ball #${ballId}`;
                    item.sortText = ballName;
                    items.push(item);
                }
            }

            if (types.includes('Form') && dependsOn !== undefined && data.forms) {
                const args = this.parseArgsSimple(line, cmdContext.openParenIndex);
                if (args && args.length > dependsOn) {
                    const val = args[dependsOn];
                    const pokeId = parseInt(val.trim());
                    if (!isNaN(pokeId)) {
                        const prefix = `${pokeId}_`;
                        for (const [key, formName] of data.forms) {
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

            return items;

        } catch (error) {
            DataManager.log(`[CompFatal] ${error}`);
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

    private getCommandContext(document: vscode.TextDocument, position: vscode.Position) {
        const lineText = document.lineAt(position.line).text;
        const commentIdx = lineText.indexOf('//');
        if (commentIdx !== -1 && position.character > commentIdx) return null;

        let depth = 0;
        let argIndex = 0;
        let openParenIndex = -1;

        for (let i = position.character - 1; i >= 0; i--) {
            const char = lineText[i];
            if (char === ')') depth++;
            else if (char === '(') {
                if (depth > 0) depth--;
                else { openParenIndex = i; break; }
            } else if (char === ',' && depth === 0) {
                argIndex++;
            }
        }

        if (openParenIndex === -1) return null;

        const textBefore = lineText.substring(0, openParenIndex);
        const match = textBefore.match(/([A-Z0-9_]+)\s*$/);
        if (match) return { name: match[1], argIndex, openParenIndex };

        return null;
    }

    private parseArgsSimple(lineText: string, openParenIndex: number): string[] {
        const args: string[] = [];
        let current = "";
        let inString = false;
        let depth = 0;

        for (let i = openParenIndex + 1; i < lineText.length; i++) {
            const char = lineText[i];
            if (char === "'") { inString = !inString; current += char; }
            else if (!inString) {
                if (char === '(') { depth++; current += char; }
                else if (char === ')') {
                    if (depth > 0) { depth--; current += char; }
                    else { args.push(current.trim()); return args; }
                }
                else if (char === ',' && depth === 0) { args.push(current.trim()); current = ""; }
                else current += char;
            } else current += char;
        }
        if (current) args.push(current.trim());
        return args;
    }
}