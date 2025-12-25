import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DataManager } from '../dataManager';

export class HintEditorPanel {
    public static currentPanel: HintEditorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _jsonPath: string = "";

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.webview.html = this._getWebviewContent(this._panel.webview);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                    case 'liveUpdate':
                        DataManager.getInstance().updateHintCache(message.data);
                        return;
                    case 'save':
                        DataManager.getInstance().saveHintsToDisk(message.data);
                        return;
                    case 'cancel':
                        DataManager.getInstance().reloadHintsFromDisk();
                        this._loadHints(); 
                        return;
                    case 'requestLoad':
                        this._loadHints();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.ViewColumn.Two;
        if (HintEditorPanel.currentPanel) {
            HintEditorPanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'relumiHintEditor',
            'Hint Editor',
            column,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );
        HintEditorPanel.currentPanel = new HintEditorPanel(panel, extensionUri);
    }

    public selectCommand(commandName: string) {
        this._panel.webview.postMessage({ command: 'selectCommand', text: commandName });
    }

    private _loadHints() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;
        this._jsonPath = path.join(folders[0].uri.fsPath, 'JSON', 'hints.json');
        
        if (fs.existsSync(this._jsonPath)) {
            try {
                const content = fs.readFileSync(this._jsonPath, 'utf8');
                const data = JSON.parse(content);
                this._panel.webview.postMessage({ command: 'loadData', data: data });
            } catch (e) {
                this._panel.webview.postMessage({ command: 'loadData', data: [] });
            }
        } else {
            this._panel.webview.postMessage({ command: 'loadData', data: [] });
        }
    }

    public dispose() {
        HintEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _getWebviewContent(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hint Editor</title>
    <link href="${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'codicon.css'))}" rel="stylesheet" />
    <style>
        @font-face { font-family: "codicon"; src: url("https://cdnjs.cloudflare.com/ajax/libs/vscode-codicons/0.0.17/codicon.ttf") format("truetype"); }
        .codicon { font-family: "codicon"; display: inline-block; width: 16px; height: 16px; text-align: center; }
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --sidebar-bg: var(--vscode-sideBar-background);
            --border: var(--vscode-panel-border);
            --hover: var(--vscode-list-hoverBackground);
            --active: var(--vscode-list-activeSelectionBackground);
            --active-fg: var(--vscode-list-activeSelectionForeground);
            --input-bg: var(--vscode-input-background);
            --input-border: var(--vscode-input-border);
            --focus: var(--vscode-focusBorder);
            --header-bg: var(--vscode-editorWidget-background);
            --btn-bg: var(--vscode-button-background);
            --btn-fg: var(--vscode-button-foreground);
            --pill-bg: var(--vscode-badge-background);
            --pill-fg: var(--vscode-badge-foreground);
            --accent: var(--vscode-textLink-foreground);
        }
        * { box-sizing: border-box; }
        body { font-family: var(--vscode-font-family); background: var(--bg); color: var(--fg); padding: 0; margin: 0; display: flex; height: 100vh; overflow: hidden; font-size: 13px; }
        input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; cursor: text; }

        .sidebar { width: 220px; background: var(--sidebar-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
        .sidebar-header { padding: 8px; border-bottom: 1px solid var(--border); display: flex; gap: 4px; }
        .search-input { flex: 1; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--fg); padding: 4px; outline: none; border-radius: 2px; }
        .search-input:focus { border-color: var(--focus); }
        .icon-btn { background: transparent; border: 1px solid transparent; color: inherit; cursor: pointer; padding: 4px; border-radius: 3px; display: flex; align-items: center; justify-content: center; }
        .icon-btn:hover { background: var(--hover); }

        .cmd-list { flex: 1; overflow-y: auto; list-style: none; padding: 0; margin: 0; }
        .cmd-item { 
            padding: 4px 8px; cursor: pointer; display: flex; align-items: center; 
            font-family: 'Consolas', monospace; font-size: 12px; border-left: 3px solid transparent;
            word-wrap: break-word;
        }
        .cmd-item:hover { background: var(--hover); }
        .cmd-item.selected { background: var(--active); color: var(--active-fg); border-left-color: var(--accent); }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--border); margin-right: 8px; flex-shrink: 0; }
        .cmd-item.enabled .status-dot { background: #89d185; }

        .main { flex: 1; display: flex; flex-direction: column; background: var(--bg); position: relative; min-width: 0; }
        .empty-state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0.4; font-style: italic; pointer-events: none; }
        .editor-container { display: none; flex-direction: column; height: 100%; }
        .editor-container.visible { display: flex; }
        .editor-scroll { flex: 1; overflow-y: auto; padding: 15px; }

        .section-header { text-transform: uppercase; font-size: 11px; font-weight: 700; opacity: 0.6; margin: 20px 0 8px 0; border-bottom: 1px solid var(--border); padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
        .section-header:first-child { margin-top: 0; }

        .row { margin-bottom: 10px; }
        .label { display: block; margin-bottom: 4px; font-size: 11px; font-weight: 600; opacity: 0.9; }
        .input-text { width: 100%; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--fg); padding: 5px; outline: none; border-radius: 2px; }
        .input-text:focus { border-color: var(--focus); }
        .input-area { width: 100%; height: 50px; resize: vertical; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--fg); padding: 5px; outline: none; font-family: inherit; }

        .param-card { background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 4px; margin-bottom: 10px; overflow: hidden; }
        .param-header { padding: 6px 10px; background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; }
        .param-body { padding: 10px; }
        
        .frag-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
        .frag-item { background: var(--bg); border: 1px solid var(--border); border-radius: 3px; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
        .frag-row { display: flex; gap: 6px; align-items: center; }
        .frag-col-half { flex: 1; min-width: 0; }
        select { width: 100%; background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); padding: 4px; outline: none; border-radius: 2px; height: 26px; }

        .pill { 
            background: var(--pill-bg); color: var(--pill-fg); border-radius: 10px; padding: 1px 8px; font-size: 11px; 
            display: inline-block; user-select: none; font-weight: 500; margin: 0 1px; vertical-align: baseline; white-space: nowrap; line-height: 16px;
        }
        .pill.locked { opacity: 1; cursor: default; }

        .rich-input {
            background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 2px;
            padding: 6px; min-height: 28px; font-family: inherit; font-size: 13px;
            line-height: 1.6; outline: none; white-space: pre-wrap; cursor: text;
            word-break: break-word; display: block;
        }
        .rich-input:focus { border-color: var(--focus); }

        .bottom-bar { padding: 8px 15px; border-top: 1px solid var(--border); background: var(--header-bg); display: flex; justify-content: flex-end; gap: 10px; }
        .btn-primary { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 6px 14px; border-radius: 2px; cursor: pointer; font-weight: 500; font-size: 12px; }
        .btn-primary:hover { opacity: 0.9; }
        .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--fg); padding: 6px 14px; border-radius: 2px; cursor: pointer; font-weight: 500; font-size: 12px; }
        .btn-secondary:hover { background: var(--hover); }
    </style>
</head>
<body>
    <div class="sidebar">
        <div class="sidebar-header">
            <input type="text" id="search" class="search-input" placeholder="Search...">
            <button class="icon-btn" onclick="addNewHint()" title="Add Hint"><span class="codicon">add</span></button>
        </div>
        <ul class="cmd-list" id="cmdList"></ul>
    </div>
    <div class="main">
        <div class="empty-state">Select a command</div>
        <div class="editor-container" id="editorArea">
            <div class="editor-scroll">
                <div class="section-header">Definition</div>
                <div class="row">
                    <label class="label">Description</label>
                    <textarea id="editDesc" class="input-area" placeholder="Tooltip description..." onchange="updateModel('desc')"></textarea>
                </div>
                <div class="row" style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="editEnabled" onchange="updateModel('enabled')">
                    <label for="editEnabled" style="font-size:12px; cursor:pointer;">Enable Inline Hints</label>
                </div>
                <div class="section-header">
                    <span>Parameters</span>
                    <button class="icon-btn" onclick="addParam()" title="Add Parameter"><span class="codicon">add</span></button>
                </div>
                <div id="paramList"></div>
                <div class="section-header">Smart Sentence</div>
                <div class="row">
                    <div class="label" style="font-weight:normal; opacity:0.7; margin-bottom:8px;">
                        Type normally. Use dropdown to insert a reference.
                    </div>
                    <div id="sentenceEditor" class="rich-input" contenteditable="true" oninput="parseSentence()"></div>
                </div>
                <div class="row">
                    <select id="refSelector" onchange="insertPill(this)" style="width: 100%;">
                        <option value="">+ Insert Reference Pill...</option>
                    </select>
                </div>
            </div>
            <div class="bottom-bar">
                <button class="btn-secondary" onclick="cancelChanges()">Cancel</button>
                <button class="btn-primary" onclick="saveAll()">Save Changes</button>
            </div>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        let allHints = [];
        let selectedIndex = -1;
        const CategoryMap = { "Value": ["Value", "Number", "Pokemon", "Ball", "Form", "Item"], "Work": ["Work"], "Flag": ["Flag"], "SysFlag": ["SysFlag"], "String": ["String", "Event", "Message", "Label"] };
        const Categories = Object.keys(CategoryMap);

        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'loadData') { allHints = msg.data || []; renderList(); } 
            else if (msg.command === 'selectCommand') { const idx = allHints.findIndex(h => h.Cmd === msg.text); if (idx !== -1) selectHint(idx); }
        });
        vscode.postMessage({ command: 'requestLoad' });

        function triggerLiveUpdate() { vscode.postMessage({ command: 'liveUpdate', data: allHints }); }
        function saveAll() { vscode.postMessage({ command: 'save', data: allHints }); }
        function cancelChanges() { vscode.postMessage({ command: 'cancel' }); }

        function renderList() {
            const list = document.getElementById('cmdList');
            const filter = document.getElementById('search').value.toLowerCase();
            list.innerHTML = '';
            allHints.forEach((hint, index) => {
                if(hint.Cmd.toLowerCase().includes(filter)) {
                    const li = document.createElement('li');
                    li.className = 'cmd-item' + (index === selectedIndex ? ' selected' : '');
                    if(hint.IsEnabled !== false) li.classList.add('enabled');
                    li.innerHTML = \`<span class="status-dot"></span> \${hint.Cmd}\`;
                    li.onclick = () => selectHint(index);
                    list.appendChild(li);
                }
            });
        }
        document.getElementById('search').addEventListener('input', renderList);

        function selectHint(index) {
            selectedIndex = index;
            renderList();
            const hint = allHints[index];
            if (!hint) return;
            document.querySelector('.empty-state').style.display = 'none';
            document.getElementById('editorArea').classList.add('visible');
            document.getElementById('editDesc').value = hint.Description || '';
            document.getElementById('editEnabled').checked = hint.IsEnabled !== false;
            renderParams();
            renderSentenceEditor();
        }

        function renderParams() {
            const container = document.getElementById('paramList');
            container.innerHTML = '';
            const hint = allHints[selectedIndex];
            if (!hint.Params) hint.Params = [];
            updateGlobalRefDropdown();
            hint.Params.forEach((p, pIndex) => {
                if (!p.Fragments) p.Fragments = {}; 
                if (!p.Type) p.Type = ['Value'];

                const card = document.createElement('div');
                card.className = 'param-card';
                const depVal = (p.DependsOn !== undefined && p.DependsOn !== null) ? p.DependsOn : '';
                card.innerHTML = \`
                    <div class="param-header">
                        <span>Arg \${p.Index}</span>
                        <span class="codicon" onclick="removeParam(\${pIndex})" title="Remove">trash</span>
                    </div>
                    <div class="param-body">
                        <div class="row" style="display:flex; gap:10px;">
                            <div style="flex:1;">
                                <label class="label">Reference Name</label>
                                <input type="text" class="input-text" value="\${p.Ref}" oninput="updateParamRef(\${pIndex}, this.value)">
                            </div>
                            <div style="width:90px;">
                                <label class="label">Depends On</label>
                                <input type="number" class="input-text" value="\${depVal}" placeholder="Arg Idx" min="0" onchange="updateParam(\${pIndex}, 'DependsOn', this.value)">
                            </div>
                        </div>
                        <div class="row">
                            <label class="label">Description</label>
                            <input type="text" class="input-text" value="\${p.Description||''}" onchange="updateParam(\${pIndex}, 'Description', this.value)">
                        </div>
                        <div class="row" style="border-top:1px solid var(--border); padding-top:10px; margin-top:10px;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                                <span class="label">Fragment Templates</span>
                                <span class="codicon" onclick="addFragment(\${pIndex})" title="Add Type" style="cursor:pointer">add</span>
                            </div>
                            <div id="fragList_\${pIndex}" class="frag-list"></div>
                        </div>
                    </div>
                \`;
                container.appendChild(card);
                renderFragments(pIndex, p);
            });
        }

        function updateGlobalRefDropdown() {
             const hint = allHints[selectedIndex];
             const refSel = document.getElementById('refSelector');
             refSel.innerHTML = '<option value="">+ Insert Reference Pill...</option>';
             if(!hint.Params) return;
             hint.Params.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.Ref;
                opt.text = \`Arg \${p.Index} (\${p.Ref})\`;
                refSel.appendChild(opt);
            });
        }

        function updateParamRef(pIndex, newRef) {
            const hint = allHints[selectedIndex];
            const oldRef = hint.Params[pIndex].Ref;
            hint.Params[pIndex].Ref = newRef;
            const fragList = document.getElementById(\`fragList_\${pIndex}\`);
            if (fragList) {
                const pills = fragList.querySelectorAll('.pill.locked');
                pills.forEach(pill => pill.innerText = \`{\${newRef}}\`);
            }
            const editor = document.getElementById('sentenceEditor');
            const pills = editor.querySelectorAll('.pill');
            pills.forEach(pill => {
                if (pill.dataset.val === oldRef) {
                    pill.dataset.val = newRef;
                    pill.innerText = \`{\${newRef}}\`;
                }
            });
            hint.Sentence.forEach(part => {
                if (part.IsRef && part.Text === \`{\${oldRef}}\`) {
                    part.Text = \`{\${newRef}}\`;
                }
            });
            updateGlobalRefDropdown();
            triggerLiveUpdate();
        }

        function renderFragments(pIndex, param) {
            const container = document.getElementById(\`fragList_\${pIndex}\`);
            container.innerHTML = '';
            const types = param.Type || ['Value'];
            const frags = param.Fragments || { 'Value': '{Value}' };
            const zeros = param.ShowZero || [];

            types.forEach((type, tIndex) => {
                let category = 'Value';
                for (const [cat, subTypes] of Object.entries(CategoryMap)) {
                    if (subTypes.includes(type)) { category = cat; break; }
                }
                const rawFrag = frags[type] || '{Value}';
                let prefix = '', suffix = '';
                const parts = rawFrag.split('{Value}');
                if (parts.length > 0) prefix = parts[0];
                if (parts.length > 1) suffix = parts[1];

                const item = document.createElement('div');
                item.className = 'frag-item';
                let catOpts = '';
                Categories.forEach(c => { catOpts += \`<option value="\${c}" \${c===category?'selected':''}>\${c}</option>\`; });
                let subOpts = '';
                CategoryMap[category].forEach(t => { subOpts += \`<option value="\${t}" \${t===type?'selected':''}>\${t}</option>\`; });
                const isZero = zeros.includes(type);

                item.innerHTML = \`
                    <div class="frag-row">
                        <div class="frag-col-half"><select onchange="onCategoryChange(\${pIndex}, \${tIndex}, this.value)">\${catOpts}</select></div>
                        <div class="frag-col-half"><select onchange="onTypeChange(\${pIndex}, \${tIndex}, this.value)">\${subOpts}</select></div>
                        <span class="codicon" onclick="removeFrag(\${pIndex}, \${tIndex})" style="cursor:pointer; opacity:0.6;">close</span>
                    </div>
                    <div class="frag-row">
                        <div class="rich-input" style="width:100%;" contenteditable="true" oninput="parseFragment(\${pIndex}, '\${type}', this)">\${prefix}<span class="pill locked" contenteditable="false">{\${param.Ref}}</span>\${suffix}</div>
                    </div>
                    <div class="frag-row">
                         <label style="display:flex; align-items:center; gap:4px; font-size:11px; white-space:nowrap; opacity:0.8;">
                            <input type="checkbox" \${isZero?'checked':''} onchange="updateFrag(\${pIndex}, '\${type}', 'zero', this.checked)"> Hide if 0?
                        </label>
                    </div>
                \`;
                container.appendChild(item);
            });
        }

        function parseFragment(pIndex, type, editor) {
            const nodes = Array.from(editor.childNodes);
            let prefix = "";
            let suffix = "";
            let foundPill = false;
            nodes.forEach(node => {
                if (node.nodeType === 1 && node.classList.contains('pill')) foundPill = true;
                else if (node.textContent) {
                    if (!foundPill) prefix += node.textContent;
                    else suffix += node.textContent;
                }
            });
            if (!foundPill) {
                const p = allHints[selectedIndex].Params[pIndex];
                editor.innerHTML = \`\${prefix}<span class="pill locked" contenteditable="false">{\${p.Ref}}</span>\${suffix}\`;
                try {
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(editor);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                } catch(e) {}
            }
            const p = allHints[selectedIndex].Params[pIndex];
            
            if (!p.Fragments) p.Fragments = {}; // Ensure initialization
            p.Fragments[type] = \`\${prefix}{Value}\${suffix}\`;
            
            triggerLiveUpdate();
        }

        function onCategoryChange(pIndex, tIndex, newCategory) { updateType(pIndex, tIndex, CategoryMap[newCategory][0]); }
        function onTypeChange(pIndex, tIndex, newType) { updateType(pIndex, tIndex, newType); }
        
        function updateType(pIndex, tIndex, newType) {
            const p = allHints[selectedIndex].Params[pIndex];
            const oldType = p.Type[tIndex];

            if (oldType === newType) return; // Prevent unnecessary updates and accidental deletion

            // Check if oldType is used by other rows
            let othersUseOld = false;
            p.Type.forEach((t, i) => { if(i !== tIndex && t === oldType) othersUseOld = true; });

            if (!p.Fragments) p.Fragments = {}; // Ensure exists
            const content = p.Fragments[oldType] || '{Value}';
            p.Type[tIndex] = newType;

            // Preserve content to new type if not exists
            if (!p.Fragments[newType]) {
                p.Fragments[newType] = content;
            }

            // Only delete old type key if no one else uses it
            if (!othersUseOld) {
                delete p.Fragments[oldType];
            }
            
            // Handle Zero Logic
            if (p.ShowZero && p.ShowZero.includes(oldType)) {
                p.ShowZero = p.ShowZero.filter(x=>x!==oldType); 
                p.ShowZero.push(newType);
            }

            renderFragments(pIndex, p);
            triggerLiveUpdate();
        }

        function renderSentenceEditor() {
            const editor = document.getElementById('sentenceEditor');
            const hint = allHints[selectedIndex];
            if (!hint.Sentence) hint.Sentence = [];
            let html = '';
            hint.Sentence.forEach(part => {
                if (part.IsRef) {
                    const refName = part.Text.replace(/[{}]/g,'');
                    html += \`<span class="pill" contenteditable="false" data-val="\${refName}">\${part.Text}</span>\`;
                } else { html += part.Text; }
            });
            editor.innerHTML = html;
        }

        function insertPill(sel) {
            const ref = sel.value;
            if (!ref) return;
            const editor = document.getElementById('sentenceEditor');
            editor.focus();
            const html = \`<span class="pill" contenteditable="false" data-val="\${ref}">{\${ref}}</span>\`; 
            document.execCommand('insertHTML', false, html);
            sel.value = "";
            parseSentence();
        }

        function parseSentence() {
            const editor = document.getElementById('sentenceEditor');
            const newSentence = [];
            editor.childNodes.forEach(node => {
                if (node.nodeType === 3) {
                    if (node.textContent) newSentence.push({ Text: node.textContent, IsRef: false });
                } else if (node.nodeType === 1 && node.classList.contains('pill')) {
                    newSentence.push({ Text: node.innerText, IsRef: true });
                } else { newSentence.push({ Text: node.textContent, IsRef: false }); }
            });
            allHints[selectedIndex].Sentence = newSentence;
            triggerLiveUpdate();
        }

        function updateModel(field) {
            const h = allHints[selectedIndex];
            if (field === 'desc') h.Description = document.getElementById('editDesc').value;
            if (field === 'enabled') { h.IsEnabled = document.getElementById('editEnabled').checked; renderList(); }
            triggerLiveUpdate();
        }
        function addNewHint() {
            const name = prompt("Command Name:");
            if (name) { allHints.push({ Cmd: name.toUpperCase(), Params: [], Sentence: [] }); renderList(); selectHint(allHints.length-1); triggerLiveUpdate(); }
        }
        function addParam() {
            const h = allHints[selectedIndex];
            h.Params.push({ Index: h.Params.length, Ref: 'arg'+h.Params.length, Type:['Value'], Fragments:{'Value':'{Value}'} });
            renderParams();
            triggerLiveUpdate();
        }
        function removeParam(i) {
            if(confirm('Delete parameter?')) { allHints[selectedIndex].Params.splice(i, 1); renderParams(); triggerLiveUpdate(); }
        }
        function updateParam(i, key, val) {
            if (key === 'DependsOn') { val = val === '' ? undefined : parseInt(val); }
            allHints[selectedIndex].Params[i][key] = val;
            triggerLiveUpdate();
        }
        
        function addFragment(pIndex) {
            const p = allHints[selectedIndex].Params[pIndex];
            p.Type.push('Value'); 
            if(!p.Fragments) p.Fragments={}; 
            if (!p.Fragments['Value']) p.Fragments['Value']="{Value}"; 
            renderFragments(pIndex, p);
            triggerLiveUpdate();
        }
        
        function removeFrag(pIndex, tIndex) {
            const p = allHints[selectedIndex].Params[pIndex];
            const type = p.Type[tIndex];
            
            // Check usage
            let othersUse = false;
            p.Type.forEach((t, i) => { if (i !== tIndex && t === type) othersUse = true; });

            p.Type.splice(tIndex, 1); 
            
            if (!othersUse) delete p.Fragments[type]; 
            
            renderFragments(pIndex, p);
            triggerLiveUpdate();
        }
        function updateFrag(pIndex, type, key, val) {
            const p = allHints[selectedIndex].Params[pIndex];
            if (key==='zero') {
                if(!p.ShowZero) p.ShowZero=[];
                if(val && !p.ShowZero.includes(type)) p.ShowZero.push(type);
                else if(!val) p.ShowZero = p.ShowZero.filter(x=>x!==type);
            }
            triggerLiveUpdate();
        }
    </script>
</body>
</html>`;
    }
}