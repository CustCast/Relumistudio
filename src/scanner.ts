import * as vscode from 'vscode';

export class ProjectScanner {
    // Scans all .ev files in the workspace for regex matches
    public static async scanForMatches(regex: RegExp): Promise<Set<string>> {
        const found = new Set<string>();
        const files = await vscode.workspace.findFiles('**/*.ev');

        for (const file of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Reset regex state to ensure clean search per file
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    found.add(match[0]); 
                }
            } catch (e) {
                console.warn(`Could not read file: ${file.fsPath}`);
            }
        }
        return found;
    }
}