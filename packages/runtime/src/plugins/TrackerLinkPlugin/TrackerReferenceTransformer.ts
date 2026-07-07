/**
 * Markdown transformer for tracker references.
 *
 * Exports `TrackerReferenceNode` as a portable markdown link
 * `[NIM-123](auracle://NIM-123)` and imports any `auracle://<key>` link
 * back into a `TrackerReferenceNode`. The label is display-only; the canonical
 * reference key is the URN path after `auracle://`.
 *
 * Scheme-gated so it never collides with `DocumentReferenceTransformer`, whose
 * regex explicitly excludes links containing `://`.
 */

import type { TextMatchTransformer } from '@lexical/markdown';

import {
  $createTrackerReferenceNode,
  $isTrackerReferenceNode,
  TrackerReferenceNode,
  TRACKER_REFERENCE_URN_SCHEME,
} from './TrackerReferenceNode';

// Built from TRACKER_REFERENCE_URN_SCHEME so the matchers can never drift
// from the scheme the export side emits.
const SCHEME_PATTERN = TRACKER_REFERENCE_URN_SCHEME.replace(
  /[.*+?^${}()|[\]\\]/g,
  '\\$&',
);

export const TrackerReferenceTransformer: TextMatchTransformer = {
  dependencies: [TrackerReferenceNode],
  export: (node) => {
    if (!$isTrackerReferenceNode(node)) {
      return null;
    }
    const key = node.getReferenceKey();
    return `[${key}](${TRACKER_REFERENCE_URN_SCHEME}${key})`;
  },
  // Match markdown links whose href uses the tracker URN scheme. The label
  // (group 1) is display-only; the reference key (group 2) is the URN path.
  importRegExp: new RegExp(`(?<!!)\\[([^\\]]+)\\]\\(${SCHEME_PATTERN}([^)\\s]+)\\)`),
  regExp: new RegExp(`(?<!!)\\[([^\\]]+)\\]\\(${SCHEME_PATTERN}([^)\\s]+)\\)$`),
  replace: (textNode, match) => {
    const [, , referenceKey] = match;
    textNode.replace($createTrackerReferenceNode(referenceKey));
  },
  trigger: ')',
  type: 'text-match',
};
