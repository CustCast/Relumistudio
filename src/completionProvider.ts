import * as vscode from 'vscode';
import { DataManager } from './dataManager';

// Interface for context
interface CommandContext {
    name: string;
    argIndex: number;
    currentArgPrefix: string;
    args: string[]; // Added: All previous arguments parsed
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

        // 1. Prefix Completion (Flags/Works)
        if (linePrefix.endsWith('#')) return this.getMapCompletions(data.flags, vscode.CompletionItemKind.Constant);
        if (linePrefix.endsWith('$')) return this.getMapCompletions(data.sysFlags, vscode.CompletionItemKind.Variable);
        if (linePrefix.endsWith('@')) return this.getMapCompletions(data.works, vscode.CompletionItemKind.Variable);

        // 2. Argument Completion
        const cmdContext = this.getCommandContext(document, position);
        if (!cmdContext) return [];

        const { name: commandName, argIndex, args: parsedArgs } = cmdContext;
        
        let types: string[] = [];
        let dependsOn: number | undefined;
        let paramName: string | undefined;

        // Fetch Hint Data
        const hint = data.hints.get(commandName);
        if (hint && hint.Params) {
            const param = hint.Params.find(p => p.Index === argIndex);
            if (param) {
                if (param.Type) {
                    types = param.Type;
                    dependsOn = param.DependsOn;
                }
                paramName = param.Ref;
            }
        }

        // Fetch Command Data (Fallback)
        const cmd = data.commands.get(commandName);
        if (types.length === 0) {
            if (cmd && cmd.Args && cmd.Args.length > argIndex) {
                const argDef = cmd.Args[argIndex];
                const t = argDef.Type;
                types = Array.isArray(t) ? t : [t];
                if (!paramName) paramName = argDef.TentativeName;
            }
        }

        if (types.length === 0) return [];

        // --- Auto-formatting & Chain Completion Logic ---
        let maxArgs = -1;
        if (cmd && cmd.Args) maxArgs = Math.max(maxArgs, cmd.Args.length - 1);
        if (hint && hint.Params) {
             const maxHint = hint.Params.reduce((m, p) => Math.max(m, p.Index), -1);
             maxArgs = Math.max(maxArgs, maxHint);
        }

        const isLastArg = maxArgs === -1 || argIndex >= maxArgs;
        
        const remainingText = line.substring(position.character);
        const nextChar = remainingText.trim()[0];
        const hasComma = nextChar === ',';

        const needsPreSpace = linePrefix.trimEnd().endsWith(','); 
        const insertPrefix = needsPreSpace ? " " : "";

        const insertSuffix = (!isLastArg && !hasComma) ? ", " : "";
        
        const completionCommand = (!isLastArg) ? { command: 'relumistudio.triggerNextArg', title: 'Next Argument' } : undefined;

        const formatDetail = (baseDetail: string) => {
            return paramName ? `${paramName}: ${baseDetail}` : baseDetail;
        };

        const items: vscode.CompletionItem[] = [];

        // Helper to add items
        const addItems = (sourceMap: Map<any, string>, kind: vscode.CompletionItemKind, prefixLabel: string) => {
             for (const [id, name] of sourceMap) {
                const label = `${name} (${id})`;
                const item = new vscode.CompletionItem(label, kind);
                item.insertText = insertPrefix + id.toString() + insertSuffix;
                item.command = completionCommand;
                item.detail = formatDetail(`${prefixLabel} #${id}`);
                item.sortText = name;
                items.push(item);
            }
        };

        if (types.includes('Pokemon')) addItems(data.pokes, vscode.CompletionItemKind.Value, 'Pokemon');
        if (types.includes('Item')) addItems(data.items, vscode.CompletionItemKind.Value, 'Item');
        
        if (types.includes('Ball')) {
             for (const [ballId, itemId] of data.balls) {
                const name = data.items.get(itemId) || "Unknown Ball";
                const item = new vscode.CompletionItem(`${name} (${ballId})`, vscode.CompletionItemKind.Value);
                item.insertText = insertPrefix + ballId.toString() + insertSuffix;
                item.command = completionCommand;
                item.detail = formatDetail(`Ball #${ballId}`);
                item.sortText = name;
                items.push(item);
            }
        }

        if (types.includes('Form') && dependsOn !== undefined) {
             // Use the robust parsedArgs from context
             if (parsedArgs[dependsOn]) {
                 const pokeId = parseInt(parsedArgs[dependsOn]);
                 if (!isNaN(pokeId)) {
                     const prefix = `${pokeId}_`;
                     let formFound = false;
                     for (const [key, name] of data.forms) {
                         if (key.startsWith(prefix)) {
                             const formId = key.split('_')[1];
                             const item = new vscode.CompletionItem(`${name} (${formId})`, vscode.CompletionItemKind.EnumMember);
                             item.insertText = insertPrefix + formId + insertSuffix;
                             item.command = completionCommand;
                             item.detail = formatDetail(`Form #${formId}`);
                             items.push(item);
                             formFound = true;
                         }
                     }
                     // FALLBACK: If the Pokemon has no forms, suggest "0" (Default)
                     // This prevents the user from having no suggestions and ensures the chain continues.
                     if (!formFound) {
                         const item = new vscode.CompletionItem("Default Form (0)", vscode.CompletionItemKind.Value);
                         item.insertText = insertPrefix + "0" + insertSuffix;
                         item.command = completionCommand;
                         item.detail = formatDetail("Form #0");
                         item.sortText = "0000"; 
                         items.push(item);
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

    // --- Multi-line Robust Context Parsing ---
    private getCommandContext(document: vscode.TextDocument, position: vscode.Position): CommandContext | null {
        // Search backwards up to 10 lines to find the start of a command
        let startLine = position.line;
        let foundCmdMatch: RegExpExecArray | null = null;
        let foundLineIndex = -1;

        const cmdRegex = /([A-Z_][A-Z0-9_]*)\s*\(/g;
        
        for (let i = startLine; i >= Math.max(0, startLine - 10); i--) {
            const lineText = document.lineAt(i).text;
            cmdRegex.lastIndex = 0;
            let match;
            while ((match = cmdRegex.exec(lineText)) !== null) {
                // If on current line, match must be before cursor
                if (i === startLine && match.index + match[0].length > position.character) continue;
                foundCmdMatch = match;
                foundLineIndex = i;
            }
            if (foundCmdMatch) break;
        }

        if (!foundCmdMatch || foundLineIndex === -1) return null;

        const commandName = foundCmdMatch[1];
        const cmdStartIndex = foundCmdMatch.index + foundCmdMatch[0].length; // Position after '('

        // Reconstruct text from Command Start to Cursor
        let fullText = "";
        
        for (let i = foundLineIndex; i <= startLine; i++) {
            let lineStr = document.lineAt(i).text;
            
            // Handle comments
            const commentIdx = lineStr.indexOf('//');
            if (commentIdx !== -1) lineStr = lineStr.substring(0, commentIdx);

            if (i === foundLineIndex) {
                if (i === startLine) fullText += lineStr.substring(cmdStartIndex, position.character);
                else fullText += lineStr.substring(cmdStartIndex);
            } else if (i === startLine) {
                fullText += lineStr.substring(0, position.character);
            } else {
                fullText += lineStr;
            }
        }

        // Count commas & Collect Args
        const args: string[] = [];
        let currentBuffer = "";
        let inString = false;
        
        for (let j = 0; j < fullText.length; j++) {
            const char = fullText[j];
            if (char === "'") {
                inString = !inString;
                currentBuffer += char;
            } else if (char === ',' && !inString) {
                args.push(currentBuffer.trim());
                currentBuffer = "";
            } else {
                currentBuffer += char;
            }
        }
        args.push(currentBuffer.trim());

        const argIndex = args.length - 1;
        const currentArgPrefix = currentBuffer.trim();

        return { 
            name: commandName, 
            argIndex: argIndex,
            currentArgPrefix: currentArgPrefix,
            args: args
        };
    }
}