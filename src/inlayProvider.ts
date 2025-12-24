import * as vscode from 'vscode';
import { DataManager } from './dataManager';

export class BDSPInlayHintsProvider implements vscode.InlayHintsProvider {

    public readonly onDidChangeInlayHintsEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeInlayHints = this.onDidChangeInlayHintsEmitter.event;

    provideInlayHints(document: vscode.TextDocument, range: vscode.Range, token: vscode.CancellationToken): vscode.InlayHint[] {
        const hints: vscode.InlayHint[] = [];
        const data = DataManager.getInstance();
        const text = document.getText(range);

        // Regex to find commands: COMMAND(arg1, arg2)
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
            let labelParts: vscode.InlayHintLabelPart[] = [];
            
            for (const part of hintConfig.Sentence) {
                if (!part.IsRef) {
                    labelParts.push(new vscode.InlayHintLabelPart(part.Text));
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
                                const template = paramDef.Fragments[type];
                                resolvedText = template.replace('{Value}', lookupName);
                            } else {
                                resolvedText = lookupName;
                            }
                        }

                        labelParts.push(new vscode.InlayHintLabelPart(resolvedText));
                    } else {
                        labelParts.push(new vscode.InlayHintLabelPart("?"));
                    }
                }
            }

            const matchOffset = document.offsetAt(range.start) + match.index + match[0].length;
            const pos = document.positionAt(matchOffset);

            // FIX: Removed InlayHintKind.Parameter to prevent visual truncation (chip style).
            // It will now render as plain text, similar to a comment.
            const hint = new vscode.InlayHint(pos, labelParts); 
            hint.paddingLeft = true;
            hint.paddingRight = true; // Ensure space after as well
            hints.push(hint);
        }

        return hints;
    }

    private parseArgs(argsStr: string): string[] {
        if (!argsStr.trim()) return [];
        return argsStr.split(',').map(s => s.trim());
    }
}