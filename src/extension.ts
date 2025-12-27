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

export function activate(context: vscode.ExtensionContext) {
    console.log('ReLumiStudio is active!');

    // --- Services ---
    const indexer = new ScriptIndexer();
    indexer.refreshIndex(); 
    const tracer = new ScriptTracer(indexer); 

    const navProvider = new BDSPNavigationProvider();
    const decoProvider = new BDSPDecorationProvider();
    
    // Instantiate Message Provider
    const messageProvider = new MessagePreviewProvider(context.extensionUri);

    // --- EXPLORER PROVIDERS (One for each view) ---
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

    // Register 4 Separate Views for Sidebar
    vscode.window.registerTreeDataProvider('relumi-scripts', scriptsProvider);
    vscode.window.registerTreeDataProvider('relumi-data', dataProvider);
    vscode.window.registerTreeDataProvider('relumi-commands', commandsProvider);
    vscode.window.registerTreeDataProvider('relumi-analysis', analysisProvider);
    
    // Register Message Preview View (Bottom Panel)
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MessagePreviewProvider.viewType, messageProvider)
    );

    // --- Event Listeners ---

    const updateDecos = (editor: vscode.TextEditor | undefined) => {
        if (editor) decoProvider.triggerUpdate(editor);
    };

    // 1. Editor Change
    vscode.window.onDidChangeActiveTextEditor(editor => updateDecos(editor), null, context.subscriptions);
    
    // 2. Document Change
    let debounceTimer: NodeJS.Timeout | undefined;

    vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            updateDecos(editor);
        }

        if (event.document.languageId === 'bdsp' || event.document.fileName.endsWith('.ev')) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                allExplorers.forEach(p => p.refresh(true));
            }, 500);
        }
    }, null, context.subscriptions);
    
    // 3. Save Event
    vscode.workspace.onDidSaveTextDocument(doc => {
        if (vscode.window.activeTextEditor && doc === vscode.window.activeTextEditor.document) {
            updateDecos(vscode.window.activeTextEditor);
        }
        if (doc.languageId === 'bdsp' || doc.fileName.endsWith('.ev')) {
            console.log('File saved. Refreshing script index...');
            indexer.refreshIndex();
            allExplorers.forEach(p => p.refresh(true));
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

        // Sync Hint Editor
        if (HintEditorPanel.currentPanel) {
            const range = document.getWordRangeAtPosition(position);
            if (range) {
                const word = document.getText(range);
                if (DataManager.getInstance().commands.has(word)) {
                    HintEditorPanel.currentPanel.selectCommand(word);
                }
            }
        }

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

            if (macroMatch) {
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
    };

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(triggerMessageUpdate)
    );
    
    DataManager.getInstance().onDataLoadedEmitter.event(() => {
        triggerMessageUpdate();
        allExplorers.forEach(p => p.refresh(true));
    });

    // --- Commands ---
    context.subscriptions.push(
        // Command to handle the "Chain Completion" logic (re-trigger suggest and signature help)
        vscode.commands.registerCommand('relumistudio.triggerNextArg', async () => {
            // Small delay to ensure the insert text edit is fully applied
            await new Promise(resolve => setTimeout(resolve, 50));
            await vscode.commands.executeCommand('editor.action.triggerSuggest');
            await vscode.commands.executeCommand('editor.action.triggerParameterHints');
        }),
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
        vscode.commands.registerCommand('relumistudio.searchExplorer', async () => {
            const currentFilter = allExplorers[0].getFilterString();
            const term = await vscode.window.showInputBox({ 
                placeHolder: "Filter scripts, flags, works...",
                prompt: "Enter search term (leave empty to clear)",
                value: currentFilter
            });
            if (term !== undefined) {
                allExplorers.forEach(p => p.setFilter(term));
            }
        }),
        vscode.commands.registerCommand('relumistudio.clearExplorerFilter', () => {
            allExplorers.forEach(p => p.setFilter(""));
        })
    );

    DataManager.getInstance().loadData();
}

export function deactivate() {}