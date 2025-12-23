import * as vscode from 'vscode';
import { DataManager } from './dataManager';

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

        // --- 1. Prefix Completion (#, $, @) ---
        
        if (linePrefix.endsWith('#')) {
            return this.getMapCompletions(data.flags, vscode.CompletionItemKind.Constant);
        }
        if (linePrefix.endsWith('$')) {
            return this.getMapCompletions(data.sysFlags, vscode.CompletionItemKind.Variable);
        }
        if (linePrefix.endsWith('@')) {
            return this.getMapCompletions(data.works, vscode.CompletionItemKind.Variable);
        }

        // --- 2. Argument Completion (Pokemon, Items, etc.) ---

        const cmdContext = this.getCommandContext(document, position);
        if (!cmdContext) return [];

        const { commandName, argIndex, lineText, argStart } = cmdContext;
        
        // Determine expected type(s)
        let types: string[] = [];
        let dependsOn: number | undefined;

        // Check Hints (User Config)
        const hint = data.hints.get(commandName);
        if (hint && hint.Params) {
            const param = hint.Params.find(p => p.Index === argIndex);
            if (param && param.Type) {
                types = param.Type;
                dependsOn = param.DependsOn;
            }
        }

        // Fallback to Commands (System Config)
        if (types.length === 0) {
            const cmd = data.commands.get(commandName);
            if (cmd && cmd.Args && cmd.Args.length > argIndex) {
                const t = cmd.Args[argIndex].Type;
                types = Array.isArray(t) ? t : [t];
            }
        }

        if (types.length === 0) return [];

        const items: vscode.CompletionItem[] = [];

        // --- Generators ---

        if (types.includes('Pokemon')) {
            for (const [id, name] of data.pokes) {
                const item = new vscode.CompletionItem(`${name} (${id})`, vscode.CompletionItemKind.Value);
                item.insertText = id.toString();
                item.detail = `Pokemon #${id}`;
                item.sortText = name; // Sort alphabetically
                items.push(item);
            }
        }

        if (types.includes('Item')) {
            for (const [id, name] of data.items) {
                const item = new vscode.CompletionItem(`${name} (${id})`, vscode.CompletionItemKind.Value);
                item.insertText = id.toString();
                item.detail = `Item #${id}`;
                item.sortText = name;
                items.push(item);
            }
        }

        if (types.includes('Ball')) {
             for (const [ballId, itemId] of data.balls) {
                const name = data.items.get(itemId) || "Unknown Ball";
                const item = new vscode.CompletionItem(`${name} (${ballId})`, vscode.CompletionItemKind.Value);
                item.insertText = ballId.toString();
                item.detail = `Ball #${ballId}`;
                item.sortText = name;
                items.push(item);
            }
        }

        // Smart Form Logic (Dependency Check)
        if (types.includes('Form') && dependsOn !== undefined) {
             const args = this.parseArgs(lineText, argStart);
             
             // Check if we have a value for the dependency argument
             if (args[dependsOn]) {
                 const pokeId = parseInt(args[dependsOn]);
                 
                 if (!isNaN(pokeId)) {
                     // Filter forms that match "PokeID_"
                     const prefix = `${pokeId}_`;
                     
                     for (const [key, name] of data.forms) {
                         if (key.startsWith(prefix)) {
                             const formId = key.split('_')[1];
                             const item = new vscode.CompletionItem(`${name} (${formId})`, vscode.CompletionItemKind.EnumMember);
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
            // Remove the prefix from the insert text so we don't get "##FLAG"
            const cleanLabel = key.replace(/^[#$@]/, ''); 
            const item = new vscode.CompletionItem(cleanLabel, kind);
            item.detail = def.Description || key;
            item.insertText = cleanLabel; 
            items.push(item);
        }
        return items;
    }

    // Reuse context helper
    private getCommandContext(document: vscode.TextDocument, position: vscode.Position) {
        const line = document.lineAt(position.line).text;
        const cmdRegex = /([A-Z_][A-Z0-9_]*)\s*\(/g;
        let match;
        let bestMatch = null;

        while ((match = cmdRegex.exec(line)) !== null) {
            const start = match.index + match[0].length; 
            if (start <= position.character) {
                bestMatch = { name: match[1], argStart: start, lineText: line };
            }
        }

        if (!bestMatch) return null;

        const textSegment = line.substring(bestMatch.argStart, position.character);
        const argIndex = (textSegment.match(/,/g) || []).length;

        return { 
            commandName: bestMatch.name, 
            argIndex: argIndex, 
            lineText: bestMatch.lineText,
            argStart: bestMatch.argStart
        };
    }

    private parseArgs(lineText: string, argStart: number): string[] {
        // Attempt to find closing paren, otherwise take rest of line
        const closingParen = lineText.indexOf(')', argStart);
        const limit = closingParen === -1 ? lineText.length : closingParen;
        const argsStr = lineText.substring(argStart, limit);
        return argsStr.split(',').map(s => s.trim());
    }
}