// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

function formatDateTime(d: Date) {
    let month = '' + (d.getUTCMonth() + 1); // getUTCMonth returns months from 0-11
    let day = '' + d.getUTCDate();
    let year = d.getUTCFullYear();
    let hour = '' + d.getUTCHours();
    let minute = '' + d.getUTCMinutes();

    // Pad with zeros if necessary
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    hour = hour.padStart(2, '0');
    minute = minute.padStart(2, '0');

    return `${month}/${day}/${year} ${hour}:${minute}, GMT+0`;
}

async function loadCompany(url: any) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Network response was not ok ' + response.statusText);
        }

        const company = await response.json();
        return {
            success: true,
            data: {
                company,
                remoteTime: formatDateTime(new Date(response.headers.get("Last-Modified")!)),
                localTime: formatDateTime(new Date()),
            }
        }
    } catch (error) {
        return { 
            success: false,
            msg: 'There has been a problem with your fetch operation' 
        }
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, Dynamo Tools extension is now active!');

    if (!context.globalState.get("CompanyLibraries")) {
        context.globalState.update("CompanyLibraries", [])
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

    const disposable = vscode.commands.registerCommand('dt.settings', () => {
        const panel = vscode.window.createWebviewPanel(
            'dataTable',  // Identifies the type of the webview used
            'Company libraries', // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            { enableScripts: true } // Webview options.
        );

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'load_company':
                        // check the global state
                        let companyList:any = context.globalState.get("CompanyLibraries")
                        const index = companyList.findIndex((elem:any) => {
                            return elem.company.cc === message.companyCode;
                        });

                        if (index >= 0) { // already exist
                            panel.webview.postMessage({
                                command: 'addCompanyCode',
                                msg: `Company code ${message.companyCode} is already exist.`,
                                status: 'error'
                            });

                            return;
                        } else {
                            const data:any = await loadCompany(message.url);
                            if (!data.success) {
                                panel.webview.postMessage({
                                    command: 'addCompanyCode',
                                    msg: `Company code ${message.companyCode} is not exist.`,
                                    status: 'error'
                                });
    
                                return;
                            }
                            
                            companyList.push(data.data)
                            context.globalState.update("CompanyLibraries", companyList)

                            // Send the data back to the WebView
                            panel.webview.postMessage({
                                command: 'addCompanyCode',
                                data: data.data,
                                msg: `Company code ${message.companyCode} is added`,
                                status: 'success'
                            });
                        }

                        break;
                }
            },
            undefined,
            context.subscriptions
        );

        panel.webview.html = getHtmlForWebview(context.globalState.get("CompanyLibraries"));
    });

    context.subscriptions.push(disposable);
}

function getHtmlForWebview(CompanyLibraries:any) {
    let tblContent = ""

    for (let index = 0; index < CompanyLibraries.length; index++) {
        const elem = CompanyLibraries[index];
        
        tblContent += `<tr>
            <th scope="row">${elem.company.cc}</th>
            <td>${elem.company.desc}</td>
            <td>${elem.localTime}</td>
            <td>${elem.remoteTime}</td>
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-danger btn-sm btn-company-remove"><i class="fas fa-trash-alt"></i></button>
                </div>
            </td>
        </tr>`
    }

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
            <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script>
            <title>Company libraries</title>
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

                @-webkit-keyframes fadein {
                    from {opacity: 0;}
                    to {opacity: 1;}
                }

                @keyframes fadein {
                    from {opacity: 0;}
                    to {opacity: 1;}
                }

                @-webkit-keyframes fadeout {
                    from {opacity: 1;}
                    to {opacity: 0;}
                }

                @keyframes fadeout {
                    from {opacity: 1;}
                    to {opacity: 0;}
                }
            </style>
        </head>
        <body class="bg-dark">
            <div id="toast">This is a toast message!</div>
            <div class="container">
                <div class="row">
                    <div class="d-flex flex-row-reverse mt-5">
                        <div>
                            <button type="button" class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#companyCodeAddModal">
                                Add <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <div>
                        <table class="table table-dark table-company-library">
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

                <!-- Modal -->
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
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
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
                    setTimeout(function() { 
                        toastElement.className = toastElement.className.replace("show", ""); 
                    }, 3000);
                }

                $(function () {
                    const vscode = acquireVsCodeApi();

                    window.addEventListener('message', event => {
                        const message = event.data; // The JSON data from the extension

                        switch (message.command) {
                            case 'addCompanyCode':
                                if (message.data) {
                                    // Handle the data, e.g., display it in the WebView

                                    const row = '<tr><th scope="row">'+message.data.company.cc+'</th><td>'+message.data.company.desc+'</td><td>'+message.data.localTime+'</td><td>'+message.data.remoteTime+'</td><td><div class="btn-group" role="group"><button class="btn btn-danger btn-sm btn-company-remove"><i class="fas fa-trash-alt"></i></button></div></td></tr>';

                                    // Append the new row to the table
                                    $('.table-company-library tbody').append(row);

                                    $("#companyCodeAddModal").modal('hide');
                                }

                                showToast(message.msg, message.status);
                                break;
                        }
                    });

                    $('#btn-company-load').click(async function () {
                        var companyCode = $('#input-company-code').val().toUpperCase();
                        var url = 'https://dl.excellware.com/plugins/'+companyCode+'.json';

                        vscode.postMessage({
                            command: 'load_company',
                            companyCode: companyCode,
                            url: url
                        });
                    })
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