import * as vscode from 'vscode';
import { ScriptIndexer } from './indexer';
import { DataManager } from './dataManager';

export class TraceHoverProvider implements vscode.HoverProvider {
    constructor(private indexer: ScriptIndexer) {}

    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
        // 1. Identification: [0] or {0} or @TagIndex
        // Matches typical message placeholder patterns
        const range = document.getWordRangeAtPosition(position, /(@\w+|\[\w+\]|\{\d+\})/);
        if (!range) return null;

        const word = document.getText(range);
        const targetVar = word.replace(/[@\[\]\{\}]/g, ''); // "0" or "TagIndex"

        // 2. Run the Tracer
        const result = await this.traceSource(document, position.line, targetVar);

        if (result) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**Last Write Detected:**`);
            md.appendCodeblock(result.lineText.trim(), 'bdsp');
            md.appendMarkdown(`Found in: \`${result.uri.path.split('/').pop()}\` at line ${result.line + 1}`);
            // Explicitly state this was found via the Hint system
            md.appendMarkdown(`\n\n*(Identified via TagIndex hint)*`);
            return new vscode.Hover(md);
        }

        return null;
    }

    private async traceSource(startDoc: vscode.TextDocument, startLine: number, targetVar: string) {
        let queue = [{ uri: startDoc.uri, line: startLine }];
        let visitedLabels = new Set<string>();
        let steps = 0;

        while (queue.length > 0 && steps < 50) { 
            steps++;
            const current = queue.shift()!;
            
            const doc = await vscode.workspace.openTextDocument(current.uri);
            const text = doc.getText();
            const lines = text.split('\n');

            // Scan UPWARDS
            for (let i = current.line - 1; i >= 0; i--) {
                const lineText = lines[i];

                // --- NEW LOGIC: Type-Based Detection for TagIndex ---
                if (this.isWriter(lineText, targetVar)) {
                    return { uri: current.uri, line: i, lineText: lineText };
                }

                // Block Boundary Logic
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

    private isWriter(line: string, variable: string): boolean {
        // 1. Parse Command: "CMD(arg, arg)"
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*\((.*)\)/);
        if (!match) return false;

        const cmdName = match[1];
        const argsStr = match[2];
        const args = argsStr.split(',').map(s => s.trim());

        // 2. Lookup in DataManager
        const hint = DataManager.getInstance().hints.get(cmdName);
        if (!hint || !hint.Params) return false;

        // 3. Check if any param is type 'TagIndex' AND matches our variable
        for (const p of hint.Params) {
            // Check if this param is tagged as TagIndex
            const types = p.Type || [];
            if (types.includes('TagIndex')) {
                // If the value passed to this param matches our target variable
                // Example: _SUPPORT_NAME(0) -> Arg is "0". Target is "0". Match!
                if (args[p.Index] === variable) {
                    return true;
                }
            }
        }

        return false;
    }
}