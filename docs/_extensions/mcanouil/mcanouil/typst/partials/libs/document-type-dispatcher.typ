// @license MIT
// @copyright 2026 Mickaël Canouil
// @author Mickaël Canouil
//
// Document Type Dispatcher
// Routes to appropriate template function based on document-type parameter.

/// Supported document types
#let DOCUMENT_TYPES = ("report", "invoice", "letter", "cv")

/// Main document dispatcher function.
/// Routes to the appropriate template function based on document-type.
///
/// @param document-type The type of document to render ("report", "invoice", "letter", "cv").
/// @param body The document body content.
/// @param ..args All other parameters passed through to the template function.
/// @return The rendered document.
#let mcanouil-document(
  document-type: "report",
  ..args,
) = {
  // Validate and normalise document type
  let doc-type = if document-type in DOCUMENT_TYPES {
    document-type
  } else {
    // Fall back to report with warning
    "report"
  }

  // Dispatch to appropriate template
  // The body is passed as positional argument via args.pos()
  // Named arguments are passed via args.named()
  if doc-type == "invoice" {
    mcanouil-invoice(..args)
  } else if doc-type == "letter" {
    mcanouil-letter(..args)
  } else if doc-type == "cv" {
    mcanouil-cv(..args)
  } else {
    // Default: report
    mcanouil-report(..args)
  }
}
