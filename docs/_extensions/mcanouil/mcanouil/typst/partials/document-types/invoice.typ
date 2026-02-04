// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Invoice Template
// Business invoice document type with sender/recipient details, line items, and payment information.

/// Create branded invoice document.
/// Placeholder implementation; will be fully implemented in a subsequent task.
///
/// @param body The document body content (typically line items table).
/// @param ..args All parameters (forwarded to base template for now).
/// @return The rendered invoice document.
#let mcanouil-invoice(
  ..args,
) = {
  // TODO: Implement invoice-specific layout
  // For now, delegate to mcanouil-report as a placeholder
  mcanouil-report(..args)
}
