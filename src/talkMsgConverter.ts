import * as vscode from 'vscode';
import { DataManager } from './dataManager';

/**
 * Maps raw command names to _MACRO_MSG type strings.
 */
const COMMAND_TO_TYPE: { [key: string]: string } = {
    '_TALKMSG': 'TALKMSG',
    '_TALK_KEYWAIT': 'TALK_KEYWAIT',
    '_EASY_OBJ_MSG': 'EASY_OBJ_MSG',
    '_EASY_BOARD_MSG': 'EASY_BOARD_MSG',
};

/** Regex to match supported commands with file%label format */
const CMD_PATTERN = new RegExp(
    `^(\\s*)(${Object.keys(COMMAND_TO_TYPE).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})` +
    `\\s*\\(\\s*'([^']+%[^']+)'\\s*((?:,\\s*[^)]+)?)\\)`,
);

/**
 * Convert eventIDs in message text back to escape sequences.
 * The DataManager returns text with {n}, {r}, {f} markers already,
 * so we convert those to assembler escape sequences.
 */
function convertToEscapeSequences(text: string): string {
    return text
        .replace(/\{n\}/g, '\\n')
        .replace(/\{r\}/g, '\\r')
        .replace(/\{f\}/g, '\\f');
}

export async function convertToMacro(editor: vscode.TextEditor) {
    const document = editor.document;
    const selection = editor.selection;
    const line = document.lineAt(selection.active.line);
    const lineText = line.text;

    const match = lineText.match(CMD_PATTERN);
    if (!match) {
        vscode.window.showInformationMessage('No convertible message command found on this line.');
        return;
    }

    const indent = match[1];
    const command = match[2];
    const ref = match[3];       // file%label
    const trailingArgs = match[4]; // may be empty or ", 1" etc.

    const typeName = COMMAND_TO_TYPE[command];
    if (!typeName) {
        vscode.window.showErrorMessage(`Unknown command: ${command}`);
        return;
    }

    const parts = ref.split('%');
    if (parts.length !== 2) {
        vscode.window.showErrorMessage(`Invalid reference format: ${ref}`);
        return;
    }

    const fileName = parts[0];
    const labelName = parts[1];

    // Look up message text
    const dm = DataManager.getInstance();
    const rawMessage = dm.getMessage(fileName, labelName);

    if (!rawMessage) {
        vscode.window.showWarningMessage(
            `Could not find message text for ${fileName}%${labelName}. ` +
            `Make sure message assets are loaded (try ReLumi: Refresh Data).`
        );
        return;
    }

    // Convert {n}/{r}/{f} to \n/\r/\f escape sequences
    const escapedText = convertToEscapeSequences(rawMessage);

    // Replace ASCII apostrophes with smart quotes (grammar doesn't support ' inside '...')
    const safeText = escapedText.replace(/'/g, '\u2019');

    // Build the new macro line
    let newLine = `${indent}_MACRO_MSG('${typeName}', '${fileName}', '${labelName}', '${safeText}'`;
    if (trailingArgs) {
        newLine += trailingArgs;
    }
    newLine += ')';

    // Replace the line
    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, newLine);
    });

    DataManager.log(`Converted ${command} to _MACRO_MSG('${typeName}', ...) at line ${line.lineNumber + 1}`);
}
