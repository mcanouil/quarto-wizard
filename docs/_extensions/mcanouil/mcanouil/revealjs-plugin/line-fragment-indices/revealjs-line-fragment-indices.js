/**
 * Reveal.js plugin to control line highlighting fragment indices.
 *
 * @license MIT
 * @copyright 2026 Mickaël Canouil
 * @author Mickaël Canouil
 *
 * Allows synchronising code line highlights with specific fragment indices,
 * enabling tighter integration between code reveals and other slide content.
 *
 * Usage in Quarto:
 * ```{.r code-line-numbers="|2|3" code-line-fragment-indices="1,2,4"}
 * line1
 * line2
 * line3
 * ```
 *
 * The code-line-fragment-indices attribute accepts a comma-separated list of
 * fragment indices matching the number of highlight steps (including initial state).
 */

window.RevealJsLineFragmentIndices = function () {
  "use strict";

  /**
   * Check if a value is defined and not null.
   * @param {*} val - Value to check.
   * @returns {boolean} True if defined and not null.
   */
  function isDefined(val) {
    return val !== undefined && val !== null;
  }

  /**
   * Parse a comma-separated string of fragment indices.
   * @param {string} str - Comma-separated indices (e.g., "1,2,4").
   * @returns {Array<number|null>} Array of parsed indices.
   */
  function parseIndices(str) {
    if (!str || typeof str !== "string") {
      return [];
    }
    return str.split(",").map((s) => {
      const num = parseInt(s.trim(), 10);
      return isNaN(num) ? null : num;
    });
  }

  /**
   * Process all code blocks with line fragment indices attribute.
   * Modifies data-fragment-index on highlight clones to match specified indices.
   * @param {Object} deck - Reveal.js deck instance.
   */
  function processLineFragmentIndices(deck) {
    const codeBlocks = deck
      .getRevealElement()
      .querySelectorAll("div.sourceCode[data-code-line-fragment-indices]");

    for (const sourceCodeDiv of codeBlocks) {
      const indicesStr = sourceCodeDiv.getAttribute(
        "data-code-line-fragment-indices"
      );
      const indices = parseIndices(indicesStr);

      if (indices.length === 0) continue;

      const pre = sourceCodeDiv.querySelector("pre");
      if (!pre) continue;

      const fragmentCodes = pre.querySelectorAll("code.fragment");
      if (fragmentCodes.length === 0) continue;

      // Warn if counts do not match
      // indices[0] is for step 0 (original, no fragment)
      // indices[1..n] are for fragmentCodes[0..n-1]
      const expectedIndices = fragmentCodes.length + 1;
      if (indices.length !== expectedIndices) {
        console.warn(
          `[line-fragment-indices] Code block has ${expectedIndices} highlight steps but ${indices.length} fragment indices specified.`,
          sourceCodeDiv
        );
      }

      // Apply indices to fragment clones
      // indices[0] is for the original (no fragment, skip)
      // indices[i+1] maps to fragmentCodes[i]
      for (const [i, fragment] of [...fragmentCodes].entries()) {
        const targetIndex = indices[i + 1];
        if (isDefined(targetIndex)) {
          fragment.setAttribute("data-fragment-index", targetIndex);
        }
      }
    }
  }

  return {
    id: "RevealJsLineFragmentIndices",

    init: function (deck) {
      deck.on("ready", function () {
        processLineFragmentIndices(deck);
      });
    },
  };
};
