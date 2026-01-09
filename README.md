# Dynamo Tools

Dynamo Tools is a Visual Studio Code extension that provides useful tools for BBj developers.

## Features
This extension provides code completion for:
- Templated string variables
- BBj Templated String objects
- Dynamo Tools Custom Object classes, methods, and instantiation signatures
- Line labels including symbolic line labels
- Arguments for called routines

## Installation

Install from the Visual Studio Code Marketplace:

1. Download and install Visual Studio Code.
2. Open VS Code
3. Go to the Extensions view by clicking the Extensions icon in the Activity Bar on the side of the window or by pressing `Ctrl+Shift+X`.
4. Search for "Dynamo Tools"
5. Click Install.

## Configuration
Dynamo Tools are organized into 2 character company codes.  Each company code has its own data dictionary.  Enter `Ctrl-Shift-P` and select Dynamo Tools to display the Company Libraries configuration page.  You can also get to the Company Libraries configuration page by clicking the Gears Icon on the Extension Details page and selecting the Dynamo Tools: Company Libraries option.  Add company `CD` which provides data dictionary for Dynamo Tools.  Add company `DY` if you are also working with the Dynamo ERP package.  Add any of your own company codes as well.

The order that the Company Codes are listed is relevant in that the extension searched in that sequence so your company code should go before Company Codes DY and DS (if needed) so that your custom versions will be used in as opposed to the standard Dynamo version.

## Usage

- The code completion contents are derived from the Dynamo Tools Data Dictionay and from a source code repository.
- Enable the option to Export your Dynamo Tools Data Dictionary using Company Information Maintenance located on the Development Projects view.  This option should only be enabled on the one server where the master copy of the Data Dictionary is maintained.  The Company Library is updated upon exiting Data Dictionary Maintenance.
- String template code completion triggered by DDNAME (Data Dictionary Name) followed by a period, i.e., CM01.  Pasted field name will match the case of the DDNAME.
- BBj Templated String object code completion is triggered by DDNAME followed by !., i.e., cm01!
- Called routine code completion is triggerred by the word 'call' followed by a space.
- Static Method code completion is triggered by class name followed by a period, i.e., DT.
- Line Label code completion is triggered by GOTO, GOSUB, err=, end=, dom=, tbl=, etc.

## Supported Programming Languages

- intended for BBj
- but works with most BBx (pro5/VPro5) programs too

## Release Notes

See CHANGELOG.md for a complete list of changes.

## Support
- Excellware website: https://www.excellware.com
- Dynamo Tools Documentation: https://docs.excellware.com/docs/tools/tools.htm
- Dynamo Overview: https://dynamo11.excellware.com
- Dynamo Documentation: https://docs.excellware.com/docs/dynamo/dynamo.htm
- support@excellware.com

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## License

This project is licensed under the MIT License.