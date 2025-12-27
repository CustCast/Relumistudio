import * as vscode from 'vscode';
import { DataManager } from './dataManager';

// Define the interface for the command context
interface CommandContext {
    name: string;
    argStart: number;
    lineText: string;
    argIndex: number;
}

export class BDSPHoverProvider implements vscode.HoverProvider {
    
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;

        const word = document.getText(range);
        const data = DataManager.getInstance();

        // 1. Prefixes (#FLAG, $SYS, @WORK)
        if (word.startsWith('#') && data.flags.has(word)) return this.simpleHover(data.flags.get(word)!, 'Flag');
        if (word.startsWith('$') && data.sysFlags.has(word)) return this.simpleHover(data.sysFlags.get(word)!, 'System Flag');
        if (word.startsWith('@') && data.works.has(word)) return this.simpleHover(data.works.get(word)!, 'Work Variable');

        // 2. Commands
        if (data.commands.has(word)) {
            const cmd = data.commands.get(word)!;
            const hint = data.hints.get(word);
            return this.commandHover(cmd, hint);
        }

        // 3. Arguments (Numbers)
        if (/^\d+$/.test(word)) {
            const context = this.getCommandContext(document, position);
            
            if (context) {
                const val = parseInt(word);
                let types: string[] = [];
                let dependsOn: number | undefined;

                const hint = data.hints.get(context.name);
                if (hint && hint.Params) {
                    const param = hint.Params.find(p => p.Index === context.argIndex);
                    if (param && param.Type) {
                        types = param.Type;
                        dependsOn = param.DependsOn;
                    }
                }

                if (types.length === 0) {
                    const cmd = data.commands.get(context.name);
                    if (cmd && cmd.Args && cmd.Args.length > context.argIndex) {
                        const t = cmd.Args[context.argIndex].Type;
                        types = Array.isArray(t) ? t : [t];
                    }
                }

                if (types.includes('Pokemon') && data.pokes.has(val)) return new vscode.Hover(`**Pokemon:** ${data.pokes.get(val)}`);
                if (types.includes('Item') && data.items.has(val)) return new vscode.Hover(`**Item:** ${data.items.get(val)}`);
                if (types.includes('Ball') && data.balls.has(val)) {
                    const itemId = data.balls.get(val)!;
                    const itemName = data.items.get(itemId) || "Unknown";
                    return new vscode.Hover(`**Ball:** ${itemName}`);
                }
                
                if (types.includes('Form') && dependsOn !== undefined) {
                    const args = this.parseArgs(context.lineText, context.argStart);
                    if (args[dependsOn]) {
                        const pokeId = parseInt(args[dependsOn]);
                        if (!isNaN(pokeId)) {
                            const formKey = `${pokeId}_${val}`;
                            if (data.forms.has(formKey)) return new vscode.Hover(`**Form:** ${data.forms.get(formKey)}`);
                        }
                    }
                }
            }
        }

        return null;
    }

    private simpleHover(def: { Name: string, Description?: string }, label: string) {
        const md = new vscode.MarkdownString();
        md.appendCodeblock(def.Name, 'bdsp');
        md.appendMarkdown(`\n**${label}**`);
        if (def.Description) md.appendMarkdown(`\n\n${def.Description}`);
        return new vscode.Hover(md);
    }

    private commandHover(cmd: any, hint: any) {
        const md = new vscode.MarkdownString();
        const args = cmd.Args.map((a: any) => a.TentativeName).join(', ');
        md.appendCodeblock(`${cmd.Name}(${args})`, 'bdsp');
        const desc = hint?.Description || cmd.Description;
        if (desc) md.appendMarkdown(`\n\n${desc}`);
        return new vscode.Hover(md);
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