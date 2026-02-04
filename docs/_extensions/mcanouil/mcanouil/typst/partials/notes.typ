// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Footnotes and endnotes configuration
// Pandoc template partial for rendering notes section

// ============================================================================
// Notes section
// ============================================================================

$if(notes)$
#v(1em)
#block[
  #horizontalrule
  #set text(size: .88em)
  #v(3pt) // otherwise first note marker is swallowed, bug?

  $notes$
]
$endif$
