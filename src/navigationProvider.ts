import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class BDSPNavigationProvider implements vscode.DefinitionProvider, vscode.ReferenceProvider, vscode.CallHierarchyProvider {

    // --- 1. GO TO DEFINITION (Ctrl+Click / Peek Definition) ---
    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        
        const range = document.getWordRangeAtPosition(position);
        if (!range) return;

        const word = document.getText(range);
        const lineText = document.lineAt(position.line).text;

        // Allow any identifier that looks like a label
        const isLabelCandidate = /^[a-zA-Z0-9_]+$/.test(word);
        
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cmdRegex = new RegExp(`(?:Jump|Call)\\s*\\(\\s*'${escapedWord}'`);
        const isCommandArg = cmdRegex.test(lineText);

        const isDefinitionLine = new RegExp(`^\\s*${escapedWord}:`).test(lineText);

        if (isLabelCandidate || isCommandArg || isDefinitionLine) {
            const localLoc = this.findLabelInFile(document.getText(), word, document.uri);
            if (localLoc) return localLoc;
            return await this.findLabelInWorkspace(word);
        }
        
        return undefined;
    }

    // --- 2. FIND ALL REFERENCES (Right Click / Peek References) ---
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
        
        const searchPattern = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<![\\w])` + searchPattern + `(?![\\w])`, 'g');

        const files = await vscode.workspace.findFiles('**/*.ev');

        for (const file of files) {
            if (token.isCancellationRequested) break;
            const contentRaw = fs.readFileSync(file.fsPath, 'utf-8');
            if (!contentRaw.includes(word)) continue;

            const lines = contentRaw.split(/\r?\n/);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // Check for semicolon comment
                const commentIdx = line.indexOf(';');
                
                let match;
                while ((match = regex.exec(line)) !== null) {
                    // Ignore matches after semicolon
                    if (commentIdx !== -1 && match.index > commentIdx) continue; 
                    const startPos = new vscode.Position(i, match.index);
                    const endPos = new vscode.Position(i, match.index + match[0].length);
                    locations.push(new vscode.Location(file, new vscode.Range(startPos, endPos)));
                }
            }
        }
        return locations;
    }

    // --- 3. CALL HIERARCHY ---

    public async prepareCallHierarchy(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CallHierarchyItem | vscode.CallHierarchyItem[] | undefined> {
        
        const range = document.getWordRangeAtPosition(position);
        if (!range) return;
        const word = document.getText(range);

        if (!/^[a-zA-Z0-9_]+$/.test(word)) return;

        let loc = this.findLabelInFile(document.getText(), word, document.uri);
        if (!loc) {
            loc = await this.findLabelInWorkspace(word);
        }

        if (loc) {
            return new vscode.CallHierarchyItem(
                vscode.SymbolKind.Function,
                word,
                '', 
                loc.uri,
                loc.range,
                loc.range
            );
        }
    }

    public async provideCallHierarchyIncomingCalls(
        item: vscode.CallHierarchyItem,
        token: vscode.CancellationToken
    ): Promise<vscode.CallHierarchyIncomingCall[]> {
        
        const results: vscode.CallHierarchyIncomingCall[] = [];
        const word = item.name;
        
        const files = await vscode.workspace.findFiles('**/*.ev');
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(Jump|Call)\\s*\\(\\s*'${escaped}'`, 'g');

        for (const file of files) {
            if (token.isCancellationRequested) break;
            const content = fs.readFileSync(file.fsPath, 'utf-8');
            if (!content.includes(word)) continue;

            const lines = content.split(/\r?\n/);
            
            let currentCallerEvent: string | null = null;
            let currentCallerLine = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                
                const labelMatch = line.match(/^([a-zA-Z0-9_]+):/);
                if (labelMatch) {
                    currentCallerEvent = labelMatch[1];
                    currentCallerLine = i;
                }

                let match;
                while ((match = regex.exec(line)) !== null) {
                    if (!currentCallerEvent) continue; 
                    
                    const callerItem = new vscode.CallHierarchyItem(
                        vscode.SymbolKind.Function,
                        currentCallerEvent,
                        path.basename(file.fsPath),
                        file,
                        new vscode.Range(currentCallerLine, 0, currentCallerLine, 10),
                        new vscode.Range(currentCallerLine, 0, currentCallerLine, 10)
                    );

                    const start = new vscode.Position(i, match.index);
                    const end = new vscode.Position(i, match.index + match[0].length);
                    
                    results.push(new vscode.CallHierarchyIncomingCall(
                        callerItem,
                        [new vscode.Range(start, end)]
                    ));
                }
            }
        }

        return results;
    }

    public async provideCallHierarchyOutgoingCalls(
        item: vscode.CallHierarchyItem,
        token: vscode.CancellationToken
    ): Promise<vscode.CallHierarchyOutgoingCall[]> {
        
        const results: vscode.CallHierarchyOutgoingCall[] = [];
        
        const content = fs.readFileSync(item.uri.fsPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const startLine = item.range.start.line;

        for (let i = startLine + 1; i < lines.length; i++) {
            const line = lines[i];

            if (/^([a-zA-Z0-9_]+):/.test(line)) break;

            const callMatch = line.match(/(?:Jump|Call)\s*\(\s*'([a-zA-Z0-9_]+)'/);
            
            if (callMatch) {
                const targetName = callMatch[1];
                
                let targetLoc = this.findLabelInFile(content, targetName, item.uri);
                if (!targetLoc) {
                    targetLoc = await this.findLabelInWorkspace(targetName);
                }

                if (targetLoc) {
                    const targetItem = new vscode.CallHierarchyItem(
                        vscode.SymbolKind.Function,
                        targetName,
                        path.basename(targetLoc.uri.fsPath),
                        targetLoc.uri,
                        targetLoc.range,
                        targetLoc.range
                    );

                    const start = new vscode.Position(i, callMatch.index!);
                    const end = new vscode.Position(i, callMatch.index! + callMatch[0].length);

                    results.push(new vscode.CallHierarchyOutgoingCall(
                        targetItem,
                        [new vscode.Range(start, end)]
                    ));
                }
            }
        }

        return results;
    }

    // --- HELPERS ---

    private findLabelInFile(content: string, label: string, uri: vscode.Uri): vscode.Location | undefined {
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
            const content = fs.readFileSync(file.fsPath, 'utf-8');
            const loc = this.findLabelInFile(content, label, file);
            if (loc) return loc;
        }
    }
}