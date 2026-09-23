// The PageFrame parts other shell code has to find — the sticky scope row, the body under it —
// named by a data attribute, which is a contract, rather than by the class names the stylesheets
// own (code review 11). PageFrame spreads framePartProps onto them; finders use framePartSelector.

export type FramePart = 'scope' | 'body'

const ATTRIBUTE = 'data-frame-part'

/** Spread onto the element that IS the part: `<div {...framePartProps('body')}>`. */
export function framePartProps(part: FramePart): { [ATTRIBUTE]: FramePart } {
  return { [ATTRIBUTE]: part }
}

/** The CSS selector that finds a part. */
export function framePartSelector(part: FramePart): string {
  return `[${ATTRIBUTE}="${part}"]`
}
