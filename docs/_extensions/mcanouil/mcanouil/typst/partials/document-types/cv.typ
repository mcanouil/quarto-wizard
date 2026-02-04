// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Curriculum Vitae Template
// CV document type with academic and professional layout options.

/// Create branded CV document.
/// Placeholder implementation; will be fully implemented in a subsequent task.
///
/// @param body The document body content (CV sections).
/// @param ..args All parameters (forwarded to base template for now).
/// @return The rendered CV document.
#let mcanouil-cv(
  ..args,
) = {
  // TODO: Implement CV-specific layout with cv-style parameter
  // For now, delegate to mcanouil-report as a placeholder
  mcanouil-report(..args)
}
