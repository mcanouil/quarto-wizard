// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Code annotation helpers for Typst output

// ============================================================================
// Code annotation functions
// ============================================================================

/// Render a circled annotation number using brand colours.
/// @param n Annotation number to display
/// @param colours Colour dictionary (must contain foreground key)
/// @return Inline box with circled number
#let circled-number(n, colours) = {
  box(baseline: 15%, circle(
    radius: 0.55em,
    stroke: 0.5pt + colours.foreground,
  )[#set text(size: 0.7em); #align(center + horizon, str(n))])
}

/// Wrap a raw code block with annotation markers overlaid at the right edge
/// of specified lines.
/// @param code Raw code block content
/// @param annotations Dictionary mapping annotation numbers to line numbers
/// @param colours Colour dictionary
/// @return Block with code and overlaid annotation markers
#let annotated-code(annotations, colours, code) = {
  show raw.line: it => {
    // Check whether this line has an annotation
    // Keys are strings ("1", "2", ...), values are line numbers (int)
    let annote-num = none
    for (num-str, line-num) in annotations {
      if it.number == line-num {
        annote-num = int(num-str)
      }
    }
    if annote-num != none {
      // Line with annotation marker right-aligned, preserving natural line spacing
      box(width: 100%)[
        #it
        #h(1fr)
        #circled-number(annote-num, colours)
      ]
    } else {
      it
    }
  }
  code
}

/// Render a single annotation list item with circled number inline.
/// @param n Annotation number
/// @param content Description content
/// @param colours Colour dictionary
/// @return Block with circled number and description on the same line
#let annotation-item(n, content, colours) = {
  block(above: 0.4em, below: 0.4em)[
    #circled-number(n, colours)
    #h(0.4em)
    #content
  ]
}
