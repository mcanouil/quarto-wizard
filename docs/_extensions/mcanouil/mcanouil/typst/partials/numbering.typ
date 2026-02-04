// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Numbering definitions for equations, callouts, subfloats, and theorems
// Section-type-aware: uses section-type state for consistent prefixing
// across appendix (A.x), supplementary (I.x), and main (n.x) sections.
// Mirrors the figure numbering pattern in document-types/report.typ.

// ============================================================================
// Shared section prefix helper
// ============================================================================

/// Compute section prefix from heading counter and section-type state.
/// Returns empty string when no heading context is available.
/// @return String prefix (e.g., "1.", "A.", "I.", or "")
#let section-prefix() = {
  let h-count = counter(heading).get()
  let stype = section-type.get()
  if h-count.len() > 0 and h-count.first() > 0 {
    let prefix = if stype == "appendix" {
      numbering("A", h-count.first())
    } else if stype == "supplementary" {
      numbering("I", h-count.first())
    } else {
      str(h-count.first())
    }
    prefix + "."
  } else {
    ""
  }
}

// ============================================================================
// Equation numbering
// ============================================================================

/// Section-prefixed equation numbering: "1.1", "A.1", "I.1"
#let equation-numbering = (..num) => {
  let eq-num = num.pos().first()
  let prefix = section-prefix()
  "(" + prefix + str(eq-num) + ")"
}

// ============================================================================
// Callout numbering
// ============================================================================

/// Callout numbering format
#let callout-numbering = "1"

// ============================================================================
// Subfloat numbering
// ============================================================================

/// Section-prefixed subfloat numbering: "1.1a", "A.1a", "I.1a"
/// @param n-super Super figure number
/// @param subfloat-idx Subfloat index within the super figure
/// @return Content with section-prefixed subfloat number
#let subfloat-numbering(n-super, subfloat-idx) = {
  let prefix = section-prefix()
  [#prefix#n-super#numbering("a", subfloat-idx)]
}

// ============================================================================
// Theorem configuration (theorion)
// ============================================================================

/// Theorem inherited heading levels (0 = no heading inheritance)
#let theorem-inherited-levels = 0

/// Section-aware theorem numbering format
/// @param loc Location for context
/// @return String numbering pattern
#let theorem-numbering(loc) = {
  let h-count = counter(heading).get()
  let stype = section-type.get()
  if h-count.len() > 0 and h-count.first() > 0 {
    if stype == "appendix" {
      "A.1"
    } else if stype == "supplementary" {
      "I.1"
    } else {
      "1.1"
    }
  } else {
    "1.1"
  }
}

/// Default theorem render function
/// @param prefix Optional prefix
/// @param title Theorem title
/// @param full-title Full formatted title (auto-generated)
/// @param body Theorem body
/// @return Formatted theorem
#let theorem-render(prefix: none, title: "", full-title: auto, body) = {
  if full-title != "" and full-title != auto and full-title != none {
    strong[#full-title.]
    h(0.5em)
  }
  body
}
