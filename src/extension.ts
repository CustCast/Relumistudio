import * as vscode from 'vscode';
import { DataManager } from './dataManager';
import { ScriptTreeProvider } from './scriptTreeProvider';
import { BDSPHoverProvider } from './hoverProvider';
import { HintEditorPanel } from './panels/HintEditorPanel';
import { BDSPCompletionProvider } from './completionProvider';
import { BDSPNavigationProvider } from './navigationProvider';
import { AnalysisPanel } from './panels/AnalysisPanel';
import { BDSPDecorationProvider } from './decorationProvider'; // <-- New Import

export function activate(context: vscode.ExtensionContext) {
    console.log('ReLumiStudio is active!');

    DataManager.getInstance().loadData();

    // Providers
    const navProvider = new BDSPNavigationProvider();
    // Swap Inlay for Decoration Provider
    const decoProvider = new BDSPDecorationProvider(); 

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('bdsp', new BDSPHoverProvider()),
        vscode.languages.registerCompletionItemProvider('bdsp', new BDSPCompletionProvider(), '(', ',', '#', '$', '@'),
        vscode.languages.registerDefinitionProvider('bdsp', navProvider),
        vscode.languages.registerReferenceProvider('bdsp', navProvider)
        // Removed InlayHintsProvider registration
    );

    // --- Events to Trigger Decoration Updates ---
    
    // 1. When text changes (typing)
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) decoProvider.triggerUpdate(editor);
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
            decoProvider.triggerUpdate(vscode.window.activeTextEditor);
        }
    }, null, context.subscriptions);

    // 2. When Hint Data changes (Live Update from Webview)
    DataManager.getInstance().onHintsChangedEmitter.event(() => {
        if (vscode.window.activeTextEditor) {
            decoProvider.triggerUpdate(vscode.window.activeTextEditor);
        }
    });

    // 3. Initial Trigger
    if (vscode.window.activeTextEditor) {
        decoProvider.triggerUpdate(vscode.window.activeTextEditor);
    }

    // --- Commands ---
    vscode.window.registerTreeDataProvider('relumi-scripts', new ScriptTreeProvider());

    context.subscriptions.push(
        vscode.commands.registerCommand('relumistudio.openHintEditor', () => {
            HintEditorPanel.createOrShow(context.extensionUri);
        }),
        vscode.commands.registerCommand('relumistudio.refreshData', () => {
            DataManager.getInstance().loadData();
        }),
        vscode.commands.registerCommand('relumistudio.openAnalysis', () => {
            AnalysisPanel.createOrShow(context.extensionUri);
        })
    );

    // Track Selection for Hint Editor
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