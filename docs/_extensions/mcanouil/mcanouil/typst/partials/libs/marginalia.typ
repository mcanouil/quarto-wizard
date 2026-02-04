// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Marginalia stub functions
// Temporary workaround: These stub functions pass through content unchanged,
// allowing documents to compile whilst full marginalia integration is pending.
//
// TODO: Replace with proper marginalia package integration.
// Quarto's upstream definitions.typ (quarto-cli src/resources/formats/typst/pandoc/quarto/)
// provides full marginalia support when $margin-geometry$ is set, including:
//
// - #import "@preview/marginalia:0.3.1" as marginalia: note, notefigure, wideblock
// - column-sidenote(body): renders footnotes as margin notes using standard footnote counter
// - side-pad(side, left-amount, right-amount): padding helper for margin layouts
// - column-body-outset(side, body): extends ~15% into margin area
// - column-page-inset(side, body): wideblock minus small inset from page boundary
// - column-screen-inset(side, body): full width minus far distance from edges
// - column-screen-inset-shaded(body): screen-inset with grey background
//
// The page.typ partial also needs marginalia.setup configuration:
// - #show: marginalia.setup.with(inner: ..., outer: ..., top: ..., bottom: ..., book: false, clearance: ...)
//
// Both suppress-bibliography (biblio.typ) and margin citations depend on this integration.

#let note(..args, body) = body
#let notefigure(..args, body) = body
#let widenote(..args, body) = body
