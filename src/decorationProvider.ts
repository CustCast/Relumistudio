import * as vscode from 'vscode';
import { DataManager } from './dataManager';

export class BDSPDecorationProvider {
    private decorationType: vscode.TextEditorDecorationType;
    private timeout: NodeJS.Timeout | undefined = undefined;

    constructor() {
        // Create the styling for the "Ghost Text"
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                color: new vscode.ThemeColor('editorCodeLens.foreground'), // Subtle grey
                fontStyle: 'italic',
                margin: '0 0 0 1em' // Space between code and hint
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
    }

    public triggerUpdate(editor?: vscode.TextEditor) {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
        this.timeout = setTimeout(() => this.updateDecorations(editor), 100);
    }

    private updateDecorations(editor?: vscode.TextEditor) {
        if (!editor || editor.document.languageId !== 'bdsp') return;

        const data = DataManager.getInstance();
        const text = editor.document.getText();
        const decorations: vscode.DecorationOptions[] = [];

        // Regex: COMMAND(arg1, arg2)
        const regex = /([A-Z_][A-Z0-9_]*)\s*\(([^)]*)\)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const cmdName = match[1];
            const argsStr = match[2];
            
            const hintConfig = data.hints.get(cmdName);
            if (!hintConfig || !hintConfig.Sentence || hintConfig.Sentence.length === 0 || hintConfig.IsEnabled === false) {
                continue;
            }

            const args = this.parseArgs(argsStr);
            let sentenceParts: string[] = [];
            
            for (const part of hintConfig.Sentence) {
                if (!part.IsRef) {
                    sentenceParts.push(part.Text);
                } else {
                    const refName = part.Text.replace(/[{}]/g, '');
                    const paramDef = hintConfig.Params?.find(p => p.Ref === refName);
                    
                    if (paramDef && args.length > paramDef.Index) {
                        const rawValStr = args[paramDef.Index];
                        const rawVal = parseInt(rawValStr);
                        let resolvedText = rawValStr;
                        
                        if (!isNaN(rawVal)) {
                            const type = (paramDef.Type && paramDef.Type.length > 0) ? paramDef.Type[0] : 'Value';
                            
                            let lookupName = rawValStr;
                            
                            if (type === 'Pokemon') lookupName = data.pokes.get(rawVal) || lookupName;
                            else if (type === 'Item') lookupName = data.items.get(rawVal) || lookupName;
                            else if (type === 'Ball') {
                                const itemId = data.balls.get(rawVal);
                                if (itemId) lookupName = data.items.get(itemId) || lookupName;
                            }
                            // Form Logic
                            else if (type === 'Form' && paramDef.DependsOn !== undefined) {
                                const depIdx = paramDef.DependsOn;
                                if (args.length > depIdx) {
                                    const pokeId = parseInt(args[depIdx]);
                                    if (!isNaN(pokeId)) {
                                        const formKey = `${pokeId}_${rawVal}`;
                                        if (data.forms.has(formKey)) {
                                            lookupName = data.forms.get(formKey)!;
                                        }
                                    }
                                }
                            }
                            
                            if (paramDef.Fragments && paramDef.Fragments[type]) {
                                resolvedText = paramDef.Fragments[type].replace('{Value}', lookupName);
                            } else {
                                resolvedText = lookupName;
                            }
                        }
                        sentenceParts.push(resolvedText);
                    } else {
                        sentenceParts.push("?");
                    }
                }
            }

            // Create Decoration
            const finalText = "; " + sentenceParts.join('');
            
            // Calculate Range (end of the command)
            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            decorations.push({
                range: range,
                renderOptions: {
                    after: {
                        contentText: finalText
                    }
                }
            });
        }

        editor.setDecorations(this.decorationType, decorations);
    }

    private parseArgs(argsStr: string): string[] {
        if (!argsStr.trim()) return [];
        return argsStr.split(',').map(s => s.trim());
    }
}