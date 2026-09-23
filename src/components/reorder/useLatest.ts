import { useLayoutEffect, useRef } from 'react'

/** A ref that always holds the latest value — for async callbacks (a save or Undo answering after a
 *  re-render) that must call the CURRENT `onChanged`, never the one captured at drop time
 *  (useReorder's `latest` idiom; lane R3's review). Synced in a layout effect, so it is current
 *  before any answer can land. Read it only in callbacks, never during render. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
