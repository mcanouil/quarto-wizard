/** @type {import("markdownlint").Rule} */
module.exports = {
  "names": ["QMD001", "blanks-around-fenced-divs"],
  "description": "Fenced Divs markers should be surrounded by blank lines",
  "tags": ["fenced_divs", "blank_lines"],
  "parser": "none",
  "function": function QMD001(params, onError) {
    const lines = params.lines;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.match(/^:{3,}/)) {
        const isMissingTopBlank = i === 0 || lines[i - 1].trim().length > 0;
        const isMissingBottomBlank = i === lines.length - 1 || lines[i + 1].trim().length > 0;
        if (isMissingTopBlank || isMissingBottomBlank) {
          onError({
            lineNumber: i + 1,
            detail: `Before: ${isMissingTopBlank ? "missing" : "present"}, After: ${isMissingBottomBlank ? "missing" : "present"}`,
          });
        }
      }
    }
  }
};
