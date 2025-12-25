import * as vscode from 'vscode';

export class MessagePreviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'relumi-message-preview';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'media')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    public updateMessage(text: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'updateText', text: text });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Construct paths
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'messageRenderer.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'message.css'));
        
        const fontDir = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'fonts'));
        const atlasMapUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'fonts', 'atlas_map.json'));
        const textboxUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'fonts', 'textbox.png'));
        const metricsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'fonts', 'strlength.txt'));

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet">
            <title>Message Preview</title>
            <script>
                window.fontBaseUri = "${fontDir}";
                window.atlasMapUri = "${atlasMapUri}";
                window.textboxUri = "${textboxUri}";
                window.metricsUri = "${metricsUri}";
            </script>
        </head>
        <body>
            <div class="canvas-container">
                <div id="arrowPrev" class="nav-arrow left">◀</div>
                <div id="arrowNext" class="nav-arrow right">▶</div>
                <div id="pageIndicator" class="page-overlay">1/1</div>
                
                <canvas id="messageCanvas" width="1500" height="230"></canvas>
            </div>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}