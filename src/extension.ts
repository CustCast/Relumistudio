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
import { ScriptIndexer } from './indexer';
import { ScriptTracer } from './tracer'; 

export function activate(context: vscode.ExtensionContext) {
    console.log('ReLumiStudio is active!');

    DataManager.getInstance().loadData();

    // 1. Initialize Indexer & Tracer
    const indexer = new ScriptIndexer();
    indexer.refreshIndex(); 
    const tracer = new ScriptTracer(indexer); 

    // Providers
    const navProvider = new BDSPNavigationProvider();
    const decoProvider = new BDSPDecorationProvider();
    const messageProvider = new MessagePreviewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('bdsp', new BDSPHoverProvider()),
        vscode.languages.registerCompletionItemProvider('bdsp', new BDSPCompletionProvider(), '(', ',', '#', '$', '@'),
        vscode.languages.registerDefinitionProvider('bdsp', navProvider),
        vscode.languages.registerReferenceProvider('bdsp', navProvider)
    );

    vscode.window.registerTreeDataProvider('relumi-scripts', new ScriptTreeProvider());
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MessagePreviewProvider.viewType, messageProvider)
    );

    // Decoration Events
    const updateDecos = (editor: vscode.TextEditor | undefined) => {
        if (editor) decoProvider.triggerUpdate(editor);
    };

    vscode.window.onDidChangeActiveTextEditor(editor => updateDecos(editor), null, context.subscriptions);
    
    vscode.workspace.onDidChangeTextDocument(event => {
        if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
            updateDecos(vscode.window.activeTextEditor);
        }
    }, null, context.subscriptions);
    
    vscode.workspace.onDidSaveTextDocument(doc => {
        if (vscode.window.activeTextEditor && doc === vscode.window.activeTextEditor.document) {
            updateDecos(vscode.window.activeTextEditor);
        }
        if (doc.languageId === 'bdsp' || doc.fileName.endsWith('.ev')) {
            console.log('File saved. Refreshing script index...');
            indexer.refreshIndex();
        }
    }, null, context.subscriptions);
    
    if (vscode.window.activeTextEditor) updateDecos(vscode.window.activeTextEditor);

    DataManager.getInstance().onHintsChangedEmitter.event(() => updateDecos(vscode.window.activeTextEditor));

    // --- MESSAGE PREVIEW SYNC ---
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(async e => { 
            if (e.textEditor.document.languageId !== 'bdsp') return;

            const position = e.selections[0].active;
            const document = e.textEditor.document;
            const lineText = document.lineAt(position.line).text;

            // Hint Editor Sync
            if (HintEditorPanel.currentPanel) {
                const range = document.getWordRangeAtPosition(position);
                if (range) {
                    const word = document.getText(range);
                    if (DataManager.getInstance().commands.has(word)) {
                        HintEditorPanel.currentPanel.selectCommand(word);
                    }
                }
            }

            // Message Preview Sync
            const stdMatch = lineText.match(/(?:_TALKMSG|_TALK_KEYWAIT|_EASY_OBJ_MSG|_EASY_BOARD_MSG)\s*\(\s*'([\w.-]+)%([\w.-]+)'\s*.*\)/);
            const macroMatch = lineText.match(/(?:_MACRO_TALKMSG|_MACRO_TALK_KEYWAIT|_MACRO_EASY_OBJ_MSG)\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);

            let rawMessage: string | null = null;

            if (macroMatch) {
                rawMessage = macroMatch[3];
            } 
            else if (stdMatch) {
                const fileName = stdMatch[1];
                const label = stdMatch[2];
                rawMessage = DataManager.getInstance().getMessage(fileName, label);
                
                if (!rawMessage) {
                    messageProvider.updateMessage(`[ERROR] Message not found!\nFile: ${fileName}\nLabel: ${label}`);
                    return;
                }
            } 

            // --- Dynamic Placeholders ---
            if (rawMessage) {
                // Regex matches {Index} OR {Index:Group}
                // Examples: {0}, {0:2}
                const placeholderRegex = /\{(\d+)(?::(\d+))?\}/g;
                let finalMessage = rawMessage;
                let match;

                const replacements = new Map<string, string>();

                while ((match = placeholderRegex.exec(rawMessage)) !== null) {
                    const fullMatch = match[0];       // "{0:2}"
                    const tagIndex = parseInt(match[1]); // 0
                    const groupID = match[2] ? parseInt(match[2]) : 1; // 2 (Default to 1 if missing)

                    if (!replacements.has(fullMatch)) {
                        // Pass Group ID to Tracer
                        const resolvedCmd = await tracer.resolveTagIndex(document, position.line, tagIndex, groupID);
                        
                        if (resolvedCmd) {
                            replacements.set(fullMatch, resolvedCmd); 
                        } else {
                            // Cleanup: Show just {0} if trace failed, remove the :2 part
                            replacements.set(fullMatch, `{${tagIndex}}`);
                        }
                    }
                }

                replacements.forEach((val, key) => {
                    finalMessage = finalMessage.split(key).join(val);
                });

                messageProvider.updateMessage(finalMessage);
            }
            else {
                // Fallback: Check for simple string literal under cursor
                const simpleMatch = lineText.match(/'([^']*)'/);
                let showedString = false;

                if (simpleMatch) {
                    const idx = lineText.indexOf(simpleMatch[0]);
                    if (position.character >= idx && position.character <= idx + simpleMatch[0].length) {
                        messageProvider.updateMessage(simpleMatch[1]);
                        showedString = true;
                    }
                }
                
                // If no message found and not in a string, blank out the preview
                if (!showedString) {
                    messageProvider.updateMessage("");
                }
            }
        })
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('relumistudio.openHintEditor', () => {
            HintEditorPanel.createOrShow(context.extensionUri);
        }),
        vscode.commands.registerCommand('relumistudio.refreshData', () => {
            DataManager.getInstance().loadData();
            indexer.refreshIndex(); 
        }),
        vscode.commands.registerCommand('relumistudio.openAnalysis', () => {
            AnalysisPanel.createOrShow(context.extensionUri);
        }),
        // Message Preview Navigation Commands
        vscode.commands.registerCommand('relumistudio.navMessagePrev', () => {
            messageProvider.navigate('prev');
        }),
        vscode.commands.registerCommand('relumistudio.navMessageNext', () => {
            messageProvider.navigate('next');
        })
    );
}

export function deactivate() {}