import * as vscode from 'vscode';
import * as path from 'path';
import { DataManager } from './dataManager';
import { RelumiExplorerProvider } from './explorerProvider';
import { BDSPHoverProvider } from './hoverProvider';
import { HintEditorPanel } from './panels/HintEditorPanel';
import { BDSPCompletionProvider } from './completionProvider';
import { BDSPNavigationProvider } from './navigationProvider';
import { BDSPDecorationProvider } from './decorationProvider';
import { MessagePreviewProvider } from './messagePreviewProvider';
import { ScriptIndexer } from './indexer';
import { ScriptTracer } from './tracer'; 
import { BDSPSignatureHelpProvider } from './signatureProvider';
import { convertToMacro } from './talkMsgConverter';
import { TalkMsgCreatorPanel } from './panels/TalkMsgCreatorPanel';

export function activate(context: vscode.ExtensionContext) {
    DataManager.log('ReLumiStudio is active!');

    // --- Services ---
    const indexer = new ScriptIndexer();
    indexer.refreshIndex(); 
    const tracer = new ScriptTracer(indexer); 

    const navProvider = new BDSPNavigationProvider();
    const decoProvider = new BDSPDecorationProvider();
    
    // Instantiate Message Provider
    const messageProvider = new MessagePreviewProvider(context.extensionUri);

    // --- EXPLORER PROVIDERS ---
    const scriptsProvider = new RelumiExplorerProvider('relumi-scripts');
    const dataProvider = new RelumiExplorerProvider('relumi-data');
    const commandsProvider = new RelumiExplorerProvider('relumi-commands');
    const analysisProvider = new RelumiExplorerProvider('relumi-analysis');
    const allExplorers = [scriptsProvider, dataProvider, commandsProvider, analysisProvider];

    // --- Registrations ---
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('bdsp', new BDSPHoverProvider()),
        vscode.languages.registerSignatureHelpProvider('bdsp', new BDSPSignatureHelpProvider(), '(', ','),
        vscode.languages.registerCompletionItemProvider('bdsp', new BDSPCompletionProvider(), '(', ',', '#', '$', '@'),
        vscode.languages.registerDefinitionProvider('bdsp', navProvider),
        vscode.languages.registerReferenceProvider('bdsp', navProvider),
        vscode.languages.registerCallHierarchyProvider('bdsp', navProvider)
    );

    vscode.window.registerTreeDataProvider('relumi-scripts', scriptsProvider);
    vscode.window.registerTreeDataProvider('relumi-data', dataProvider);
    vscode.window.registerTreeDataProvider('relumi-commands', commandsProvider);
    vscode.window.registerTreeDataProvider('relumi-analysis', analysisProvider);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MessagePreviewProvider.viewType, messageProvider)
    );

    // --- Event Listeners ---

    // 1. Decoration Updates (Keep immediate, it's visual)
    const updateDecos = (editor: vscode.TextEditor | undefined) => {
        if (editor) decoProvider.triggerUpdate(editor);
    };
    vscode.window.onDidChangeActiveTextEditor(editor => updateDecos(editor), null, context.subscriptions);
    if (vscode.window.activeTextEditor) updateDecos(vscode.window.activeTextEditor);
    
    // 2. Document Changes
    // REMOVED: allExplorers.refresh() from here. It was causing the lag/crash.
    vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            updateDecos(editor);
        }
    }, null, context.subscriptions);
    
    // 3. Save Event (Refresh expensive things here)
    // FIX: Debounce save event to prevent spamming refreshIndex
    let saveDebounce: NodeJS.Timeout | undefined;
    vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.languageId === 'bdsp' || doc.fileName.endsWith('.ev')) {
            if (saveDebounce) clearTimeout(saveDebounce);
            saveDebounce = setTimeout(() => {
                DataManager.log('File saved. Refreshing analysis and index...');
                indexer.refreshIndex();
                allExplorers.forEach(p => p.refresh(true));
            }, 1000); // 1-second delay
        }
    }, null, context.subscriptions);

    DataManager.getInstance().onHintsChangedEmitter.event(() => updateDecos(vscode.window.activeTextEditor));

    // --- Message Preview & Hint Sync ---
    // Debounced to prevent blocking typing
    let selectionDebounce: NodeJS.Timeout | undefined;

    const triggerMessageUpdate = async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'bdsp') return;
            
            const position = editor.selection.active;
            const document = editor.document;
            const lineText = document.lineAt(position.line).text;

            // 1. Sync Hint Editor
            if (HintEditorPanel.currentPanel) {
                const range = document.getWordRangeAtPosition(position);
                if (range) {
                    const word = document.getText(range);
                    if (DataManager.getInstance().hints.has(word)) {
                        HintEditorPanel.currentPanel.selectCommand(word);
                    }
                }
            }

            // 2. Message Preview
            let rawMessage: string | null = null;
            let currentLabel: string | null = null;

            const stringRange = document.getWordRangeAtPosition(position, /'([^']*)'/);
            
            if (stringRange) {
                const rawString = document.getText(stringRange);
                const content = rawString.substring(1, rawString.length - 1);

                let msgFile = "";
                let msgLabel = "";

                if (content.includes('%')) {
                    const parts = content.split('%');
                    msgFile = parts[0];
                    msgLabel = parts[1];
                } else {
                    msgFile = path.basename(document.fileName, '.ev');
                    msgLabel = content;
                }

                const candidateMsg = DataManager.getInstance().getMessage(msgFile, msgLabel);
                if (candidateMsg && candidateMsg !== msgLabel && candidateMsg !== content) {
                    rawMessage = candidateMsg;
                    currentLabel = msgLabel;
                }
            }

            if (!rawMessage) {
                const stdMatch = lineText.match(/(?:_TALKMSG|_TALK_KEYWAIT|_EASY_OBJ_MSG|_EASY_BOARD_MSG)\s*\(\s*'([\w.-]+)%([\w.-]+)'\s*.*\)/);
                const macroMatch = lineText.match(/(?:_MACRO_TALKMSG|_MACRO_TALK_KEYWAIT|_MACRO_EASY_OBJ_MSG)\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
                const unifiedMatch = lineText.match(/_MACRO_MSG\s*\(\s*'[^']+'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'[^)]*\)/);

                if (unifiedMatch) {
                    // _MACRO_MSG('TYPE', 'bundle', 'label', 'text')
                    rawMessage = unifiedMatch[3];
                    currentLabel = unifiedMatch[2];
                }
                else if (macroMatch) {
                    rawMessage = macroMatch[3];
                    currentLabel = macroMatch[2];
                }
                else if (stdMatch) {
                    const fileName = stdMatch[1];
                    const label = stdMatch[2];
                    rawMessage = DataManager.getInstance().getMessage(fileName, label);
                    currentLabel = label;
                } 
            }

            if (rawMessage) {
                const placeholderRegex = /\{(\d+)(?::(\d+))?\}/g;
                let finalMessage = rawMessage;
                let match;
                const replacements = new Map<string, string>();

                while ((match = placeholderRegex.exec(rawMessage)) !== null) {
                    const fullMatch = match[0];
                    const tagIndex = parseInt(match[1]);
                    const groupID = match[2] ? parseInt(match[2]) : 1; 

                    if (!replacements.has(fullMatch)) {
                        const resolvedCmd = await tracer.resolveTagIndex(document, position.line, tagIndex, groupID);
                        if (resolvedCmd) {
                            replacements.set(fullMatch, resolvedCmd); 
                        } else {
                            replacements.set(fullMatch, `{${tagIndex}}`);
                        }
                    }
                }
                replacements.forEach((val, key) => {
                    finalMessage = finalMessage.split(key).join(val);
                });

                let speakerName: string | null = null;
                if (currentLabel) {
                    speakerName = DataManager.getInstance().getSpeaker(currentLabel);
                }
                messageProvider.updateMessage(finalMessage, speakerName);
            }
            else {
                messageProvider.updateMessage("");
            }
        } catch (e) {
            DataManager.log(`[MsgSyncError] ${e}`);
        }
    };

    // DEBOUNCE LISTENER (300ms)
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(() => {
            if (selectionDebounce) clearTimeout(selectionDebounce);
            selectionDebounce = setTimeout(triggerMessageUpdate, 300);
        })
    );
    
    DataManager.getInstance().onDataLoadedEmitter.event(() => {
        DataManager.log("Data loaded. Refreshing UI.");
        triggerMessageUpdate();
        allExplorers.forEach(p => p.refresh(true));
    });

    // --- Commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('relumistudio.triggerNextArg', async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            await vscode.commands.executeCommand('editor.action.triggerSuggest');
            await vscode.commands.executeCommand('editor.action.triggerParameterHints');
        }),
        vscode.commands.registerCommand('relumistudio.openHintEditor', () => HintEditorPanel.createOrShow(context.extensionUri)),
        vscode.commands.registerCommand('relumistudio.refreshData', () => {
            DataManager.log("Manual refresh requested.");
            DataManager.getInstance().loadData();
            indexer.refreshIndex(); 
        }),
        vscode.commands.registerCommand('relumistudio.navMessagePrev', () => messageProvider.navigate('prev')),
        vscode.commands.registerCommand('relumistudio.navMessageNext', () => messageProvider.navigate('next')),
        vscode.commands.registerCommand('relumistudio.searchExplorer', async () => {
            const term = await vscode.window.showInputBox({ prompt: "Filter Explorer..." });
            if (term !== undefined) allExplorers.forEach(p => p.setFilter(term));
        }),
        vscode.commands.registerCommand('relumistudio.clearExplorerFilter', () => allExplorers.forEach(p => p.setFilter(""))),
        vscode.commands.registerCommand('relumistudio.convertToMacro', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) await convertToMacro(editor);
        }),
        vscode.commands.registerCommand('relumistudio.openMsgCreator', () => TalkMsgCreatorPanel.createOrShow(context.extensionUri))
    );

    DataManager.getInstance().loadData();
}

export function deactivate() {}