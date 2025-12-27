import * as vscode from 'vscode';
import { DataManager } from './dataManager';

export class BDSPSignatureHelpProvider implements vscode.SignatureHelpProvider {

    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): vscode.ProviderResult<vscode.SignatureHelp> {

        const data = DataManager.getInstance();
        
        // Reuse the robust context logic
        const cmdContext = this.getCommandContext(document, position);
        if (!cmdContext) return null;

        const { commandName, argIndex } = cmdContext;

        const cmdDef = data.commands.get(commandName);
        const hintDef = data.hints.get(commandName);

        if (!cmdDef && !hintDef) return null;

        const help = new vscode.SignatureHelp();
        help.activeParameter = argIndex;
        help.activeSignature = 0;

        const paramInfos: vscode.ParameterInformation[] = [];
        let label = `${commandName}(`;

        // Determine max args
        let maxArgs = 0;
        if (cmdDef && cmdDef.Args) maxArgs = cmdDef.Args.length;
        if (hintDef && hintDef.Params) {
             const maxHint = hintDef.Params.reduce((m, p) => Math.max(m, p.Index + 1), 0);
             maxArgs = Math.max(maxArgs, maxHint);
        }

        // If user typed more args than we know, show them anyway
        const showCount = Math.max(maxArgs, argIndex + 1);

        for (let i = 0; i < showCount; i++) {
            let paramLabel = `Arg${i}`;
            let paramDoc: string | vscode.MarkdownString = "";

            const hintParam = hintDef?.Params?.find(p => p.Index === i);
            
            // Priority 1: Hints
            if (hintParam) {
                paramLabel = hintParam.Ref;
                if (hintParam.Description) paramDoc = hintParam.Description;
            } 
            // Priority 2: Command Def
            else if (cmdDef && cmdDef.Args && cmdDef.Args[i]) {
                paramLabel = cmdDef.Args[i].TentativeName;
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
        
        if (hintDef && hintDef.Description) {
            sigInfo.documentation = new vscode.MarkdownString(hintDef.Description);
        } else if (cmdDef && cmdDef.Description) {
            sigInfo.documentation = new vscode.MarkdownString(cmdDef.Description);
        }

        sigInfo.parameters = paramInfos;
        help.signatures = [sigInfo];

        return help;
    }

    private getCommandContext(document: vscode.TextDocument, position: vscode.Position) {
        let startLine = position.line;
        let foundCmdMatch: RegExpExecArray | null = null;
        let foundLineIndex = -1;

        const cmdRegex = /([A-Z_][A-Z0-9_]*)\s*\(/g;
        
        // 1. Find command start (look back 10 lines)
        for (let i = startLine; i >= Math.max(0, startLine - 10); i--) {
            const lineText = document.lineAt(i).text;
            cmdRegex.lastIndex = 0;
            let match;
            while ((match = cmdRegex.exec(lineText)) !== null) {
                if (i === startLine && match.index + match[0].length > position.character) continue;
                foundCmdMatch = match;
                foundLineIndex = i;
            }
            if (foundCmdMatch) break;
        }

        if (!foundCmdMatch || foundLineIndex === -1) return null;

        const commandName = foundCmdMatch[1];
        const cmdStartIndex = foundCmdMatch.index + foundCmdMatch[0].length;

        // 2. Build full text to count commas
        let fullText = "";
        
        for (let i = foundLineIndex; i <= startLine; i++) {
            let lineStr = document.lineAt(i).text;
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

        // 3. Robust comma counting
        let argIndex = 0;
        let inString = false;
        
        for (let j = 0; j < fullText.length; j++) {
            const char = fullText[j];
            if (char === "'") {
                inString = !inString;
            } else if (char === ',' && !inString) {
                argIndex++;
            }
        }

        return { commandName, argIndex };
    }
}