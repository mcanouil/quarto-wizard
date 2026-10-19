# Write with Extensions

Quarto Wizard helps you write with the extensions that you installed.

## Insert Snippets

1. Expand an extension in the Explorer View.
2. Expand its **Snippets** node.
3. Select a snippet to insert it at the cursor of the active editor.

Hover over a snippet to see its description and a preview.
If no editor is open, Quarto Wizard asks you to open a file first.

[Open Explorer View](command:workbench.view.extension.quarto-wizard-explorer)

## Preview Typst Blocks

1. Put the cursor inside a Typst block.
2. Run **"Quarto Wizard: Preview Typst Block"**, or select the code lens above the block.
3. Edit the block.
   The preview follows the cursor and compiles again after each edit.

[Preview Typst Block](command:quartoWizard.previewTypstBlock)

The preview needs the Quarto extension for VS Code, because it uses the Typst binary that ships inside Quarto.

[Snippets guide](https://m.canouil.dev/quarto-wizard/getting-started/explorer-view.html#schema-and-snippet-nodes) | [Typst preview guide](https://m.canouil.dev/quarto-wizard/getting-started/typst-preview.html)
