// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Pandoc and Quarto compatibility definitions
// Provides functions required by Pandoc's Typst output and Quarto-specific features

// Import shared utilities
// #import "utilities.typ": is-empty, block-with-new-content

// ============================================================================
// Pandoc compatibility
// ============================================================================

/// Horizontal rule for document separators
#let horizontalrule = line(start: (25%, 0%), end: (75%, 0%))

/// Endnote formatting
/// @param num Note number
/// @param contents Note contents
/// @return Formatted endnote
#let endnote(num, contents) = [
  #stack(dir: ltr, spacing: 3pt, super[#num], contents)
]

// ============================================================================
// Quarto code block styling
// ============================================================================

// Note: Code block styling is handled by show rules in typst-template.typ
// using brand-mode aware colour-mix-adaptive() for proper light/dark mode support
// #show raw.where(block: true): set block(
//   fill: luma(230),
//   width: 100%,
//   inset: 8pt,
//   radius: 2pt,
//   stroke: 0.5pt + luma(200),
// )

// ============================================================================
// Upstream Quarto code annotation and filename functions
// These match the signatures from quarto-dev/quarto-cli PR #14170 so that
// the extension does not break when upstream starts emitting calls to them.
// ============================================================================

/// Render a circled annotation number (upstream-compatible signature).
#let quarto-circled-number(n, color: none) = context {
  let c = if color != none { color } else { text.fill }
  box(baseline: 15%, circle(
    radius: 0.55em,
    stroke: 0.5pt + c,
  )[#set text(size: 0.7em, fill: c); #align(center + horizon, str(n))])
}

/// Derive a contrasting annotation colour from a background fill.
/// Light backgrounds get dark circles; dark backgrounds get light circles.
#let quarto-annote-color(bg) = {
  if type(bg) == color {
    let comps = bg.components(alpha: false)
    let lum = if comps.len() == 1 {
      comps.at(0) / 100%
    } else {
      0.2126 * comps.at(0) / 100% + 0.7152 * comps.at(1) / 100% + 0.0722 * comps.at(2) / 100%
    }
    if lum < 0.5 { luma(200) } else { luma(60) }
  } else {
    luma(60)
  }
}

/// Wrap a code block with a filename header tab.
#let quarto-code-filename(filename, body) = {
  show raw.where(block: true): it => it
  block(width: 100%, radius: 2pt, clip: true, stroke: 0.5pt + luma(200))[
    #set block(spacing: 0pt)
    #block(fill: luma(220), width: 100%, inset: (x: 8pt, y: 4pt))[
      #text(size: 0.85em, weight: "bold")[#filename]]
    #body
  ]
}

/// Wrap a code block with annotation markers and bidirectional linking.
#let quarto-code-annotation(annotations, cell-id: "", color: luma(60), body) = {
  let first-lines = (:)
  for (line, num) in annotations {
    let key = str(num)
    if key not in first-lines or int(line) < int(first-lines.at(key)) {
      first-lines.insert(key, str(line))
    }
  }
  show raw.where(block: true): it => it
  show raw.line: it => {
    let annote-num = annotations.at(str(it.number), default: none)
    if annote-num != none {
      if cell-id != "" {
        let lbl = cell-id + "-annote-" + str(annote-num)
        let is-first = first-lines.at(str(annote-num), default: none) == str(it.number)
        if is-first {
          box(width: 100%)[#it #h(1fr) #link(label(lbl))[#quarto-circled-number(annote-num, color: color)] #label(lbl + "-back")]
        } else {
          box(width: 100%)[#it #h(1fr) #link(label(lbl))[#quarto-circled-number(annote-num, color: color)]]
        }
      } else {
        box(width: 100%)[#it #h(1fr) #quarto-circled-number(annote-num, color: color)]
      }
    } else {
      it
    }
  }
  body
}

/// Render a single annotation list item with optional bidirectional linking.
#let quarto-annotation-item(cell-id, n, content) = {
  if cell-id != "" {
    [#block(above: 0.4em, below: 0.4em)[
      #link(label(cell-id + "-annote-" + str(n) + "-back"))[#quarto-circled-number(n)]
      #h(0.4em)
      #content
    ] #label(cell-id + "-annote-" + str(n))]
  } else {
    block(above: 0.4em, below: 0.4em)[
      #quarto-circled-number(n)
      #h(0.4em)
      #content
    ]
  }
}

// ============================================================================
// Quarto helper functions
// ============================================================================

// Re-export utilities for compatibility
#let block_with_new_content = block-with-new-content
#let empty = is-empty

// ============================================================================
// Subfloat support
// ============================================================================
// This is a technique adapted from https://github.com/tingerrr/subpar/

#let quartosubfloatcounter = counter("quartosubfloatcounter")

/// Create a super figure containing subfigures
/// @param kind Figure kind
/// @param caption Super figure caption
/// @param label Super figure label
/// @param supplement Supplement text
/// @param position Caption position
/// @param subrefnumbering Subfigure reference numbering format
/// @param subcapnumbering Subfigure caption numbering format
/// @param body Subfigure content
/// @return Super figure with subfigures
#let quarto_super(
  kind: str,
  caption: none,
  label: none,
  supplement: str,
  position: none,
  subrefnumbering: "1a",
  subcapnumbering: "(a)",
  body,
) = {
  context {
    let figcounter = counter(figure.where(kind: kind))
    let n-super = figcounter.get().first() + 1

    set figure.caption(position: position)
    [#figure(
        kind: kind,
        supplement: supplement,
        caption: caption,
        {
          show figure.where(kind: kind): set figure(numbering: _ => {
            // Use shared subfloat-numbering from numbering.typ
            subfloat-numbering(n-super, quartosubfloatcounter.get().first() + 1)
          })
          show figure.where(kind: kind): set figure.caption(position: position)

          show figure: it => {
            let num = numbering(subcapnumbering, quartosubfloatcounter.get().first() + 1)
            show figure.caption: it => block({
              num
              [ ]
              it.body
            })

            quartosubfloatcounter.step()
            it
            counter(figure.where(kind: it.kind)).update(n => n - 1)
          }

          quartosubfloatcounter.update(0)
          body
        },
      )#label]
  }
}

// ============================================================================
// Callout support
// ============================================================================

/// Callout rendering show rule
/// This is a figure show rule because callouts are crossreferenceable
#show figure: it => {
  if type(it.kind) != str {
    return it
  }
  let kind_match = it.kind.matches(regex("^quarto-callout-(.*)")).at(0, default: none)
  if kind_match == none {
    return it
  }
  let kind = kind_match.captures.at(0, default: "other")
  // Safely capitalise kind (check for empty string)
  if kind.len() > 0 {
    kind = upper(kind.first()) + kind.slice(1)
  }

  // Pull apart the callout structure with bounds checking
  // Structure: it.body.children[1].body.children[1] = callout block
  if it.body.children.len() < 2 {
    panic("Callout structure error: expected at least 2 top-level children, found " + str(it.body.children.len()))
  }

  let body_child = it.body.children.at(1)
  if body_child.body.children.len() < 2 {
    panic("Callout structure error: expected at least 2 body children, found " + str(body_child.body.children.len()))
  }

  let old_callout = body_child.body.children.at(1)
  if old_callout.body.children.len() < 1 {
    panic("Callout structure error: expected at least 1 callout child, found " + str(old_callout.body.children.len()))
  }

  let old_title_block = old_callout.body.children.at(0)
  let children = old_title_block.body.body.children

  // Extract title (with or without icon)
  let old_title = if children.len() == 0 {
    none
  } else if children.len() == 1 {
    children.at(0) // No icon: title at index 0
  } else {
    children.at(1) // With icon: title at index 1
  }

  // Build new title with callout type and counter
  // Use it.numbering to handle chapter-based numbering correctly
  let callout_num = it.counter.display(it.numbering)
  let new_title = if empty(old_title) {
    [#kind #callout_num]
  } else {
    [#kind #callout_num: #old_title]
  }

  // Reassemble with new title
  let new_title_block = block_with_new_content(
    old_title_block,
    block_with_new_content(
      old_title_block.body,
      if children.len() <= 1 {
        new_title // No icon: just the title
      } else {
        children.at(0) + new_title // With icon: preserve icon block + new title
      },
    ),
  )

  // Check for body content before accessing
  if old_callout.body.children.len() < 2 {
    panic(
      "Callout structure error: expected at least 2 callout body children for content, found "
        + str(old_callout.body.children.len()),
    )
  }

  block_with_new_content(old_callout, block(below: 0pt, new_title_block) + old_callout.body.children.at(1))
}

/// Create a callout block
/// NOTE: Parameters use American English spelling (color not colour) for Quarto compatibility
/// @param body Callout content
/// @param title Callout title
/// @param background_color Background colour
/// @param icon Icon to display
/// @param icon_color Icon colour
/// @param body_background_color Body background colour
/// @return Formatted callout block
#let callout(
  body: [],
  title: "Callout",
  background_color: rgb("#dddddd"),
  icon: none,
  icon_color: black,
  body_background_color: white,
) = {
  block(
    breakable: false,
    fill: background_color,
    stroke: (paint: icon_color, thickness: 0.5pt, cap: "round"),
    width: 100%,
    radius: 2pt,
    block(
      inset: 1pt,
      width: 100%,
      below: 0pt,
      block(
        fill: background_color,
        width: 100%,
        inset: 8pt,
      )[#if icon != none [#text(icon_color, weight: 900)[#icon] ]#title],
    )
      + if (body != []) {
        block(
          inset: 1pt,
          width: 100%,
          block(fill: body_background_color, width: 100%, inset: 8pt, body),
        )
      },
  )
}
