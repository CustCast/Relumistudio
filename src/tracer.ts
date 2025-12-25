import * as vscode from 'vscode';
import { ScriptIndexer } from './indexer';
import { DataManager } from './dataManager';

export class ScriptTracer {
    constructor(private indexer: ScriptIndexer) {}

    // Maps Group ID from Message File to Hint Type
    // Group 1: Names (_PLAYER_NAME)
    // Group 2: Numbers (_NUMBER_NAME)
    private readonly GROUP_TO_TYPE: { [key: number]: string } = {
        1: 'TagIndex',
        2: 'NumberIndex' 
    };

    public async resolveTagIndex(startDoc: vscode.TextDocument, startLine: number, tagIndex: number, groupID: number): Promise<string | null> {
        // Determine what hint type we are looking for
        const targetType = this.GROUP_TO_TYPE[groupID] || 'TagIndex';

        let queue = [{ uri: startDoc.uri, line: startLine }];
        let visitedLabels = new Set<string>();
        let steps = 0;

        while (queue.length > 0 && steps < 50) { 
            steps++;
            const current = queue.shift()!;
            
            const doc = await vscode.workspace.openTextDocument(current.uri);
            const text = doc.getText();
            const lines = text.split('\n');

            for (let i = current.line - 1; i >= 0; i--) {
                const lineText = lines[i];

                // Check for writer with specific TYPE
                const foundCommand = this.findWriterCommand(lineText, tagIndex, targetType);
                if (foundCommand) {
                    return foundCommand; 
                }

                const labelMatch = lineText.match(/^Label\s+@(\w+)/);
                if (labelMatch) {
                    const labelName = labelMatch[1];
                    if (visitedLabels.has(labelName)) break; 
                    visitedLabels.add(labelName);

                    const callers = this.indexer.getPredecessors(labelName);
                    for (const caller of callers) {
                        queue.push({ uri: caller.uri, line: caller.range.start.line });
                    }
                    break; 
                }
            }
        }
        return null;
    }

    private findWriterCommand(line: string, targetIndex: number, targetType: string): string | null {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*\((.*)\)/);
        if (!match) return null;

        const cmdName = match[1];
        const argsStr = match[2];
        const args = argsStr.split(',').map(s => s.trim());

        const hint = DataManager.getInstance().hints.get(cmdName);
        if (!hint || !hint.Params) return null;

        for (const p of hint.Params) {
            const types = p.Type || [];
            
            // CRITICAL: Only match if the command argument has the correct TYPE
            if (types.includes(targetType)) {
                const argVal = parseInt(args[p.Index]);
                if (!isNaN(argVal) && argVal === targetIndex) {
                    return cmdName;
                }
            }
        }

        return null;
    }
}