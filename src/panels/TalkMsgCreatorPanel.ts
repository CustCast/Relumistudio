import * as vscode from 'vscode';
import * as crypto from 'crypto';

/** Bundle files that support inline messages */
const DATA_FILES = [
    'dp_scenario1',
    'dp_scenario2',
    'dp_scenario3',
    'dp_options',
    'ss_report',
    'dlp_underground',
    'dp_tvshow',
    'dlp_net_union_room',
    'dp_trainer_msg_sub',
    'dp_poffin_main',
    'ss_fld_shop',
    'dlp_gmstation',
    'dlp_rotom_message',
    'ss_fld_dressup',
    'dp_net_communication',
    'dp_contest',
    'ss_net_net_btl',
    'ss_btl_tower_main',
    'ss_btl_tower_menu_ui_text',
];

const MSG_TYPES = ['TALKMSG', 'TALK_KEYWAIT', 'EASY_OBJ_MSG', 'EASY_BOARD_MSG', 'ADD_CUSTUM_WIN_LABEL'];

export class TalkMsgCreatorPanel {
    public static currentPanel: TalkMsgCreatorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.webview.html = this._getWebviewContent();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'insert':
                        this._insertAtCursor(message.text);
                        return;
                    case 'copy':
                        vscode.env.clipboard.writeText(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.ViewColumn.Two;
        if (TalkMsgCreatorPanel.currentPanel) {
            TalkMsgCreatorPanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'relumiTalkMsgCreator',
            'Message Creator',
            column,
            { enableScripts: true, localResourceRoots: [] }
        );
        TalkMsgCreatorPanel.currentPanel = new TalkMsgCreatorPanel(panel, extensionUri);
    }

    private async _insertAtCursor(text: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active text editor to insert into.');
            return;
        }
        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, text);
        });
    }

    public dispose() {
        TalkMsgCreatorPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }

    private _getWebviewContent(): string {
        const typeOptions = MSG_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
        const bundleOptions = DATA_FILES.map(f => `<option value="${f}">${f}</option>`).join('');
        const nonce = crypto.randomBytes(16).toString('hex');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Message Creator</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --input-bg: var(--vscode-input-background);
            --input-border: var(--vscode-input-border);
            --focus: var(--vscode-focusBorder);
            --btn-bg: var(--vscode-button-background);
            --btn-fg: var(--vscode-button-foreground);
            --border: var(--vscode-panel-border);
            --header-bg: var(--vscode-editorWidget-background);
        }
        * { box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            background: var(--bg);
            color: var(--fg);
            padding: 15px;
            margin: 0;
            font-size: 13px;
        }
        h2 { margin: 0 0 15px 0; font-size: 16px; font-weight: 600; }

        .row { margin-bottom: 12px; }
        .label { display: block; margin-bottom: 4px; font-size: 11px; font-weight: 600; opacity: 0.9; }
        select, input, textarea {
            width: 100%;
            background: var(--input-bg);
            border: 1px solid var(--input-border);
            color: var(--fg);
            padding: 6px;
            outline: none;
            border-radius: 2px;
            font-family: inherit;
            font-size: 13px;
        }
        select:focus, input:focus, textarea:focus { border-color: var(--focus); }
        textarea { min-height: 100px; resize: vertical; }

        .preview {
            background: var(--header-bg);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 10px;
            font-family: 'Consolas', monospace;
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-all;
            min-height: 40px;
            margin-bottom: 12px;
        }
        .preview-label { font-size: 11px; font-weight: 600; opacity: 0.6; text-transform: uppercase; margin-bottom: 6px; }

        .btn-row { display: flex; gap: 10px; }
        .btn-primary {
            background: var(--btn-bg);
            color: var(--btn-fg);
            border: none;
            padding: 8px 16px;
            border-radius: 2px;
            cursor: pointer;
            font-weight: 500;
            font-size: 13px;
        }
        .btn-primary:hover { opacity: 0.9; }
        .btn-secondary {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--fg);
            padding: 8px 16px;
            border-radius: 2px;
            cursor: pointer;
        }
        .btn-secondary:hover { background: var(--input-bg); }

        .inline-row { display: flex; gap: 10px; }
        .inline-row > div { flex: 1; }
    </style>
</head>
<body>
    <h2>Message Creator</h2>

    <div class="inline-row">
        <div class="row">
            <label class="label">Message Type</label>
            <select id="msgType" onchange="updatePreview()">
                ${typeOptions}
            </select>
        </div>
        <div class="row">
            <label class="label">Bundle File</label>
            <select id="bundleFile" onchange="updatePreview()">
                ${bundleOptions}
            </select>
        </div>
    </div>

    <div class="row">
        <label class="label">Label Name</label>
        <input type="text" id="labelName" placeholder="e.g. 00_msg_npc_greeting" oninput="updatePreview()">
    </div>

    <div class="row">
        <label class="label">Message Text</label>
        <textarea id="msgText" placeholder="Hello there!\\nWelcome to the world of Pok&eacute;mon!" oninput="updatePreview()"></textarea>
    </div>

    <div class="preview-label">Preview</div>
    <div class="preview" id="preview"></div>

    <div class="btn-row">
        <button class="btn-primary" onclick="insertMacro()">Insert at Cursor</button>
        <button class="btn-secondary" onclick="copyToClipboard()">Copy to Clipboard</button>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function getValues() {
            return {
                type: document.getElementById('msgType').value,
                bundle: document.getElementById('bundleFile').value,
                label: document.getElementById('labelName').value,
                text: document.getElementById('msgText').value,
            };
        }

        function buildMacro() {
            const v = getValues();
            if (!v.label || !v.text) return '';
            // Escape the text: convert actual newlines to \\n sequences
            let text = v.text.replace(/\\r\\n/g, '\\\\n').replace(/\\n/g, '\\\\n');
            // Replace ASCII apostrophes with smart quotes (ANTLR grammar uses ' as delimiters)
            text = text.replace(/'/g, '\\u2019');
            return \`_MACRO_MSG('\${v.type}', '\${v.bundle}', '\${v.label}', '\${text}')\`;
        }

        function updatePreview() {
            const macro = buildMacro();
            document.getElementById('preview').textContent = macro || '(fill in label and text above)';
        }

        function insertMacro() {
            const macro = buildMacro();
            if (!macro) return;
            vscode.postMessage({ command: 'insert', text: '\\t' + macro + '\\n' });
        }

        function copyToClipboard() {
            const macro = buildMacro();
            if (!macro) return;
            vscode.postMessage({ command: 'copy', text: '\\t' + macro });
        }

        updatePreview();
    </script>
</body>
</html>`;
    }
}
