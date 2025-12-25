import * as vscode from 'vscode';

export class ScriptIndexer {
    // Map: "Event_Name" -> Location (File + Line)
    private labelDefinitions = new Map<string, vscode.Location>();
    
    // Map: "Event_Name" -> List of Locations that Jump/Call it
    private jumpReferences = new Map<string, vscode.Location[]>();

    public async refreshIndex() {
        this.labelDefinitions.clear();
        this.jumpReferences.clear();

        // Scan all .ev files (as defined in your package.json)
        const files = await vscode.workspace.findFiles('**/*.ev');

        for (const fileUri of files) {
            await this.parseFile(fileUri);
        }
    }

    private async parseFile(uri: vscode.Uri) {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText();
            
            // Adjust Regex to match your BDSP syntax
            // Captures: "Label @EventName" or similar
            const labelRegex = /^Label\s+@(\w+)/gm; 
            // Captures: "Jump @EventName" or "Call @EventName"
            const jumpRegex = /(?:Jump|Call)\s+@(\w+)/gm;

            let match;
            while ((match = labelRegex.exec(text)) !== null) {
                const labelName = match[1];
                const position = document.positionAt(match.index);
                this.labelDefinitions.set(labelName, new vscode.Location(uri, position));
            }

            while ((match = jumpRegex.exec(text)) !== null) {
                const labelName = match[1];
                const position = document.positionAt(match.index);
                
                if (!this.jumpReferences.has(labelName)) {
                    this.jumpReferences.set(labelName, []);
                }
                this.jumpReferences.get(labelName)?.push(new vscode.Location(uri, position));
            }
        } catch (e) {
            console.error(`Indexer failed on ${uri.fsPath}`, e);
        }
    }

    public getPredecessors(labelName: string): vscode.Location[] {
        return this.jumpReferences.get(labelName) || [];
    }
}