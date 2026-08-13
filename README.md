# ide-json

JSON and JSON-with-comments language-server adapter.

Registers the JSON server from [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) with the bundled `ide-client` package, providing schema-aware completion, validation, documentation, navigation, source actions, colors, folding, selection ranges, and formatting.

## Features

- **Bundled server**: ships an exact server version, with an optional custom executable path.
- **Managed upgrade**: installs a newer server from npm when you want one, and removing it returns to the bundled copy.
- **JSON Schema**: associates local, remote, or inline schemas with file patterns.
- **Validation**: reports JSON/JSONC syntax and schema problems through LSP pull diagnostics.
- **Editing intelligence**: offers schema-backed completion and hover documentation.
- **Document tools**: provides symbols, outline data, schema links, colors, folding, selection ranges, sorting, and formatting.
- **Feature switches**: each editor-facing capability can be handed to another language server serving the same file.
- **Project sessions**: one server per project root, started lazily with the first JSON or JSONC editor.

## Installation

To install `ide-json` search for _ide-json_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/ide-json`.

## Services

- **ide-client** (`^1.0.0`): consumed to register the JSON adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
