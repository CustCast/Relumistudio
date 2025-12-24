import * as vscode from 'vscode';
import { DataManager } from '../dataManager';
import { ProjectScanner } from '../scanner';

export class AnalysisPanel {
    public static currentPanel: AnalysisPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.webview.html = this._getWebviewContent();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        
        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(async msg => {
            if (msg.command === 'runAnalysis') {
                await this._runAnalysis();
            } else if (msg.command === 'deleteItem') {
                this._deleteItem(msg.type, msg.name);
            }
        });
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.ViewColumn.Active;

        if (AnalysisPanel.currentPanel) {
            AnalysisPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'relumiAnalysis',
            'Project Analysis',
            column,
            { enableScripts: true }
        );

        AnalysisPanel.currentPanel = new AnalysisPanel(panel, extensionUri);
    }

    private async _runAnalysis() {
        const data = DataManager.getInstance();
        
        // 1. Get Defined Keys from JSON
        const definedFlags = new Set(data.flags.keys());
        const definedWorks = new Set(data.works.keys());
        const definedSys = new Set(data.sysFlags.keys());

        // 2. Scan Project for Usages
        // Regex matches things starting with #, @, or $ followed by word chars
        const allUsages = await ProjectScanner.scanForMatches(/([#$@][A-Za-z0-9_]+)/g);

        // 3. Calculate Unused
        const unusedFlags: string[] = [];
        const unusedWorks: string[] = [];
        const unusedSys: string[] = [];

        for (const flag of definedFlags) { if (!allUsages.has(flag)) unusedFlags.push(flag); }
        for (const work of definedWorks) { if (!allUsages.has(work)) unusedWorks.push(work); }
        for (const sys of definedSys) { if (!allUsages.has(sys)) unusedSys.push(sys); }

        // 4. Send Results to Webview
        this._panel.webview.postMessage({
            command: 'results',
            flags: unusedFlags.sort(),
            works: unusedWorks.sort(),
            sys: unusedSys.sort()
        });
    }

    private _deleteItem(type: string, name: string) {
        const data = DataManager.getInstance();
        if (type === 'flag') data.removeFlag(name);
        if (type === 'sys') data.removeSysFlag(name);
        if (type === 'work') data.removeWork(name);
        
        vscode.window.setStatusBarMessage(`Deleted ${name}`, 2000);
    }

    public dispose() {
        AnalysisPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _getWebviewContent() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); padding: 20px; }
        h2 { font-size: 1.1em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 5px; }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; font-size: 1em; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        
        .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 20px; }
        .list { border: 1px solid var(--vscode-panel-border); height: 400px; overflow-y: auto; background: var(--vscode-editor-background); }
        .item { padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--vscode-panel-border); }
        .item:hover { background: var(--vscode-list-hoverBackground); }
        .btn-del { color: var(--vscode-errorForeground); cursor: pointer; font-weight: bold; padding: 0 5px; }
        .btn-del:hover { background: rgba(255,0,0,0.1); border-radius: 3px; }
    </style>
</head>
<body>
    <h1>Unused Definitions</h1>
    <button id="scanBtn" onclick="run()">Run Scan</button>
    
    <div class="grid">
        <div>
            <h2>Flags <span id="count-flag"></span></h2>
            <div id="list-flag" class="list"></div>
        </div>
        <div>
            <h2>Works <span id="count-work"></span></h2>
            <div id="list-work" class="list"></div>
        </div>
        <div>
            <h2>SysFlags <span id="count-sys"></span></h2>
            <div id="list-sys" class="list"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function run() {
            document.getElementById('scanBtn').textContent = 'Scanning...';
            vscode.postMessage({ command: 'runAnalysis' });
        }

        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'results') {
                render('list-flag', 'count-flag', msg.flags, 'flag');
                render('list-work', 'count-work', msg.works, 'work');
                render('list-sys', 'count-sys', msg.sys, 'sys');
                document.getElementById('scanBtn').textContent = 'Run Scan';
            }
        });

        function render(listId, countId, items, type) {
            const el = document.getElementById(listId);
            document.getElementById(countId).textContent = '(' + items.length + ')';
            el.innerHTML = '';
            
            if (items.length === 0) {
                el.innerHTML = '<div style="padding:10px; opacity:0.6">None found!</div>';
                return;
            }

            items.forEach(name => {
                const div = document.createElement('div');
                div.className = 'item';
                div.innerHTML = '<span>' + name + '</span><span class="btn-del" title="Delete Definition" onclick="del(\\''+type+'\\', \\''+name+'\\', this)">🗑️</span>';
                el.appendChild(div);
            });
        }

        function del(type, name, el) {
            if(confirm('Are you sure you want to delete ' + name + ' from definitions?')) {
                vscode.postMessage({ command: 'deleteItem', type: type, name: name });
                el.closest('.item').remove();
            }
        }
    </script>
</body>
</html>`;
    }
}