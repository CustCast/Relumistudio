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
            
            const cmdContext = this.getCommandContext(document, position);
            
            if (!cmdContext) return null;

            const { commandName, argIndex } = cmdContext;
            const activeDef = data?.hints?.get(commandName);

            // If we found a command but no definition, we can't help.
            if (!activeDef) return null;

            const help = new vscode.SignatureHelp();
            help.activeParameter = argIndex;
            help.activeSignature = 0;

            const paramInfos: vscode.ParameterInformation[] = [];
            let label = `${commandName}(`;

            let maxArgs = 0;
            if (activeDef.Params && Array.isArray(activeDef.Params)) {
                 maxArgs = activeDef.Params.reduce((m, p) => Math.max(m, p.Index + 1), 0);
            }

            // Always show at least enough args to cover the user's cursor
            const showCount = Math.max(maxArgs, argIndex + 1);

            for (let i = 0; i < showCount; i++) {
                let paramLabel = `Arg${i}`;
                let paramDoc = "";

                if (activeDef.Params) {
                    const hintParam = activeDef.Params.find(p => p.Index === i);
                    if (hintParam) {
                        paramLabel = hintParam.Ref || `Arg${i}`;
                        if (hintParam.Description) paramDoc = hintParam.Description;
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
            if (activeDef.Description) {
                sigInfo.documentation = new vscode.MarkdownString(activeDef.Description);
            }
            sigInfo.parameters = paramInfos;
            help.signatures = [sigInfo];

            return help;

        } catch (error) {
            DataManager.log(`[SigError] ${error}`);
            return null;
        }
    }

    private getCommandContext(document: vscode.TextDocument, position: vscode.Position) {
        const lineText = document.lineAt(position.line).text;
        
        // Sanity Check: Is this a comment?
        const commentIdx = lineText.indexOf('//');
        if (commentIdx !== -1 && position.character > commentIdx) return null;

        // Scan LEFT from cursor to find the closest open parenthesis
        let depth = 0;
        let argIndex = 0;
        let openParenIndex = -1;

        for (let i = position.character - 1; i >= 0; i--) {
            const char = lineText[i];

            if (char === ')') {
                depth++;
            } else if (char === '(') {
                if (depth > 0) {
                    depth--;
                } else {
                    // Found the opening '(' for our command
                    openParenIndex = i;
                    break;
                }
            } else if (char === ',' && depth === 0) {
                argIndex++;
            }
        }

        if (openParenIndex === -1) return null; 

        // Extract the Word immediately before the '('
        const textBefore = lineText.substring(0, openParenIndex);
        const match = textBefore.match(/([A-Z0-9_]+)\s*$/);

        if (match) {
            return { commandName: match[1], argIndex };
        }

        return null;
    }
}