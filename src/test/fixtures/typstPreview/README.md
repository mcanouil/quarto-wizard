# Typst preview golden fixtures

These fixtures are recorded output of the `typst-render` filter, not expectations written by hand.
Each `expected.typ` is a file the filter itself wrote through its own `output-source: true` option.
`src/test/suite/typstFixtures.test.ts` compiles the same block through the TypeScript port and compares the two byte for byte, after normalising line endings.

That is what makes them a drift guard.
When the filter changes what it compiles, a refreshed fixture disagrees with the port, and the test names the block that moved.
An expectation written by hand would only ever agree with the port.

## Pinned version

The fixtures were recorded from `mcanouil/quarto-typst-render` version `0.21.0`.
Every `meta.json` repeats that version beside the brand mode of its recording.

`src/providers/typstPreview/typstContext.ts` reads the installed version from the extension's own `_extension.yml` manifest and logs a warning when it is above the pinned one.
That turns silent drift into a log line between refreshes.
The fixture suite checks the same constant against every `meta.json`, so a fixture recorded from another version fails the build rather than making that warning lie.

## What each fixture covers

| Fixture | Dimension |
| --- | --- |
| `bare` | A block with no option at all. |
| `geometry` | `width`, `height` and `margin` on the page directive. |
| `background` | A hex background, which locks the `rgb("...")` wrapping. |
| `foreground` | A foreground, which locks the `#set text(fill: ...)` line and its position. |
| `inherit-none` | A block writing `background: none` over a global colour, which the filter leaves as the bare word. |
| `preamble-string` | An inline preamble. |
| `preamble-list` | A list mixing an inline entry and a `.typ` path, which contributes the blank line the file's own ending carries. |
| `file` | A `file:` option, whose contents replace the block body and keep their trailing line ending. |
| `brand-auto` | `auto` colours against a `_brand.yml` with a palette alias. |
| `brand-dual-light` | The light side of a brand whose two modes differ. |
| `brand-dual-dark` | The dark side of the same brand. |
| `crlf` | The same block written with CRLF line endings. |

## Refresh procedure

Run this whenever the pinned version moves.

1. Make a working directory outside this repository, and copy `_extensions/typst-render` of `mcanouil/quarto-typst-render` into it.
2. Copy the fixture directory into it as well, so its `block.qmd`, its side files and its `_brand.yml` are all in place.
3. Render it: `quarto render block.qmd --to html`.
   The front matter already sets `engine: markdown`, `output-source: true` and an `output-directory` of `./recorded`.
4. Copy the emitted `recorded/block/typst-block-1.typ` over `expected.typ`.
   A document whose colours differ between the two modes emits `typst-block-1-light.typ` and `typst-block-1-dark.typ` instead, one per fixture.
5. Update `extensionVersion` in every `meta.json`.
6. Run `npm run test` and read every difference before accepting it.
   A difference is a change in what the filter compiles, and the port has to follow it.
