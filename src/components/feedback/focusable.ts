/** What can take the caret: THE list the feedback blocks walk — the confirm popover's Tab loop (a link
 *  in a question's body included) and useDeleteWithUndo's hand-off to a row's controls. It is
 *  DetailPanelProvider's selector widened to summaries and any tabindex of 0 or more. Disabled controls
 *  and tabindex="-1" are out; an aria-disabled button is IN — a quiet button keeps its focus by design
 *  (BusyButton). */
export const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), ' +
  'textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'

/** Everything under `root` that can take the caret, in document order, minus whatever sits inside a
 *  `hidden` subtree. */
export function focusablesIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.closest('[hidden]') === null)
}
