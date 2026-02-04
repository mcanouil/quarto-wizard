// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Special Section Numbering Functions
//
// Provides numbering functions for special document sections (appendix, supplementary).
// These functions are applied directly via Lua filter using #set heading(numbering: ...).

// ============================================================================
// Numbering function factory
// ============================================================================

/// Factory for creating section numbering functions with optional prefix
/// @param pattern Numbering pattern string (e.g., "A.1.a.", "I.1.i.")
/// @param prefix Optional prefix for level 1 headings (e.g., "Appendix", "Supplementary")
/// @return Numbering function that formats heading numbers according to pattern
#let make-section-numbering(pattern, prefix: none) = {
  (..nums) => {
    let values = nums.pos()
    if values.len() == 0 {
      return ""
    }

    let number = numbering(pattern, ..values)
    if prefix != none and values.len() == 1 {
      [#prefix #number]
    } else {
      number
    }
  }
}

// ============================================================================
// Predefined numbering functions
// ============================================================================

/// Appendix numbering: "Appendix A", "A.a", "A.a.1" format
/// Level 1: "Appendix A"
/// Level 2+: "A.a", "A.a.1", etc.
#let appendix-numbering = make-section-numbering("A.a.1.", prefix: "Appendix")

/// Supplementary numbering: "Supplementary I", "I.i", "I.i.1" format
/// Level 1: "Supplementary I"
/// Level 2+: "I.i", "I.i.1", etc.
#let supplementary-numbering = make-section-numbering("I.i.1.", prefix: "Supplementary")

/// References numbering: none (unnumbered)
#let references-numbering = none
