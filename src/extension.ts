import * as vscode from 'vscode';
import { getRemoteCompanyTimestamp, loadCompany } from './utils';

function getFieldsByDdname(companyList: any, ddname: any) {
    for (const elem of companyList) {
        for (const dd of elem.company.dd) {
            if (dd.ddname == ddname) {
                return dd.field;
            }
        }
    }
    return null;
}

function getStaticMethodsByClass(companyList: any, className: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const elem of companyList) {
        const list: any[] = elem?.company?.staticmethods || [];
        for (const sig of list) {
            if (typeof sig !== 'string') continue;
            if (!sig.startsWith(className + '.')) continue;
            if (seen.has(sig)) continue;
            seen.add(sig);
            out.push(sig);
        }
    }
    return out;
}

function buildArgSnippetFromSignature(signature: string): vscode.SnippetString {
    // signature example: "DT.addS(BBjNumber count, BBjString word$)"
    const parenOpen = signature.indexOf('(');
    const parenClose = signature.lastIndexOf(')');
    if (parenOpen < 0 || parenClose < parenOpen) {
        return new vscode.SnippetString('');
    }
    const inside = signature.substring(parenOpen + 1, parenClose).trim();
    if (!inside) return new vscode.SnippetString('');

    // Split on commas at top-level (signatures here are simple, no generics).
    const parts = inside.split(',').map(s => s.trim()).filter(Boolean);
    const names: string[] = [];
    for (const p of parts) {
        // Parameter is typically: "Type name" where name may end with $ or !
        const m = p.match(/\b([A-Za-z_][A-Za-z0-9_]*[\$!%]?)\s*$/);
        names.push(m ? m[1] : p);
    }
    const snippet = new vscode.SnippetString();
    names.forEach((n, i) => {
        if (i > 0) snippet.appendText(', ');
        snippet.appendPlaceholder(n);
    });
    return snippet;
}

function getProgramNames(companyList: any) {
    let programs: any = [];
    for (const elem of companyList) {
        for (const cp of elem.company.cp) {
            // const temp = cp.args;
            programs.push({
                pgm: cp.pgm,
                title: cp.title
            });
        }
    }

    return programs;
}

function getProgramArgs(companyList: any, pgm: any) {
    for (const elem of companyList) {
        for (const cp of elem.company.cp) {
            if (cp.pgm == pgm) {
                return cp.args;
            }
        }
    }
}

function getClasses(companyList: any) {
    // Company libraries can overlap; avoid showing duplicate class names (e.g. after typing `new `).
    // Preserve the configured company search order by keeping the first occurrence.
    const seen = new Set<string>();
    const classes: any[] = [];

    for (const elem of companyList) {
        const list = elem?.company?.classes || [];
        for (const c of list) {
            const name = c?.classname;
            if (!name) continue;
            if (seen.has(name)) continue;
            seen.add(name);
            classes.push(c);
        }
    }

    return classes;
}

function getConstructors(companyList: any, classname: any) {
    for (const elem of companyList) {
        for (const e of elem.company.classes) {
            if (e.classname == classname) {
                return e.constructors;
            }
        }
    }
    return [];
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, Dynamo Tools extension is now active!');
    const output = vscode.window.createOutputChannel('Dynamo Tools');
    context.subscriptions.push(output);

    if (!context.globalState.get("CompanyLibraries")) {
        context.globalState.update("CompanyLibraries", []);
    }

    let companyList: any = context.globalState.get("CompanyLibraries");
    // Track the settings panel if open so other commands can refresh it.
    let settingsPanel: vscode.WebviewPanel | undefined;

    function getCompanySourceUrl(entry: any): string {
        return entry?.sourceUrl || `https://dl.excellware.com/plugins/${entry?.company?.cc}.json`;
    }

    function normalizeCompanyEntry(entry: any) {
        // Backward compatible: older saved entries won't have ms/url fields.
        if (!entry) return entry;
        if (!entry.sourceUrl) entry.sourceUrl = getCompanySourceUrl(entry);
        if (typeof entry.localMs !== 'number') entry.localMs = Date.now();
        if (typeof entry.localRemoteMs !== 'number' && entry.localRemoteMs !== null) entry.localRemoteMs = entry.remoteMs ?? null;
        if (typeof entry.remoteMs !== 'number' && entry.remoteMs !== null) entry.remoteMs = null;
        return entry;
    }

    async function refreshRemoteTimestamps(): Promise<{ success: boolean; msg: string; updated?: any[] }> {
        companyList = (context.globalState.get('CompanyLibraries') as any[]) || [];
        companyList = companyList.map(normalizeCompanyEntry);

        if (companyList.length === 0) {
            return { success: true, msg: 'No company libraries configured.' };
        }

        output.appendLine(`[${new Date().toISOString()}] Refreshing remote timestamps for ${companyList.length} company libraries...`);

        for (const entry of companyList) {
            const url = getCompanySourceUrl(entry);
            const cc = entry?.company?.cc || 'Unknown';
            const res: any = await getRemoteCompanyTimestamp(url);
            if (res.success) {
                entry.remoteTime = res.remoteTime;
                entry.remoteMs = res.remoteMs;
                output.appendLine(`  ${cc}: remote=${entry.remoteTime}`);
            } else {
                output.appendLine(`  ${cc}: failed to refresh remote timestamp`);
            }
        }

        await context.globalState.update('CompanyLibraries', companyList);
        return { success: true, msg: 'Remote timestamps refreshed.', updated: companyList };
    }

    async function downloadUpdates(force = false): Promise<{ success: boolean; msg: string; updated?: any[] }> {
        // Always refresh remote timestamps first so we can compare.
        const refreshed = await refreshRemoteTimestamps();
        if (!refreshed.success) return refreshed;
        companyList = refreshed.updated || companyList;

        let updatedCount = 0;
        for (let i = 0; i < companyList.length; i++) {
            const entry = normalizeCompanyEntry(companyList[i]);
            const cc = entry?.company?.cc || 'Unknown';

            const needsUpdate = force ||
                (typeof entry.remoteMs === 'number' && entry.remoteMs !== null &&
                    (typeof entry.localRemoteMs !== 'number' || entry.localRemoteMs === null || entry.remoteMs > entry.localRemoteMs));

            if (!needsUpdate) {
                output.appendLine(`  ${cc}: up to date`);
                continue;
            }

            const url = getCompanySourceUrl(entry);
            output.appendLine(`  ${cc}: downloading ${url}`);
            const data: any = await loadCompany(url);
            if (data.success) {
                // Keep ordering but replace the stored entry.
                companyList[i] = data.data;
                updatedCount++;
                output.appendLine(`  ${cc}: updated`);
            } else {
                output.appendLine(`  ${cc}: download failed`);
            }
        }

        await context.globalState.update('CompanyLibraries', companyList);
        return {
            success: true,
            msg: updatedCount === 0 ? 'All company libraries are already up to date.' : `Updated ${updatedCount} company librar${updatedCount === 1 ? 'y' : 'ies'}.`,
            updated: companyList
        };
    }
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json

    // const disposable = vscode.commands.registerCommand('dt.helloWorld', () => {
    // 	// The code you place here will be executed every time your command is executed
    // 	// Display a message box to the user
    // 	vscode.window.showInformationMessage('Hello World from Dynamo Tools!');
    // });

    // const disposable = vscode.workspace.onDidChangeConfiguration(e => {
    //     if (e.affectsConfiguration('dt.enable')) {
    //         let isEnabled = vscode.workspace.getConfiguration('dt').get('enable');
    //         vscode.window.showInformationMessage(`DT is now ${isEnabled ? 'enabled' : 'disabled'}.`);
    //     }
    // });

    const openSettings = () => {
        // Re-read company list each time the panel opens, to reflect changes made by other commands.
        companyList = (context.globalState.get('CompanyLibraries') as any[]) || [];
        companyList = companyList.map(normalizeCompanyEntry);

        const panel = vscode.window.createWebviewPanel(
            'dataTable',  // Identifies the type of the webview used
            'Company Libraries', // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            { enableScripts: true } // Webview options.
        );

        settingsPanel = panel;
        panel.onDidDispose(() => {
            if (settingsPanel === panel) settingsPanel = undefined;
        });

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async message => {
                // check the global state
                switch (message.command) {
                    case 'add_company':
                        if (companyList.findIndex((elem: any) => elem.company.cc === message.companyCode) >= 0) {
                            panel.webview.postMessage({
                                command: 'add_company',
                                msg: `Company code ${message.companyCode} is already exist.`,
                                status: 'error'
                            });
                            return;
                        }

                        const data: any = await loadCompany(message.url);
                        if (!data.success) {
                            panel.webview.postMessage({
                                command: 'add_company',
                                msg: `Company code ${message.companyCode} is not exist.`,
                                status: 'error'
                            });
                            return;
                        }

                        companyList.push(normalizeCompanyEntry(data.data));
                        context.globalState.update("CompanyLibraries", companyList);
                        panel.webview.postMessage({
                            command: 'add_company',
                            data: data.data,
                            msg: `Company code ${message.companyCode} is added`,
                            status: 'success'
                        });
                        break;
                    case 'remove_company':
                        let index = companyList.findIndex((elem: any) => elem.company.cc === message.companyCode);
                        if (index >= 0) {
                            companyList.splice(index, 1); // Remove the company from the list
                            context.globalState.update("CompanyLibraries", companyList);
                            panel.webview.postMessage({
                                command: 'remove_company',
                                data: message.companyCode,
                                msg: `Company code ${message.companyCode} is removed.`,
                                status: 'success'
                            });
                        }
                        break;
                    case 'set_order': {
                        // Persist company ordering from the webview.
                        const order: string[] = Array.isArray(message.order) ? message.order : [];
                        if (order.length === 0) return;

                        const byCc = new Map<string, any>();
                        for (const entry of companyList) {
                            if (entry?.company?.cc) byCc.set(entry.company.cc, entry);
                        }
                        const newList: any[] = [];
                        for (const cc of order) {
                            const entry = byCc.get(cc);
                            if (entry) newList.push(entry);
                        }
                        // Append any missing entries (shouldn't happen, but keeps us safe).
                        for (const entry of companyList) {
                            if (!newList.includes(entry)) newList.push(entry);
                        }
                        companyList = newList;
                        await context.globalState.update('CompanyLibraries', companyList);
                        break;
                    }
                    case 'refresh_remote': {
                        const res = await refreshRemoteTimestamps();
                        panel.webview.postMessage({
                            command: 'refresh_all',
                            data: res.updated || companyList,
                            msg: res.msg,
                            status: res.success ? 'success' : 'error'
                        });
                        break;
                    }
                    case 'download_updates': {
                        const res = await downloadUpdates(false);
                        panel.webview.postMessage({
                            command: 'refresh_all',
                            data: res.updated || companyList,
                            msg: res.msg,
                            status: res.success ? 'success' : 'error'
                        });
                        break;
                    }
                }
            },
            undefined,
            context.subscriptions
        );

        panel.webview.html = getHtmlForWebview(companyList);
    };

    const disposable = vscode.commands.registerCommand('dt.settings', openSettings);

    // Alias commands that are easier to discover.
    const disposableOpen = vscode.commands.registerCommand('dt.openCompanyLibraries', openSettings);

    const disposableCheck = vscode.commands.registerCommand('dt.checkCompanyLibraryUpdates', async () => {
        const res = await refreshRemoteTimestamps();
        vscode.window.showInformationMessage(res.msg);
        if (settingsPanel) {
            settingsPanel.webview.postMessage({
                command: 'refresh_all',
                data: res.updated || companyList,
                msg: res.msg,
                status: res.success ? 'success' : 'error'
            });
        }
    });

    const disposableDownload = vscode.commands.registerCommand('dt.downloadCompanyLibraryUpdates', async () => {
        const res = await downloadUpdates(false);
        vscode.window.showInformationMessage(res.msg);
        if (settingsPanel) {
            settingsPanel.webview.postMessage({
                command: 'refresh_all',
                data: res.updated || companyList,
                msg: res.msg,
                status: res.success ? 'success' : 'error'
            });
        }
    });

    // const provider1 = vscode.languages.registerCompletionItemProvider('plaintext', {

    //     provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {

    //         // a simple completion item which inserts `Hello World!`
    //         const simpleCompletion = new vscode.CompletionItem('Hello World!');

    //         // a completion item that inserts its text as snippet,
    //         // the `insertText`-property is a `SnippetString` which will be
    //         // honored by the editor.
    //         const snippetCompletion = new vscode.CompletionItem('Good part of the day');
    //         snippetCompletion.insertText = new vscode.SnippetString('Good ${1|morning,afternoon,evening|}. It is ${1}, right?');
    //         const docs: any = new vscode.MarkdownString("Inserts a snippet that lets you select [link](x.ts).");
    //         snippetCompletion.documentation = docs;
    //         docs.baseUri = vscode.Uri.parse('http://example.com/a/b/c/');

    // a completion item that can be accepted by a commit character,
    // the `commitCharacters`-property is set which means that the completion will
    // be inserted and then the character will be typed.
    // const commitCharacterCompletion = new vscode.CompletionItem('console');
    // commitCharacterCompletion.commitCharacters = ['.'];
    // commitCharacterCompletion.documentation = new vscode.MarkdownString('Press `.` to get `console.`');

    //         // a completion item that retriggers IntelliSense when being accepted,
    //         // the `command`-property is set which the editor will execute after 
    //         // completion has been inserted. Also, the `insertText` is set so that 
    //         // a space is inserted after `new`
    //         const commandCompletion = new vscode.CompletionItem('new');
    //         commandCompletion.kind = vscode.CompletionItemKind.Keyword;
    //         commandCompletion.insertText = 'new ';
    //         commandCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };

    //         // return all completion items as array
    //         return [
    //             simpleCompletion,
    //             snippetCompletion,
    //             commitCharacterCompletion,
    //             commandCompletion
    //         ];
    //     }
    // });

    const labelProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext', 'bbj'],
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                // Only offer label completion in known "line label argument" contexts.
                const linePrefix = document.lineAt(position).text.substring(0, position.character);

                // Verbs that take labels: goto, gosub, on goto, on gosub.
                const verbContext = /\b(on\s+)?(goto|gosub)\s+[^]*$/i.test(linePrefix);

                // Clauses that take labels: err=, end=, dom=, tbl=
                const clauseContext = /\b(err|end|dom|tbl)\s*=\s*[^]*$/i.test(linePrefix);

                if (!verbContext && !clauseContext) {
                    return undefined;
                }

                // Symbolic labels in required order.
                const symbolicLineLabels = [
                    "*next",
                    "*break",
                    "*continue",
                    "*return",
                    "*exit",
                    "*proceed",
                    "*same",
                    "*retry",
                    "*escape",
                    "*stop",
                    "*end",
                    "*endif",
                ];

                const normalize = (s: string) => s.trim().toLowerCase();
                const seen = new Set<string>();

                const mkItem = (label: string, sortText: string) => {
                    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
                    item.insertText = label;
                    item.sortText = sortText;
                    item.filterText = label;
                    return item;
                };

                const items: vscode.CompletionItem[] = [];

                // Add symbolic first.
                symbolicLineLabels.forEach((lbl, idx) => {
                    const key = normalize(lbl);
                    if (seen.has(key)) return;
                    seen.add(key);
                    items.push(mkItem(lbl, `0${String(idx).padStart(2, '0')}`));
                });

                // Helper to find method bounds that contain the cursor.
                const isMethod = (text: string) => /^\s*method\b/i.test(text);
                const isMethodEnd = (text: string) => /^\s*methodend\b/i.test(text);

                let inMethod = false;
                let methodStartLine = -1;

                // Scan from top to cursor line to determine whether cursor is inside a method.
                for (let i = 0; i <= position.line; i++) {
                    const t = document.lineAt(i).text;
                    if (isMethod(t)) {
                        inMethod = true;
                        methodStartLine = i;
                        continue;
                    }
                    if (isMethodEnd(t)) {
                        inMethod = false;
                        methodStartLine = -1;
                        continue;
                    }
                }

                let scanStart = 0;
                let scanEnd = document.lineCount - 1;

                if (inMethod && methodStartLine >= 0) {
                    // Find the matching methodend after the cursor line.
                    let methodEndLine = document.lineCount - 1;
                    for (let i = position.line; i < document.lineCount; i++) {
                        const t = document.lineAt(i).text;
                        if (isMethodEnd(t)) {
                            methodEndLine = i;
                            break;
                        }
                    }
                    // Only scan lines inside method body (exclusive of method/methodend lines).
                    scanStart = Math.min(methodStartLine + 1, document.lineCount - 1);
                    scanEnd = Math.max(methodEndLine - 1, scanStart);
                }

                // Extract line labels: first non-blank token ending with ":" (e.g. log:)
                const labelRe = /^\s*([A-Za-z_][A-Za-z0-9_!]*)\s*:\s*/;

                for (let i = scanStart; i <= scanEnd; i++) {
                    const lineText = document.lineAt(i).text;
                    const m = lineText.match(labelRe);
                    if (!m) continue;

                    const lbl = m[1];
                    const key = normalize(lbl);
                    if (seen.has(key)) continue;

                    seen.add(key);
                    // Keep program labels after symbolic ones, in file order.
                    items.push(mkItem(lbl, `1${String(i).padStart(6, '0')}`));
                }

                return items;
            }
        },
        ' ',
        '=',
        ','
    );


    const checkProgramNameProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext', 'bbj'],
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                if (!linePrefix.endsWith('call ')) {
                    return undefined;
                }

                const programs = getProgramNames(companyList);
                if (!programs) {
                    return undefined;
                }

                const items: vscode.CompletionItem[] = [];

                // Helper to build insertion text (handles ::label case)
                const buildInsertText = (programName: string, argsOpt: string): string => {
                    let cleanedArgsText = String(argsOpt || '').trim();

                    // Remove leading comma
                    if (cleanedArgsText.startsWith(',')) {
                        cleanedArgsText = cleanedArgsText.substring(1);
                    }

                    const argsArray = cleanedArgsText.length
                        ? cleanedArgsText.split(',').map(a => a.trim())
                        : [];

                    let finalProgramName = programName;
                    let finalArgs = argsArray;

                    // Fold ::label into program name
                    if (argsArray.length > 0 && argsArray[0].startsWith('::')) {
                        let label = argsArray[0];
                        if (label.endsWith('"')) {
                            label = label.substring(0, label.length - 1);
                        }
                        finalProgramName = programName + label;
                        finalArgs = argsArray.slice(1);
                    }

                    if (finalArgs.length > 0) {
                        return `"${finalProgramName}", ${finalArgs.join(', ')}`;
                    } else {
                        return `"${finalProgramName}"`;
                    }
                };

                for (const elem of programs) {
                    const argsOptions: any[] = (getProgramArgs(companyList, elem.pgm) as any) || [];

                    // No args → single item
                    if (argsOptions.length === 0) {
                        const item = new vscode.CompletionItem(elem.pgm, vscode.CompletionItemKind.Function);
                        item.detail = elem.title || '';
                        item.insertText = `"${elem.pgm}"`;
                        item.filterText = `${elem.pgm} ${elem.title || ''}`;
                        items.push(item);
                        continue;
                    }

                    // Multiple arg options → Option 1, Option 2, ...
                    argsOptions.forEach((opt, idx) => {
                        // Build a display-friendly argument string (no leading comma)
                        const rawArgs = String(opt || '').trim().replace(/^,/, '').trim();
                        const displayArgs = rawArgs
                            ? rawArgs
                                .split(',')
                                .map(a => a.trim().replace(/"$/, ''))
                                .join(', ')
                            : '';

                        const item = new vscode.CompletionItem(
                            elem.pgm,
                            vscode.CompletionItemKind.Function
                        );

                        // Rich popup label: program name + args
                        (item as any).label = {
                            label: elem.pgm,
                            description: displayArgs
                        };

                        item.detail = elem.title || '';
                        item.filterText = `${elem.pgm} ${elem.title || ''} ${displayArgs}`;
                        item.insertText = buildInsertText(elem.pgm, String(opt));

                        items.push(item);

                    });
                }

                return items;
            }
        },
        ' '
    );


    const checkProgramArgProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext', 'bbj'],
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                // Provide argument list *options* for a callable program after: call "PGM"
                // This is used for inserting the full argument list (e.g. , arg1, arg2) when the user triggers completion.
                const linePrefix = document.lineAt(position).text.substring(0, position.character);

                // Match:
                //   call "PGM"
                //   call "PGM",
                //   call "PGM",
                const m = linePrefix.match(/\bcall\s+"(\w+)"\s*,?\s*$/i);
                if (!m) return undefined;

                const pgm = m[1];
                const args = getProgramArgs(companyList, pgm);
                if (!args || !Array.isArray(args) || args.length === 0) return undefined;

                const hasComma = /\bcall\s+"\w+"\s*,\s*$/i.test(linePrefix);

                return args.map((opt: string, idx: number) => {
                    const normalized = (opt || '').split(',').map(s => s.trim()).filter(Boolean).join(', ');
                    const label: vscode.CompletionItemLabel = {
                        label: args.length > 1 ? `Option ${idx + 1}` : 'Arguments',
                        description: normalized
                    };

                    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
                    item.detail = 'Callable program arguments';
                    item.documentation = new vscode.MarkdownString(normalized || opt);

                    // Insert the argument list. If the call already ends with a comma, don't add another.
                    item.insertText = hasComma ? `${normalized}` : `, ${normalized}`;
                    return item;
                });
            },
        },
    );

    // Parameter hints for callable programs:
    // Show argument signatures (including multiple options) when the user invokes Ctrl+Shift+Space.
    const callableSignatureProvider = vscode.languages.registerSignatureHelpProvider(
        ['plaintext', 'bbj'],
        {
            provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position): vscode.SignatureHelp | undefined {
                const lineText = document.lineAt(position).text;
                const beforeCursor = lineText.substring(0, position.character);

                const m = beforeCursor.match(/\bcall\s+"(\w+)"/i);
                if (!m) return undefined;

                const pgm = m[1];
                const args = getProgramArgs(companyList, pgm);
                if (!args || !Array.isArray(args) || args.length === 0) return undefined;

                // Count commas after the program name to determine the active parameter.
                const afterProgram = beforeCursor.split(`"${pgm}"`)[1] || '';
                const commaCount = (afterProgram.match(/,/g) || []).length;
                const activeParam = Math.max(0, commaCount - 1); // first comma introduces param 0

                const sigHelp = new vscode.SignatureHelp();
                sigHelp.activeSignature = 0;
                sigHelp.activeParameter = activeParam;

                sigHelp.signatures = args.map((opt: string) => {
                    const normalized = (opt || '').split(',').map(s => s.trim()).filter(Boolean);
                    const label = `call "${pgm}", ${normalized.join(', ')}`;

                    const sig = new vscode.SignatureInformation(label);
                    sig.parameters = normalized.map(p => new vscode.ParameterInformation(p));
                    return sig;
                });

                return sigHelp;
            }
        },
        ',', ' '
    );

    const dataProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext', 'bbj'],
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                const lastWordMatch = linePrefix.match(/(\w+)\.$/);

                if (!lastWordMatch) {
                    return undefined;
                }

                const qualifier = lastWordMatch[1];

                // 1) DDName.field completion (case-insensitive DDName; field case matches typed DDName)
                const fields = getFieldsByDdname(companyList, qualifier.toUpperCase());
                if (fields && fields.length > 0) {
                    return fields.map((field: any) => {
                        const [name, type, description] = field.split(':');
                        const item = new vscode.CompletionItem('', vscode.CompletionItemKind.Field);

                        const params = name.match(/(\w+)\$?(\[(\d+)\])?/);

                        if (type[0].toUpperCase() === 'U') {
                            if (qualifier === qualifier.toUpperCase()) {
                                item.label = `${params[1]}%${params[2] ? params[2] : ''}`.toUpperCase();
                            } else {
                                item.label = `${params[1]}%${params[2] ? params[2] : ''}`.toLowerCase();
                            }
                        } else {
                            if (qualifier === qualifier.toUpperCase()) {
                                item.label = `${name.toUpperCase()}`;
                            } else {
                                item.label = `${name.toLowerCase()}`;
                            }
                        }

                        item.detail = `${description} ${type}`;
                        return item;
                    });
                }

                // 2) Static method completion: ClassName.staticMethod(...)
                // Class and method names are case-sensitive; match the qualifier exactly.
                const staticSigs = getStaticMethodsByClass(companyList, qualifier);
                if (!staticSigs || staticSigs.length === 0) {
                    return undefined;
                }

                // 3) BBj Templated String Object completion: ddname!.
                const templatedMatch = linePrefix.match(/(\w+)!\.$/);
                if (templatedMatch) {
                    const ddNameTyped = templatedMatch[1];
                    const ddNameLookup = ddNameTyped.toUpperCase();
                    const fields = getFieldsByDdname(companyList, ddNameLookup);
                    if (!fields || fields.length === 0) {
                        return undefined;
                    }

                    const items: vscode.CompletionItem[] = [];
                    const upper = ddNameTyped === ddNameTyped.toUpperCase();

                    for (const field of fields) {
                        const [rawName] = field.split(':');

                        const arrayMatch = rawName.match(/\[(\d+)\]/);
                        const maxIndex = arrayMatch ? arrayMatch[1] : undefined;

                        const nameNoArray = rawName.replace(/\[.*\]/, '');
                        const isString = nameNoArray.endsWith('$');
                        const isInteger = nameNoArray.endsWith('%');

                        const baseName = nameNoArray.replace(/[$%]$/, '');
                        const fieldName = upper ? baseName.toUpperCase() : baseName.toLowerCase();

                        const getterName = isString ? 'getFieldAsString' : 'getFieldAsNumber';
                        const valuePlaceholder = isString
                            ? 'string$'
                            : isInteger
                                ? 'integer%'
                                : 'number';

                        // Getter
                        const getter = new vscode.CompletionItem(
                            `${getterName}("${fieldName}"${maxIndex ? ', ' + maxIndex : ''})`,
                            vscode.CompletionItemKind.Method
                        );
                        getter.insertText =
                            `${ddNameTyped}!.${getterName}("${fieldName}"${maxIndex ? ', ' + maxIndex : ''})`;
                        items.push(getter);

                        // Setter
                        const setter = new vscode.CompletionItem(
                            `setFieldValue("${fieldName}"${maxIndex ? ', ' + maxIndex : ''}, ${valuePlaceholder})`,
                            vscode.CompletionItemKind.Method
                        );
                        setter.insertText =
                            `${ddNameTyped}!.setFieldValue("${fieldName}"${maxIndex ? ', ' + maxIndex : ''}, ${valuePlaceholder})`;
                        items.push(setter);
                    }

                    return items;
                }

                return staticSigs.map((sig: string) => {
                    // Example sig: "DT.appendQueryString(BBjString query$, Map map!, Boolean urlEncode!)"
                    const afterDot = sig.substring((qualifier + '.').length);
                    const paren = afterDot.indexOf('(');
                    const methodName = paren >= 0 ? afterDot.substring(0, paren) : afterDot;
                    const paramsText = paren >= 0 ? afterDot.substring(paren) : '';

                    const item = new vscode.CompletionItem(methodName, vscode.CompletionItemKind.Method);
                    // Show signature to the right; keeps search by method name
                    (item as any).label = { label: methodName, description: paramsText };
                    item.detail = sig;

                    // Insert just the method call (dot already typed)
                    item.insertText = afterDot;
                    return item;
                });
            }
        },
        '.'
    );

    const bbjTemplatedStringProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext', 'bbj'],
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                const lastWordMatch = linePrefix.match(/(\w+)!\.$/);

                if (!lastWordMatch) {
                    return undefined;
                }
                const ddname = lastWordMatch[1];
                const fields = getFieldsByDdname(companyList, lastWordMatch[1].toUpperCase());

                if (!fields) {
                    return undefined;
                }

                let items = [];
                for (let i = 0, sortIndex = 0; i < fields.length; i++) {
                    const field = fields[i];
                    const [name, type, description] = field.split(':');

                    const params = name.match(/(\w+)\$?(\[(\d+)\])?/);
                    const param1 = params[1];
                    const param2 = params[3];
                    const methodName = (type[0].toUpperCase() === 'C' || type[0].toUpperCase() === 'O') ? 'getFieldAsString' : 'getFieldAsNumber';

                    let item = new vscode.CompletionItem("", vscode.CompletionItemKind.Field);
                    item.sortText = `${sortIndex}`;
                    sortIndex++;
                    item.label = `${methodName}("${ddname === ddname.toUpperCase() ? param1.toUpperCase() : param1.toLowerCase()}"${param2 ? ', ' + param2 : ''})`;
                    item.detail = `${description} ${type}`; // Type displayed in the detail property
                    items.push(item);

                    item = new vscode.CompletionItem("", vscode.CompletionItemKind.Field);
                    item.sortText = `${sortIndex}`;
                    sortIndex++;

                    item.label = `setFieldValue("${ddname === ddname.toUpperCase() ? param1.toUpperCase() : param1.toLowerCase()}"${param2 ? ', ' + param2 : ''}, ${(type[0].toUpperCase() === 'C' || type[0].toUpperCase() === 'O') ? 'value$' : (type[0].toUpperCase() === 'U' || type[0].toUpperCase() === 'I') ? 'value%' : 'value'})`;

                    item.detail = `${description} ${type}`; // Type displayed in the detail property

                    items.push(item);
                }

                return items;
            }
        },
        '.'
    );

    const classProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext', 'bbj'],
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                // Check if the user has typed "new "
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                if (!linePrefix.endsWith('new ')) {
                    return undefined;
                }

                const classes = getClasses(companyList);

                if (!classes) {
                    return undefined;
                }

                // Return specific suggestions for "new "
                return classes.map((elem: any) => {
                    const item = new vscode.CompletionItem(elem.classname, vscode.CompletionItemKind.Field);
                    return item;
                });
            }
        },
        ' '
    );

    const constructorProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext', 'bbj'],
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                // Check if the user has typed "new "
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                const lastWordMatch = linePrefix.match(/new (\w+)\s$/);
                if (!lastWordMatch) {
                    return undefined;
                }

                const constructors = getConstructors(companyList, lastWordMatch[1]);

                return constructors.map((elem: any) => {
                    const item = new vscode.CompletionItem(elem, vscode.CompletionItemKind.Field);
                    // Replace the trailing space with the selected item
                    const range = new vscode.Range(
                        new vscode.Position(position.line, linePrefix.length - 1),
                        new vscode.Position(position.line, linePrefix.length - 1)
                    );
                    item.range = range;
                    return item;

                    // const item = new vscode.CompletionItem(elem, vscode.CompletionItemKind.Field);
                    // return item;
                });
            }
        },
        ' '
    );

    context.subscriptions.push(
        disposable,
        disposableOpen,
        disposableCheck,
        disposableDownload,
        labelProvider,
        checkProgramNameProvider,
        checkProgramArgProvider,
        callableSignatureProvider,
        dataProvider,
        bbjTemplatedStringProvider,
        classProvider,
        constructorProvider
    );
}

function getHtmlForWebview(CompanyLibraries: any) {
    const tblContent = CompanyLibraries.map((elem: any) => `
        <tr class="company-${elem.company.cc}" data-company-code="${elem.company.cc}">
            <th scope="row">${elem.company.cc}</th>
            <td>${elem.company.desc}</td>
            <td>${elem.localTime}</td>
            <td>${elem.remoteTime}</td>
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-danger btn-sm btn-company-remove" data-company-code="${elem.company.cc}"><i class="fas fa-trash-alt"></i></button>
                </div>
            </td>
        </tr>`).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
            <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script>
            <title>Company Libraries</title>
            <style>
                #toast {
                    visibility: hidden;
                    min-width: 250px;
                    background-color: #333;
                    color: #fff;
                    text-align: center;
                    border-radius: 2px;
                    padding: 16px;
                    position: fixed;
                    z-index: 1000;
                    top: 10px;
                    right: 10px;
                    font-size: 17px;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                }

                #toast.show {
                    visibility: visible;
                    -webkit-animation: fadein 0.5s, fadeout 0.5s 2.5s;
                    animation: fadein 0.5s, fadeout 0.5s 2.5s;
                }

                #toast.success { background-color: #28a745; } /* Green */
                #toast.warning { background-color: #ffc107; } /* Yellow */
                #toast.error { background-color: #dc3545; } /* Red */

                @-webkit-keyframes fadein { from {opacity: 0;} to {opacity: 1;} }
                @keyframes fadein { from {opacity: 0;} to {opacity: 1;} }

                @-webkit-keyframes fadeout { from {opacity: 1;} to {opacity: 0;} }
                @keyframes fadeout { from {opacity: 1;} to {opacity: 0;} }
            </style>
        </head>
        <body class="bg-dark">
            <div id="toast"></div>
            <div class="container">
                <div class="row">
                    <div class="d-flex flex-row-reverse mt-5">
                        <div>
                            <button type="button" id="btn-up" class="btn btn-success btn-sm disabled"><i class="fas fa-arrow-up"></i></button>
                            <button type="button" id="btn-down" class="btn btn-success btn-sm disabled"><i class="fas fa-arrow-down"></i></button>
                            <button type="button" id="btn-refresh-remote" class="btn btn-secondary btn-sm">Refresh Remote</button>
                            <button type="button" id="btn-download-updates" class="btn btn-secondary btn-sm">Download Updates</button>
                            <button type="button" class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#companyCodeAddModal">
                                Add <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <div>
                        <table class="table table-hover table-dark table-company-library">
                            <thead>
                                <tr>
                                    <th scope="col">Code</th>
                                    <th scope="col">Name</th>
                                    <th scope="col">Local Version</th>
                                    <th scope="col">Remote Version</th>
                                    <th scope="col"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tblContent}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="modal fade" id="companyCodeAddModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-dialog-centered">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Import new company</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body">
                                <div class="mb-3">
                                    <label class="form-label">Company Code</label>
                                    <input type="text" id="input-company-code" class="form-control">
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-primary" id="btn-company-load">OK</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <script>
                function showToast(message, type) {
                    const toastElement = document.getElementById('toast');
                    toastElement.textContent = message;
                    toastElement.className = 'show ' + type;
                    setTimeout(() => toastElement.className = toastElement.className.replace("show", ""), 3000);
                }

                $(function () {
                    const vscode = acquireVsCodeApi();

                    // UX polish: when the Add modal opens, focus the Company Code input
                    // and allow Enter to submit (same as clicking OK).
                    $('#companyCodeAddModal').on('shown.bs.modal', function () {
                        const $input = $('#input-company-code');
                        $input.trigger('focus');
                        $input.select();
                    });

                    $('#input-company-code').on('keydown', function (e) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            $('#btn-company-load').trigger('click');
                        }
                    });

                    function buildRow(company) {
                        const cc = company.company.cc;
                        return ''
                            + '<tr class="company-' + cc + '" data-company-code="' + cc + '">'
                            +   '<th scope="row">' + cc + '</th>'
                            +   '<td>' + company.company.desc + '</td>'
                            +   '<td>' + (company.localTime || '') + '</td>'
                            +   '<td>' + (company.remoteTime || '') + '</td>'
                            +   '<td>'
                            +     '<div class="btn-group" role="group">'
                            +       '<button class="btn btn-danger btn-sm btn-company-remove" data-company-code="' + cc + '">'
                            +         '<i class="fas fa-trash-alt"></i>'
                            +       '</button>'
                            +     '</div>'
                            +   '</td>'
                            + '</tr>';
                    }

                    function renderTable(libraries) {
                        const rows = (libraries || []).map(buildRow).join('');
                        $('.table-company-library tbody').html(rows);
                        $('.table-company-library tr').removeClass('table-active');
                        updateButtonStates();
                    }

                    function persistOrder() {
                        const order = [];
                        $('.table-company-library tbody tr').each(function() {
                            const cc = $(this).data('company-code');
                            if (cc) order.push(String(cc));
                        });
                        vscode.postMessage({ command: 'set_order', order });
                    }

                    window.addEventListener('message', event => {
                        const message = event.data; // The JSON data from the extension

                        switch (message.command) {
                            case 'add_company':
                                if (message.data) {
                                    $('.table-company-library tbody').append(buildRow(message.data));
                                    $("#companyCodeAddModal").modal('hide');
                                    $('#input-company-code').val('');
                                    persistOrder();
                                    showToast(message.msg, message.status);
                                } else {
                                    showToast(message.msg, message.status);
                                }
                                break;
                            case 'remove_company':
                                $("tr.company-"+message.data).remove();
                                persistOrder();
                                showToast(message.msg, message.status);
                                break;
                            case 'refresh_all':
                                if (Array.isArray(message.data)) {
                                    renderTable(message.data);
                                }
                                showToast(message.msg, message.status);
                                break;
                        }
                    });

                    $('#btn-company-load').click(async function () {
                        var companyCode = $('#input-company-code').val().toUpperCase();
                        vscode.postMessage({
                            command: 'add_company',
                            companyCode,
                            url: \`https://dl.excellware.com/plugins/\${companyCode}.json\`
                        });
                    });
                    
                    $('.table-company-library').on('click', '.btn-company-remove', function() {
                        var companyCode = $(this).data('company-code');

                        vscode.postMessage({
                            command: 'remove_company',
                            companyCode
                        });
                    });

                    $('.table-company-library').on('click', 'tr', function() {
                        $('.table-company-library tr').removeClass('table-active');
                        $(this).toggleClass('table-active');

                        updateButtonStates();
                    });

                    $('#btn-up').click(function() {
                        var selectedRow = $('.table-company-library tr.table-active');
                        selectedRow.prev().before(selectedRow);
                        persistOrder();
                        updateButtonStates();
                    });

                    $('#btn-down').click(function() {
                        var selectedRow = $('.table-company-library tr.table-active');
                        selectedRow.next().after(selectedRow);
                        persistOrder();
                        updateButtonStates();
                    });

                    $('#btn-refresh-remote').click(function() {
                        vscode.postMessage({ command: 'refresh_remote' });
                    });

                    $('#btn-download-updates').click(function() {
                        vscode.postMessage({ command: 'download_updates' });
                    });

                    function updateButtonStates() {
                        var selectedRow = $('.table-company-library tr.table-active');
                        if (selectedRow.length === 0) {
                            $('#btn-up').addClass('disabled');
                            $('#btn-down').addClass('disabled');
                            return;
                        }

                        $('#btn-up').toggleClass('disabled', selectedRow.is(':first-child'));
                        $('#btn-down').toggleClass('disabled', selectedRow.is(':last-child'));
                    }
                });
            </script>
            <script src="https://cdn.jsdelivr.net/npm/@popperjs/core@2.9.2/dist/umd/popper.min.js" integrity="sha384-IQsoLXl5PILFhosVNubq5LC7Qb9DXgDA9i+tQ8Zj3iwWAwPtgFTxbJ8NT4GN1R8p" crossorigin="anonymous"></script>
            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.min.js" integrity="sha384-cVKIPhGWiC2Al4u+LWgxfKTRIcfu0JTxR+EQDz/bgldoEyl4H0zUF0QKbrJ0EcQF" crossorigin="anonymous"></script>
        </body>
        </html>
    `;
}

// This method is called when your extension is deactivated
export function deactivate() { }