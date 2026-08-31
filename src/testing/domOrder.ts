/**
 * Asserts the nodes appear in the given top-to-bottom document order — the section-order
 * pins' shared voice (2026-08-31 review round). A bare compareDocumentPosition bitmask
 * fails as "expected 0 to be truthy"; this names the out-of-order pair instead, so a
 * broken reorder reads as "expected X to precede Y" without a manual bisect.
 *
 * Test-only: throws a plain Error (vitest reports it verbatim), imports nothing, and is
 * unreachable from the app bundle.
 */
export function expectInDocumentOrder(...nodes: Element[]): void {
  const name = (node: Element) =>
    (node.textContent ?? '').trim().slice(0, 60) || `<${node.tagName.toLowerCase()}>`
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const before = nodes[i]
    const after = nodes[i + 1]
    const follows =
      (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    if (!follows) {
      throw new Error(`expected "${name(before)}" to precede "${name(after)}" in the document`)
    }
  }
}
