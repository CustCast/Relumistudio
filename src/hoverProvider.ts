import * as vscode from 'vscode';
import { DataManager } from './dataManager';

export class BDSPHoverProvider implements vscode.HoverProvider {
    
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;

        const word = document.getText(range);
        const data = DataManager.getInstance();

        // --- 1. Check for Prefixed Variables (#, $, @) ---
        if (word.startsWith('#') && data.flags.has(word)) {
            return this.simpleHover(data.flags.get(word)!, 'Flag');
        }

        if (word.startsWith('$') && data.sysFlags.has(word)) {
            return this.simpleHover(data.sysFlags.get(word)!, 'System Flag');
        }

        if (word.startsWith('@') && data.works.has(word)) {
            return this.simpleHover(data.works.get(word)!, 'Work Variable');
        }

        // --- 2. Check for Command Definitions ---
        // (When hovering over the command name itself, e.g. "_ADD_ITEM")
        if (data.commands.has(word)) {
            const cmd = data.commands.get(word)!;
            const hint = data.hints.get(word);
            return this.commandHover(cmd, hint);
        }

        // --- 3. Context Aware Values (Numbers) ---
        // If the word is a number (e.g. "493"), check if it's a Pokemon ID, Item ID, etc.
        if (/^\d+$/.test(word)) {
            const context = this.getCommandContext(document, position);
            
            if (context) {
                const val = parseInt(word);
                let types: string[] = [];
                let dependsOn: number | undefined;

                // Priority: Look at hints.json FIRST (User overrides)
                const hint = data.hints.get(context.commandName);
                if (hint && hint.Params) {
                    const param = hint.Params.find(p => p.Index === context.argIndex);
                    if (param && param.Type) {
                        types = param.Type;
                        dependsOn = param.DependsOn;
                    }
                }

                // Fallback: Look at commands.json (System defaults)
                if (types.length === 0) {
                    const cmd = data.commands.get(context.commandName);
                    if (cmd && cmd.Args && cmd.Args.length > context.argIndex) {
                        const t = cmd.Args[context.argIndex].Type;
                        types = Array.isArray(t) ? t : [t];
                    }
                }

                // --- Lookup Logic based on Type ---

                // Pokemon
                if (types.includes('Pokemon') && data.pokes.has(val)) {
                    return new vscode.Hover(`**Pokemon:** ${data.pokes.get(val)}`);
                }
                
                // Items
                if (types.includes('Item') && data.items.has(val)) {
                    return new vscode.Hover(`**Item:** ${data.items.get(val)}`);
                }

                // Balls (Look up BallID -> ItemID -> Item Name)
                if (types.includes('Ball') && data.balls.has(val)) {
                    const itemId = data.balls.get(val)!;
                    const itemName = data.items.get(itemId) || "Unknown Ball";
                    return new vscode.Hover(`**Ball:** ${itemName}`);
                }
                
                // Forms (Requires parsing the Dependent Argument, usually the Pokemon ID)
                if (types.includes('Form') && dependsOn !== undefined) {
                    const args = this.parseArgs(context.lineText, context.argStart);
                    
                    // Ensure the dependent argument exists
                    if (args[dependsOn]) {
                        const pokeId = parseInt(args[dependsOn]);
                        if (!isNaN(pokeId)) {
                            const formKey = `${pokeId}_${val}`; // Format: "493_1"
                            if (data.forms.has(formKey)) {
                                return new vscode.Hover(`**Form:** ${data.forms.get(formKey)}`);
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    private simpleHover(def: { Name: string, Description?: string }, label: string): vscode.Hover {
        const md = new vscode.MarkdownString();
        md.appendCodeblock(def.Name, 'bdsp');
        md.appendMarkdown(`\n**${label}**`);
        if (def.Description) {
            md.appendMarkdown(`\n\n${def.Description}`);
        }
        return new vscode.Hover(md);
    }

    private commandHover(cmd: any, hint: any): vscode.Hover {
        const md = new vscode.MarkdownString();
        const args = cmd.Args.map((a: any) => a.TentativeName).join(', ');
        md.appendCodeblock(`${cmd.Name}(${args})`, 'bdsp');

        const desc = hint?.Description || cmd.Description;
        if (desc) {
            md.appendMarkdown(`\n\n${desc}`);
        }

        if (hint && hint.Params) {
             md.appendMarkdown('\n\n**Arguments (Hinted):**');
             hint.Params.forEach((p: any) => {
                 md.appendMarkdown(`\n* \`${p.Index}\`: **${p.Ref}**`);
             });
        }

        return new vscode.Hover(md);
    }

    // --- Context Parsing Helpers ---

    // Figures out "I am inside Command X at Argument Index Y"
    private getCommandContext(document: vscode.TextDocument, position: vscode.Position) {
        const line = document.lineAt(position.line).text;
        
        // Regex to find "COMMAND(" pattern
        const cmdRegex = /([A-Z_][A-Z0-9_]*)\s*\(/g;
        
        let match;
        let bestMatch = null;

        // Find the LAST command that starts before our cursor position
        while ((match = cmdRegex.exec(line)) !== null) {
            const openParenIndex = match.index + match[0].length; 
            
            // If this command starts before our cursor
            if (openParenIndex <= position.character) {
                bestMatch = { 
                    name: match[1], 
                    argStart: openParenIndex, // Start of arguments (after the open paren)
                    lineText: line 
                };
            }
        }

        if (!bestMatch) return null;

        // Now count the commas between the command start and our cursor
        const textSegment = line.substring(bestMatch.argStart, position.character);
        
        const argIndex = (textSegment.match(/,/g) || []).length;

        return { 
            commandName: bestMatch.name, 
            argIndex: argIndex, 
            lineText: bestMatch.lineText,
            argStart: bestMatch.argStart
        };
    }

    // Parses the arguments of the command into an array of strings
    private parseArgs(lineText: string, argStart: number): string[] {
        // Find closing parenthesis
        const closingParen = lineText.indexOf(')', argStart);
        if (closingParen === -1) return [];

        const argsStr = lineText.substring(argStart, closingParen);
        
        // Split by comma and trim whitespace
        return argsStr.split(',').map(s => s.trim());
    }
}