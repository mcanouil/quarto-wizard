// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Letter Template
// Formal correspondence document type with letterhead, salutation, and closing.

/// Create branded letter document.
/// Placeholder implementation; will be fully implemented in a subsequent task.
///
/// @param body The document body content (letter text).
/// @param ..args All parameters (forwarded to base template for now).
/// @return The rendered letter document.
#let mcanouil-letter(
  ..args,
) = {
  // TODO: Implement letter-specific layout
  // For now, delegate to mcanouil-report as a placeholder
  mcanouil-report(..args)
}
