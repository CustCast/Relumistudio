import * as vscode from 'vscode';
import * as fs from 'fs';

export class BDSPNavigationProvider implements vscode.DefinitionProvider, vscode.ReferenceProvider {

    // --- 1. GO TO DEFINITION (Ctrl+Click) ---
    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        
        const range = document.getWordRangeAtPosition(position);
        if (!range) return;

        const word = document.getText(range);
        
        // Assume alphanumeric string is a potential label
        if (/^[a-zA-Z0-9_]+$/.test(word)) {
            // 1. Check local file first (Fastest)
            const localLoc = this.findLabelInFile(document.getText(), word, document.uri);
            if (localLoc) return localLoc;

            // 2. Check workspace (Slower)
            return await this.findLabelInWorkspace(word);
        }
    }

    // --- 2. FIND ALL REFERENCES (Right Click) ---
    public async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {

        const range = document.getWordRangeAtPosition(position);
        if (!range) return [];
        const word = document.getText(range);

        const locations: vscode.Location[] = [];
        
        // Escape regex characters just in case
        const searchPattern = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Regex: Look for word NOT surrounded by other word characters (whole word match)
        // Matches "WORD" but not "WORD_2"
        const regex = new RegExp(`(?<![\\w#$@])` + searchPattern + `(?![\\w])`, 'g');

        const files = await vscode.workspace.findFiles('**/*.ev');

        for (const file of files) {
            if (token.isCancellationRequested) break;

            const doc = await vscode.workspace.openTextDocument(file);
            const text = doc.getText();
            
            let match;
            while ((match = regex.exec(text)) !== null) {
                const startPos = doc.positionAt(match.index);
                const endPos = doc.positionAt(match.index + match[0].length);
                locations.push(new vscode.Location(file, new vscode.Range(startPos, endPos)));
            }
        }

        return locations;
    }

    // --- HELPERS ---

    private findLabelInFile(content: string, label: string, uri: vscode.Uri): vscode.Location | undefined {
        // Regex looks for "LabelName:" at start of line
        // We escape the label to ensure special chars don't break regex
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^\\s*${escapedLabel}:\\s*$`, 'm');
        const match = regex.exec(content);
        
        if (match) {
            const lines = content.substring(0, match.index).split('\n');
            const lineNum = lines.length - 1;
            return new vscode.Location(uri, new vscode.Position(lineNum, 0));
        }
    }

    private async findLabelInWorkspace(label: string): Promise<vscode.Location | undefined> {
        const files = await vscode.workspace.findFiles('**/*.ev');
        for (const file of files) {
            // Use readFileSync for speed on large workspaces instead of opening doc
            const content = fs.readFileSync(file.fsPath, 'utf-8');
            const loc = this.findLabelInFile(content, label, file);
            if (loc) return loc;
        }
    }
}