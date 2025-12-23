import * as vscode from 'vscode';
import { DataManager } from './dataManager';
import { ScriptTreeProvider } from './scriptTreeProvider';
import { BDSPHoverProvider } from './hoverProvider';
import { HintEditorPanel } from './panels/HintEditorPanel';
import { BDSPCompletionProvider } from './completionProvider'; // Import new file

export function activate(context: vscode.ExtensionContext) {
    console.log('ReLumiStudio is active!');

    // 1. Load Data
    DataManager.getInstance().loadData();

    // 2. Register Providers
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('bdsp', new BDSPHoverProvider())
    );

    // --- NEW: Register Completion Provider ---
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'bdsp', 
            new BDSPCompletionProvider(), 
            '(', ',', '#', '$', '@' // Trigger characters
        )
    );

    // 3. Register Views & Commands
    vscode.window.registerTreeDataProvider('relumi-scripts', new ScriptTreeProvider());

    context.subscriptions.push(
        vscode.commands.registerCommand('relumistudio.openHintEditor', () => {
            HintEditorPanel.createOrShow(context.extensionUri);
        }),
        vscode.commands.registerCommand('relumistudio.refreshData', () => {
            DataManager.getInstance().loadData();
        })
    );

    // 4. Cursor Tracking
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            if (HintEditorPanel.currentPanel && e.textEditor.document.languageId === 'bdsp') {
                const range = e.textEditor.document.getWordRangeAtPosition(e.selections[0].active);
                if (range) {
                    const word = e.textEditor.document.getText(range);
                    if (DataManager.getInstance().commands.has(word)) {
                        HintEditorPanel.currentPanel.selectCommand(word);
                    }
                }
            }
        })
    );
}

export function deactivate() {}