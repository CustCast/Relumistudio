import * as vscode from 'vscode';
import { DataManager, HintParam } from './dataManager';

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
                        const valStr = args[paramDef.Index];
                        const resolved = this.resolveParamFragment(valStr, paramDef, args);
                        
                        // Only add if it didn't return null (handled by Hide if 0)
                        if (resolved !== null) {
                            sentenceParts.push(resolved);
                        }
                    } else {
                        // Argument missing in code
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

    private resolveParamFragment(valStr: string, param: HintParam, allArgs: string[]): string | null {
        const data = DataManager.getInstance();
        const val = parseInt(valStr);
        const isNum = !isNaN(val);
        const isZero = isNum && val === 0;

        let detectedType = "Value";
        let displayValue = valStr;

        // 1. Detect Type & Resolve Value
        if (param.Type) {
            for (const t of param.Type) {
                if (t === "Value") continue; // Lowest priority, handled by default
                
                // --- Special Data Lookups ---
                if (t === "Pokemon" && isNum && data.pokes.has(val)) {
                    detectedType = t;
                    displayValue = data.pokes.get(val)!;
                    break;
                }
                if (t === "Item" && isNum && data.items.has(val)) {
                    detectedType = t;
                    displayValue = data.items.get(val)!;
                    break;
                }
                if (t === "Ball" && isNum && data.balls.has(val)) {
                    detectedType = t;
                    const itemId = data.balls.get(val)!;
                    displayValue = data.items.get(itemId) || "Unknown Ball";
                    break;
                }
                if (t === "Form" && param.DependsOn !== undefined && isNum) {
                    const depStr = allArgs[param.DependsOn];
                    const depVal = parseInt(depStr);
                    if (!isNaN(depVal)) {
                        const formKey = `${depVal}_${val}`;
                        if (data.forms.has(formKey)) {
                            detectedType = t;
                            displayValue = data.forms.get(formKey)!;
                            break;
                        }
                    }
                }
                if (t === "Flag" && valStr.startsWith("#")) {
                    detectedType = t;
                    break;
                }
                if (t === "Work" && valStr.startsWith("@")) {
                    detectedType = t;
                    break;
                }

                // --- Generic Type Support (Fix for Custom Types) ---
                // If it's not a special type, but the input is a number, we accept it as the detected type.
                // This allows types like "Number", "Index", "TalkIndex" to be detected so their fragments are used.
                if (isNum && t !== "String") {
                    detectedType = t;
                    break;
                }
            }
        }

        // 2. Handle "Hide if 0"
        if (isZero && param.ShowZero && param.ShowZero.includes(detectedType)) {
            return null;
        }

        // 3. Get Fragment (With Fallback)
        let fragment = "{Value}";
        
        if (param.Fragments) {
            // Priority 1: Specific detected type (e.g., "TalkIndex")
            if (param.Fragments[detectedType]) {
                fragment = param.Fragments[detectedType];
            } 
            // Priority 2: Fallback to "Value" if specific type missing
            else if (param.Fragments["Value"]) {
                fragment = param.Fragments["Value"];
            }
            // Priority 3: Fallback to first available key (if both missing)
            else {
                const keys = Object.keys(param.Fragments);
                if (keys.length > 0) fragment = param.Fragments[keys[0]];
            }
        }

        // 4. Replace Placeholders
        // Supports standard "{Value}" and user-friendly "{RefName}" (e.g. "{talkIndex}")
        const refPlaceholder = `{${param.Ref}}`;
        return fragment.split('{Value}').join(displayValue).split(refPlaceholder).join(displayValue);
    }

    private parseArgs(argsStr: string): string[] {
        if (!argsStr.trim()) return [];
        return argsStr.split(',').map(s => s.trim());
    }
}