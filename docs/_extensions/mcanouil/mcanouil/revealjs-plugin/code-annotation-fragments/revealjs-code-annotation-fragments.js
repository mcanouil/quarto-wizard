/**
 * Reveal.js plugin to enable fragment navigation through code annotations.
 *
 * @license MIT
 * @copyright 2026 Mickaël Canouil
 * @author Mickaël Canouil
 *
 * Creates invisible fragment elements for each code annotation anchor,
 * allowing navigation through annotations using arrow keys or fragment controls.
 *
 * Features:
 * - Hidden fragment triggers for each annotation.
 * - Tooltip display (via tippy.js) when fragments are revealed.
 * - Forward and backward navigation support.
 * - Synchronisation with line highlighting when present.
 *
 * Configuration:
 * ```yaml
 * extensions:
 *   mcanouil:
 *     code-annotation-fragments: true  # enabled by default
 * ```
 */

window.RevealJsCodeAnnotationFragments = function () {
  "use strict";

  /**
   * Check if a fragment is a line highlight fragment.
   * @param {Element} fragment - The fragment element to check.
   * @returns {boolean} True if line highlight fragment.
   */
  function isLineHighlightFragment(fragment) {
    return (
      fragment.tagName === "CODE" &&
      fragment.classList.contains("fragment") &&
      fragment.closest("pre") !== null
    );
  }

  /**
   * Build CSS selector for an annotation anchor.
   * @param {string} targetCell - The target cell ID.
   * @param {string} targetAnnotation - The annotation number.
   * @returns {string} CSS selector string.
   */
  function buildAnchorSelector(targetCell, targetAnnotation) {
    return `.code-annotation-anchor[data-target-cell="${targetCell}"][data-target-annotation="${targetAnnotation}"]`;
  }

  /**
   * Check if the plugin is enabled in config.
   * Reads from extensions.mcanouil.code-annotation-fragments.
   * @param {Object} config - Reveal.js deck config.
   * @returns {boolean} True if enabled.
   */
  function getEnabled(config) {
    const mcanouil = config["extensions"]?.["mcanouil"];
    const value = mcanouil?.["code-annotation-fragments"];

    if (typeof value === "boolean") return value;

    return true; // default enabled
  }

  /**
   * Get the next available fragment index for a slide.
   * @param {Element} slide - The slide element.
   * @returns {number} Next available fragment index.
   */
  function getNextFragmentIndex(slide) {
    const fragments = slide.querySelectorAll(".fragment[data-fragment-index]");
    let maxIndex = -1;

    for (const fragment of fragments) {
      const idx = parseInt(fragment.getAttribute("data-fragment-index"), 10);
      if (!isNaN(idx) && idx > maxIndex) {
        maxIndex = idx;
      }
    }

    return maxIndex + 1;
  }

  /**
   * Hide all annotation tooltips.
   */
  function hideAllAnnotationTooltips() {
    const anchors = document.querySelectorAll(".code-annotation-anchor");
    for (const anchor of anchors) {
      if (anchor._tippy) {
        anchor._tippy.hide();
      }
    }
  }

  /**
   * Patch all annotation tooltips to append to their slide.
   * This prevents overflow clipping from inner containers.
   */
  function patchAnnotationTooltips() {
    const anchors = document.querySelectorAll(".code-annotation-anchor");
    for (const anchor of anchors) {
      if (anchor._tippy) {
        const slide = anchor.closest("section");
        if (slide) {
          anchor._tippy.setProps({ appendTo: slide });
        }
      }
    }
  }

  /**
   * Show annotation tooltip for a specific anchor.
   * @param {string} targetCell - The target cell ID.
   * @param {string} targetAnnotation - The annotation number.
   * @param {Element} [visibleFragment] - Currently visible fragment (optional).
   */
  function showAnnotationTooltip(targetCell, targetAnnotation, visibleFragment) {
    const selector = buildAnchorSelector(targetCell, targetAnnotation);

    // Try to find anchor within visible fragment first (for correct positioning)
    let anchor = visibleFragment?.querySelector(selector);

    // Fallback to global search
    if (!anchor) {
      anchor = document.querySelector(selector);
    }

    if (!anchor) return;

    if (anchor._tippy) {
      // Append to slide to avoid overflow clipping from inner containers
      const slide = anchor.closest("section");
      if (slide) {
        anchor._tippy.setProps({ appendTo: slide });
      }
      anchor._tippy.show();
      // Update position after showing (popper instance exists only after show)
      requestAnimationFrame(() => {
        anchor._tippy?.popperInstance?.update();
      });
    } else {
      anchor.click();
    }
  }

  /**
   * Set up synchronisation between line highlights and annotations.
   * @param {Element} codeBlock - The code block element.
   * @param {Element} sourceCodeDiv - The source code div container.
   * @param {NodeList} anchors - The annotation anchors.
   */
  function setupLineHighlightSync(codeBlock, sourceCodeDiv, anchors) {
    const targetCell = sourceCodeDiv.id;
    const lineHighlightFragments = codeBlock.querySelectorAll(
      "code.fragment.has-line-highlights"
    );

    codeBlock.dataset.annotationSyncMode = "line-highlight";
    codeBlock.dataset.targetCell = targetCell;

    // Get sorted fragment indices
    const fragmentIndices = [...lineHighlightFragments]
      .map((fragment, i) => {
        const idx = parseInt(fragment.getAttribute("data-fragment-index"), 10);
        return isNaN(idx) ? i : idx;
      })
      .sort((a, b) => a - b);

    // Map each fragment to corresponding annotation by position
    const stepToAnnotations = {};

    for (const [position, fragmentIndex] of fragmentIndices.entries()) {
      const annotationNum = String(position + 1);
      const exists = [...anchors].some(
        (anchor) => anchor.dataset.targetAnnotation === annotationNum
      );

      if (exists) {
        stepToAnnotations[fragmentIndex] = [annotationNum];
      }
    }

    codeBlock.dataset.stepToAnnotations = JSON.stringify(stepToAnnotations);
  }

  /**
   * Set up sequential fragment triggers for annotations.
   * @param {Element} slide - The slide element.
   * @param {Element} parentNode - The parent node for fragment insertion.
   * @param {NodeList} anchors - The annotation anchors.
   */
  function setupSequentialFragments(slide, parentNode, anchors) {
    let currentIndex = getNextFragmentIndex(slide);

    for (const [i, anchor] of [...anchors].entries()) {
      const { targetCell, targetAnnotation } = anchor.dataset;

      const fragmentDiv = document.createElement("div");
      fragmentDiv.className = "code-annotation-fragment fragment";
      fragmentDiv.dataset.targetCell = targetCell;
      fragmentDiv.dataset.targetAnnotation = targetAnnotation;
      fragmentDiv.dataset.anchorIndex = i;
      fragmentDiv.setAttribute("data-fragment-index", currentIndex);
      fragmentDiv.style.display = "none";

      parentNode.appendChild(fragmentDiv);
      currentIndex++;
    }
  }

  /**
   * Set up fragment triggers for code annotations.
   * Creates invisible fragment elements or syncs with line highlighting.
   */
  function setupCodeAnnotationFragments() {
    const annotatedCells = document.querySelectorAll(
      ".reveal .slides .code-annotation-code"
    );

    for (const codeBlock of annotatedCells) {
      if (codeBlock.dataset.annotationFragmentsCreated) continue;
      codeBlock.dataset.annotationFragmentsCreated = "true";

      const anchors = codeBlock.querySelectorAll(".code-annotation-anchor");
      if (anchors.length === 0) continue;

      const slide = codeBlock.closest("section");
      if (!slide) continue;

      const parentNode = codeBlock.closest(".cell") || codeBlock.parentNode;
      const sourceCodeDiv = codeBlock.closest("div.sourceCode");
      const hasLineHighlighting =
        codeBlock.querySelector("code.fragment.has-line-highlights") !== null;

      if (hasLineHighlighting && sourceCodeDiv) {
        setupLineHighlightSync(codeBlock, sourceCodeDiv, anchors);
      } else {
        setupSequentialFragments(slide, parentNode, anchors);
      }
    }
  }

  /**
   * Handle line highlight fragment events for synced annotations.
   * @param {Element} fragment - The line highlight fragment.
   * @param {boolean} isShown - True if shown, false if hidden.
   */
  function handleLineHighlightFragment(fragment, isShown) {
    const fragmentIndex = parseInt(
      fragment.getAttribute("data-fragment-index"),
      10
    );

    const pre = fragment.closest("pre");
    const sourceCodeDiv = pre?.closest("div.sourceCode");
    if (!sourceCodeDiv) return;

    const codeBlock = sourceCodeDiv.querySelector(".code-annotation-code");
    if (!codeBlock || codeBlock.dataset.annotationSyncMode !== "line-highlight")
      return;

    const targetCell = codeBlock.dataset.targetCell;

    let stepToAnnotations;
    try {
      stepToAnnotations = JSON.parse(
        codeBlock.dataset.stepToAnnotations || "{}"
      );
    } catch {
      return;
    }

    hideAllAnnotationTooltips();

    if (isShown) {
      const annotations = stepToAnnotations[fragmentIndex];
      if (annotations?.length > 0) {
        for (const annotationNum of annotations) {
          showAnnotationTooltip(targetCell, annotationNum, fragment);
        }
      }
    } else {
      const prevIndex = fragmentIndex - 1;
      const prevAnnotations = stepToAnnotations[prevIndex];
      if (prevAnnotations?.length > 0) {
        const prevFragment = pre.querySelector(
          `code.fragment[data-fragment-index="${prevIndex}"]`
        );
        for (const annotationNum of prevAnnotations) {
          showAnnotationTooltip(targetCell, annotationNum, prevFragment);
        }
      }
    }
  }

  /**
   * Handle annotation fragment shown events.
   * @param {Object} event - Reveal.js fragment event.
   */
  function onAnnotationFragmentShown(event) {
    const { fragment } = event;
    if (!fragment) return;

    if (isLineHighlightFragment(fragment)) {
      handleLineHighlightFragment(fragment, true);
      return;
    }

    if (!fragment.classList.contains("code-annotation-fragment")) return;

    hideAllAnnotationTooltips();

    const { targetCell, targetAnnotation } = fragment.dataset;
    showAnnotationTooltip(targetCell, targetAnnotation);
  }

  /**
   * Handle annotation fragment hidden events.
   * @param {Object} event - Reveal.js fragment event.
   */
  function onAnnotationFragmentHidden(event) {
    const { fragment } = event;
    if (!fragment) return;

    if (isLineHighlightFragment(fragment)) {
      handleLineHighlightFragment(fragment, false);
      return;
    }

    if (!fragment.classList.contains("code-annotation-fragment")) return;

    hideAllAnnotationTooltips();

    const anchorIndex = parseInt(fragment.dataset.anchorIndex, 10);
    if (anchorIndex > 0) {
      const slide = fragment.closest("section");
      if (slide) {
        const prevFragment = slide.querySelector(
          `.code-annotation-fragment[data-anchor-index="${anchorIndex - 1}"]`
        );
        if (prevFragment) {
          const { targetCell, targetAnnotation } = prevFragment.dataset;
          showAnnotationTooltip(targetCell, targetAnnotation);
        }
      }
    }
  }

  return {
    id: "RevealJsCodeAnnotationFragments",

    init: function (deck) {
      const config = deck.getConfig();

      // Always patch tooltips to avoid overflow clipping
      deck.on("ready", patchAnnotationTooltips);
      deck.on("slidechanged", patchAnnotationTooltips);

      if (!getEnabled(config)) return;

      deck.on("ready", setupCodeAnnotationFragments);
      deck.on("fragmentshown", onAnnotationFragmentShown);
      deck.on("fragmenthidden", onAnnotationFragmentHidden);
      deck.on("slidechanged", hideAllAnnotationTooltips);
    },
  };
};
