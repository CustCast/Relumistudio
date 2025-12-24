import * as vscode from 'vscode';
import { DataManager } from './dataManager';
import { ScriptTreeProvider } from './scriptTreeProvider';
import { BDSPHoverProvider } from './hoverProvider';
import { HintEditorPanel } from './panels/HintEditorPanel';
import { BDSPCompletionProvider } from './completionProvider';
import { BDSPNavigationProvider } from './navigationProvider';
import { AnalysisPanel } from './panels/AnalysisPanel';
import { BDSPDecorationProvider } from './decorationProvider';
import { MessagePreviewProvider } from './messagePreviewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('ReLumiStudio is active!');

    DataManager.getInstance().loadData();

    // --- Providers ---
    const navProvider = new BDSPNavigationProvider();
    const decoProvider = new BDSPDecorationProvider();
    const messageProvider = new MessagePreviewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('bdsp', new BDSPHoverProvider()),
        vscode.languages.registerCompletionItemProvider('bdsp', new BDSPCompletionProvider(), '(', ',', '#', '$', '@'),
        vscode.languages.registerDefinitionProvider('bdsp', navProvider),
        vscode.languages.registerReferenceProvider('bdsp', navProvider)
    );

    // --- Views ---
    vscode.window.registerTreeDataProvider('relumi-scripts', new ScriptTreeProvider());
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MessagePreviewProvider.viewType, messageProvider)
    );

    // --- Events (Decoration Updates) ---
    const updateDecos = (editor: vscode.TextEditor | undefined) => {
        if (editor) decoProvider.triggerUpdate(editor);
    };

    vscode.window.onDidChangeActiveTextEditor(editor => updateDecos(editor), null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(event => {
        if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
            updateDecos(vscode.window.activeTextEditor);
        }
    }, null, context.subscriptions);
    
    if (vscode.window.activeTextEditor) updateDecos(vscode.window.activeTextEditor);

    DataManager.getInstance().onHintsChangedEmitter.event(() => updateDecos(vscode.window.activeTextEditor));

    // --- EVENTS: MESSAGE PREVIEW SYNC ---
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            if (e.textEditor.document.languageId !== 'bdsp') return;

            const position = e.selections[0].active;
            const document = e.textEditor.document;
            const lineText = document.lineAt(position.line).text;

            // 1. Hint Editor Sync
            if (HintEditorPanel.currentPanel) {
                const range = document.getWordRangeAtPosition(position);
                if (range) {
                    const word = document.getText(range);
                    if (DataManager.getInstance().commands.has(word)) {
                        HintEditorPanel.currentPanel.selectCommand(word);
                    }
                }
            }

            // 2. Message Preview Sync
            
            // Regex for Standard Lookup: _TALKMSG('File%Label')
            const stdMatch = lineText.match(/(?:_TALKMSG|_TALK_KEYWAIT|_EASY_OBJ_MSG|_EASY_BOARD_MSG)\s*\(\s*'([\w.-]+)%([\w.-]+)'\s*.*\)/);
            
            // Regex for Macro: _MACRO_TALKMSG('File', 'Label', 'TEXT')
            const macroMatch = lineText.match(/(?:_MACRO_TALKMSG|_MACRO_TALK_KEYWAIT|_MACRO_EASY_OBJ_MSG)\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);

            if (macroMatch) {
                // Macro contains the text directly in the 3rd argument
                console.log(`[Preview] Macro Detected: ${macroMatch[3]}`);
                messageProvider.updateMessage(macroMatch[3]);
            } 
            else if (stdMatch) {
                const fileName = stdMatch[1];
                const label = stdMatch[2];
                console.log(`[Preview] Lookup: File=${fileName}, Label=${label}`);

                const message = DataManager.getInstance().getMessage(fileName, label);
                
                if (message) {
                    messageProvider.updateMessage(message);
                } else {
                    messageProvider.updateMessage(`[ERROR] Message not found!\nFile: ${fileName}\nLabel: ${label}\n\n(Make sure english_*.json files are in your workspace)`);
                }
            } 
            else {
                // Fallback: Check for string under cursor
                const simpleMatch = lineText.match(/'([^']*)'/);
                if (simpleMatch) {
                    const idx = lineText.indexOf(simpleMatch[0]);
                    if (position.character >= idx && position.character <= idx + simpleMatch[0].length) {
                        messageProvider.updateMessage(simpleMatch[1]);
                    }
                }
            }
        })
    );

    // --- Commands ---
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
}

export function deactivate() {}