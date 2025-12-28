import * as vscode from 'vscode';
import { DataManager, HintConfig } from './dataManager';

interface CommandContext {
    name: string;
    argStart: number;
    lineText: string;
    argIndex: number;
}

export class BDSPHoverProvider implements vscode.HoverProvider {

    // Logic to map specific types to the 5 Parent categories
    private getParentType(rawType: string): string {
        const type = rawType.trim();
        const map: { [key: string]: string[] } = {
            "Value": ["Value", "Number", "Pokemon", "Ball", "Form", "Item", "TagIndex", "NumberIndex"],
            "Work": ["Work"],
            "Flag": ["Flag"],
            "SysFlag": ["SysFlag", "SystemFlag"],
            "String": ["String", "Event", "Message", "Label"]
        };

        for (const [parent, children] of Object.entries(map)) {
            if (children.includes(type)) return parent;
        }
        return "Value"; // Fallback
    }
    
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;

        const word = document.getText(range);
        const data = DataManager.getInstance();

        // 1. Prefixes
        if (word.startsWith('#') && data.flags.has(word)) return this.simpleHover(data.flags.get(word)!, 'Flag');
        if (word.startsWith('$') && data.sysFlags.has(word)) return this.simpleHover(data.sysFlags.get(word)!, 'System Flag');
        if (word.startsWith('@') && data.works.has(word)) return this.simpleHover(data.works.get(word)!, 'Work Variable');

        // 2. Commands (Hints Only)
        if (data.hints.has(word)) {
            const hint = data.hints.get(word)!;
            return this.commandHover(hint);
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

    private commandHover(hint: HintConfig) {
        const md = new vscode.MarkdownString();
        // Construct signature from Params
        const paramStr = hint.Params ? hint.Params.map(p => p.Ref).join(', ') : '';
        md.appendCodeblock(`${hint.Cmd}(${paramStr})`, 'bdsp');
        
        if (hint.Id !== undefined) {
            md.appendMarkdown(`\n**ID:** ${hint.Id}`);
        }
        if (hint.Description) {
            md.appendMarkdown(`\n\n${hint.Description}`);
        }

        // --- Parameter List Section ---
        if (hint.Params && hint.Params.length > 0) {
            md.appendMarkdown('\n\n---');
            md.appendMarkdown('\n**Parameters:**');
            
            // Sort by index
            const sortedParams = [...hint.Params].sort((a, b) => a.Index - b.Index);
            
            for (const p of sortedParams) {
                const name = p.Ref || `Arg${p.Index}`;
                
                // Map and Deduplicate Types
                const rawTypes = p.Type || ['Value'];
                const parentTypes = Array.from(new Set(rawTypes.map(t => this.getParentType(t))));
                
                // Format: ('Value' | 'Work')
                const typeStr = parentTypes.length > 0 ? `(\`${parentTypes.join('` | `')}\`)` : '';
                
                const descStr = p.Description ? `: _${p.Description}_` : '';
                
                // * **Name** ('Type' | 'Type'): _Description_
                md.appendMarkdown(`\n* **${name}** ${typeStr}${descStr}`);
            }
        }

        return new vscode.Hover(md);
    }

    private getCommandContext(document: vscode.TextDocument, position: vscode.Position): CommandContext | null {
        const line = document.lineAt(position.line).text;
        const cmdRegex = /([A-Z0-9_]+)\s*\(/g;
        let match;
        
        while ((match = cmdRegex.exec(line)) !== null) {
            const start = match.index + match[0].length; 
            if (match.index > position.character) break;

            let inString = false;
            let depth = 1;
            let argIndex = 0;
            let inside = true;

            for (let i = start; i < line.length; i++) {
                if (i === position.character) {
                    if (inside) {
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
                        depth--;
                        if (depth === 0) { inside = false; break; }
                    }
                    else if (char === ',' && depth === 1) {
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