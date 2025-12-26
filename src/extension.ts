import * as vscode from 'vscode';
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
import { ReferenceTreeProvider } from './referenceTreeProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('ReLumiStudio is active!');

    const indexer = new ScriptIndexer();
    indexer.refreshIndex(); 
    const tracer = new ScriptTracer(indexer); 

    const navProvider = new BDSPNavigationProvider();
    const decoProvider = new BDSPDecorationProvider();
    const messageProvider = new MessagePreviewProvider(context.extensionUri);
    const refTreeProvider = new ReferenceTreeProvider();
    
    // NATIVE EXPLORER
    const explorerProvider = new RelumiExplorerProvider(); 

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('bdsp', new BDSPHoverProvider()),
        vscode.languages.registerCompletionItemProvider('bdsp', new BDSPCompletionProvider(), '(', ',', '#', '$', '@'),
        vscode.languages.registerDefinitionProvider('bdsp', navProvider),
        vscode.languages.registerReferenceProvider('bdsp', navProvider),
        vscode.languages.registerCallHierarchyProvider('bdsp', navProvider)
    );

    // Register Native Tree
    vscode.window.registerTreeDataProvider('relumi-scripts', explorerProvider);
    
    // Register References Tree
    vscode.window.registerTreeDataProvider('relumi-references', refTreeProvider);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MessagePreviewProvider.viewType, messageProvider)
    );

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
            explorerProvider.refresh(true); 
        }
    }, null, context.subscriptions);
    
    if (vscode.window.activeTextEditor) updateDecos(vscode.window.activeTextEditor);

    DataManager.getInstance().onHintsChangedEmitter.event(() => updateDecos(vscode.window.activeTextEditor));

    // --- Message Preview Update Logic ---
    const triggerMessageUpdate = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'bdsp') return;
        
        const position = editor.selection.active;
        const document = editor.document;
        const lineText = document.lineAt(position.line).text;

        if (HintEditorPanel.currentPanel) {
            const range = document.getWordRangeAtPosition(position);
            if (range) {
                const word = document.getText(range);
                if (DataManager.getInstance().commands.has(word)) {
                    HintEditorPanel.currentPanel.selectCommand(word);
                }
            }
        }

        const stdMatch = lineText.match(/(?:_TALKMSG|_TALK_KEYWAIT|_EASY_OBJ_MSG|_EASY_BOARD_MSG)\s*\(\s*'([\w.-]+)%([\w.-]+)'\s*.*\)/);
        const macroMatch = lineText.match(/(?:_MACRO_TALKMSG|_MACRO_TALK_KEYWAIT|_MACRO_EASY_OBJ_MSG)\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);

        let rawMessage: string | null = null;
        let currentLabel: string | null = null;

        if (macroMatch) {
            rawMessage = macroMatch[3];
            currentLabel = macroMatch[2];
        } 
        else if (stdMatch) {
            const fileName = stdMatch[1];
            const label = stdMatch[2];
            rawMessage = DataManager.getInstance().getMessage(fileName, label);
            currentLabel = label;
            
            if (!rawMessage) return;
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
            const simpleMatch = lineText.match(/'([^']*)'/);
            let showedString = false;

            if (simpleMatch) {
                const idx = lineText.indexOf(simpleMatch[0]);
                if (position.character >= idx && position.character <= idx + simpleMatch[0].length) {
                    messageProvider.updateMessage(simpleMatch[1]);
                    showedString = true;
                }
            }
            if (!showedString) messageProvider.updateMessage("");
        }
    };

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(triggerMessageUpdate)
    );
    
    DataManager.getInstance().onDataLoadedEmitter.event(() => {
        triggerMessageUpdate();
        explorerProvider.refresh(true);
    });

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('relumistudio.openHintEditor', () => {
            HintEditorPanel.createOrShow(context.extensionUri);
        }),
        vscode.commands.registerCommand('relumistudio.refreshData', () => {
            DataManager.getInstance().loadData();
            indexer.refreshIndex(); 
        }),
        vscode.commands.registerCommand('relumistudio.navMessagePrev', () => {
            messageProvider.navigate('prev');
        }),
        vscode.commands.registerCommand('relumistudio.navMessageNext', () => {
            messageProvider.navigate('next');
        }),
        vscode.commands.registerCommand('relumistudio.findAdvancedReferences', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const range = editor.document.getWordRangeAtPosition(editor.selection.active);
            if (!range) return;
            const word = editor.document.getText(range);
            await vscode.commands.executeCommand('relumi-references.focus');
            refTreeProvider.findReferences(word);
        }),
        vscode.commands.registerCommand('relumistudio.searchExplorer', async () => {
            const term = await vscode.window.showInputBox({ 
                placeHolder: "Filter scripts, flags, works...",
                prompt: "Enter search term (leave empty to clear)",
                value: explorerProvider.getFilterString()
            });
            if (term !== undefined) {
                explorerProvider.setFilter(term);
            }
        }),
        vscode.commands.registerCommand('relumistudio.clearExplorerFilter', () => {
            explorerProvider.setFilter("");
        })
    );

    DataManager.getInstance().loadData();
}

export function deactivate() {}