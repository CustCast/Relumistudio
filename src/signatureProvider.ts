import * as vscode from 'vscode';
import { DataManager } from './dataManager';

export class BDSPSignatureHelpProvider implements vscode.SignatureHelpProvider {

    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): vscode.ProviderResult<vscode.SignatureHelp> {

        try {
            const data = DataManager.getInstance();
            
            // 1. Find Context
            const cmdContext = this.getCommandContext(document, position);
            if (!cmdContext) return null;

            const { commandName, argIndex } = cmdContext;

            // 2. Lookup Definitions (Strict Priority)
            const hintDef = data?.hints?.get(commandName);
            const cmdDef = data?.commands?.get(commandName);

            // If hints exist, we use ONLY hints. Otherwise, we use commands.
            const activeDef = hintDef || cmdDef;
            const isHint = !!hintDef;

            // If neither exists, we return generic help so the box doesn't disappear
            // (failsafe for user typing undefined commands)
            
            const help = new vscode.SignatureHelp();
            help.activeParameter = argIndex;
            help.activeSignature = 0;

            const paramInfos: vscode.ParameterInformation[] = [];
            let label = `${commandName}(`;

            // 3. Calculate Params
            let maxArgs = 0;

            if (isHint && hintDef && hintDef.Params) {
                 const maxHint = hintDef.Params.reduce((m, p) => Math.max(m, p.Index + 1), 0);
                 maxArgs = maxHint;
            } else if (!isHint && cmdDef && cmdDef.Args) {
                 maxArgs = cmdDef.Args.length;
            }

            // Ensure we show at least enough args to cover the user's current cursor
            const showCount = Math.max(maxArgs, argIndex + 1);

            for (let i = 0; i < showCount; i++) {
                let paramLabel = `Arg${i}`;
                let paramDoc: string | vscode.MarkdownString | undefined = undefined;

                if (isHint && hintDef && hintDef.Params) {
                    const hintParam = hintDef.Params.find(p => p.Index === i);
                    if (hintParam) {
                        paramLabel = hintParam.Ref || `Arg${i}`;
                        if (hintParam.Description) paramDoc = hintParam.Description;
                    }
                } 
                else if (!isHint && cmdDef && cmdDef.Args && cmdDef.Args[i]) {
                    paramLabel = cmdDef.Args[i].TentativeName || `Arg${i}`;
                    const type = cmdDef.Args[i].Type;
                    if (type) {
                        const typeStr = Array.isArray(type) ? type.join(' | ') : type;
                        paramDoc = `Type: ${typeStr}`;
                    }
                }

                if (i > 0) label += ", ";
                
                const start = label.length;
                label += paramLabel;
                const end = label.length;

                paramInfos.push(new vscode.ParameterInformation([start, end], paramDoc));
            }

            label += ")";

            const sigInfo = new vscode.SignatureInformation(label);
            
            if (activeDef && activeDef.Description) {
                sigInfo.documentation = new vscode.MarkdownString(activeDef.Description);
            }

            sigInfo.parameters = paramInfos;
            help.signatures = [sigInfo];

            return help;

        } catch (error) {
            console.error("[BDSP-Sig] Error:", error);
            return null;
        }
    }

    private getCommandContext(document: vscode.TextDocument, position: vscode.Position) {
        const lineText = document.lineAt(position.line).text;
        
        const commentIdx = lineText.indexOf('//');
        if (commentIdx !== -1 && position.character > commentIdx) return null;

        const cmdRegex = /([A-Z_][A-Z0-9_]*)\s*\(/g;
        let match;
        let validMatch: { commandName: string; argIndex: number } | null = null;
        let safetyCounter = 0;

        while ((match = cmdRegex.exec(lineText)) !== null && safetyCounter++ < 100) {
            const name = match[1];
            const start = match.index + match[0].length;
            
            if (start > position.character) break;

            let inString = false;
            let depth = 0;
            let closed = false;
            let argIndex = 0;

            for (let i = start; i < position.character; i++) {
                if (i >= lineText.length) break;

                const char = lineText[i];
                if (char === "'") {
                    inString = !inString;
                } else if (!inString) {
                    if (char === '(') {
                        depth++;
                    } else if (char === ')') {
                        if (depth > 0) {
                            depth--;
                        } else {
                            closed = true;
                            break;
                        }
                    } else if (char === ',' && depth === 0) {
                        argIndex++;
                    }
                }
            }

            if (!closed) {
                validMatch = { commandName: name, argIndex };
            }
        }
        
        return validMatch;
    }
}