import type { KeyboardEvent, PointerEvent, RefCallback } from 'react'

/** What `useReorder().handleProps(id)` returns — spread onto a DragHandle (2026-09-23 spec §2.4). */
export interface ReorderHandleProps {
  ref: RefCallback<HTMLButtonElement>
  /** True only when the item's range holds nothing else to move among. */
  disabled: boolean
  /** The list is busy (a save in flight): inert but still focusable, so focus survives a save. */
  'aria-disabled': true | undefined
  'aria-describedby': string
  'aria-pressed': true | undefined
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void
  onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  onBlur: () => void
}

/** What `useReorder().itemProps(id)` returns — spread onto every rendered row. */
export interface ReorderItemProps {
  ref: RefCallback<HTMLElement>
  'data-reorder-id': string
}
