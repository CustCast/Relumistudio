import * as vscode from 'vscode';
import { DataManager } from './dataManager';

export class BDSPSignatureHelpProvider implements vscode.SignatureHelpProvider {

    // Helper to map specific types to the 5 Parent categories
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
        return "Value"; 
    }

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

            const showCount = Math.max(maxArgs, argIndex + 1);

            for (let i = 0; i < showCount; i++) {
                let paramLabel = `Arg${i}`;
                let paramDoc: vscode.MarkdownString | string = "";

                if (activeDef.Params) {
                    const hintParam = activeDef.Params.find(p => p.Index === i);
                    if (hintParam) {
                        paramLabel = hintParam.Ref || `Arg${i}`;
                        
                        // Map Types
                        const rawTypes = hintParam.Type || ['Value'];
                        const parentTypes = Array.from(new Set(rawTypes.map(t => this.getParentType(t))));
                        
                        // Format: ('Value' | 'Work')
                        const typeStr = parentTypes.length > 0 ? `(\`${parentTypes.join('` | `')}\`)` : '';
                        const descStr = hintParam.Description || '';
                        
                        // **Name** ('Type'): _Description_
                        const md = new vscode.MarkdownString();
                        md.appendMarkdown(`**${paramLabel}** ${typeStr}`);
                        
                        if (descStr) {
                            md.appendMarkdown(`: _${descStr}_`);
                        }
                        
                        md.isTrusted = true;
                        paramDoc = md;
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
        
        const commentIdx = lineText.indexOf('//');
        if (commentIdx !== -1 && position.character > commentIdx) return null;

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
                    openParenIndex = i;
                    break;
                }
            } else if (char === ',' && depth === 0) {
                argIndex++;
            }
        }

        if (openParenIndex === -1) return null; 

        const textBefore = lineText.substring(0, openParenIndex);
        const match = textBefore.match(/([A-Z0-9_]+)\s*$/);

        if (match) {
            return { commandName: match[1], argIndex };
        }

        return null;
    }
}