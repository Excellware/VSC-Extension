# Dynamo Tools

Dynamo Tools is a Visual Studio Code extension that provides useful tools for BBj developers.

## Features
This extension provides code completion for:
- Templated string variables
- BBj Templated String objects
- Dynamo Tools Custom Object classes and instantiation signatures
- Line labels including symbolic line labels
- Arguments for called routines

## Installation

1. Download and install Visual Studio Code.
2. Go to the Extensions view by clicking the Extensions icon in the Activity Bar on the side of the window or by pressing `Ctrl+Shift+X`.
3. Search for "Dynamo Tools" and click Install.

## Configuration
Dynamo Tools are organized into 2 character company codes.  Each company code has its own data dictionary.  Enter `Ctrl-Shift-P` and select Dynamo Tools to display the Company Libraries configuration page.  Add company `CD` which provides data dictionary for Dynamo Tools.  Add company `DY` if you are also working with the Dynamo ERP package.  Add any of your own company code(s) as well.

## Usage

- The code completion contents are derived from the Dynamo Tools Data Dictionay and from the Dynamo Tools program editor.
- Enable the option to Export your Dynamo Tools Data Dictionary using Company Information Maintenance located on the Development Projects view.  This option should only be enabled on the one server where the master copy of the Data Dictionary is maintained.
- 

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## License

This project is licensed under the MIT License.