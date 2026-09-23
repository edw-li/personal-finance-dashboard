import { GripVertical } from 'lucide-react'
import './reorder.css'
import type { ReorderHandleProps } from './reorderTypes'

/** The grip every reorderable row wears (2026-09-23 spec §2.4): a real button named for its row and
 *  described by the list's instructions. All behaviour arrives in `handleProps` — this component
 *  only draws. */
export default function DragHandle({ name, ...handle }: { name: string } & ReorderHandleProps) {
  return (
    <button type="button" className="reorder-grip" aria-label={`Reorder ${name}`} {...handle}>
      <GripVertical size={14} aria-hidden="true" />
    </button>
  )
}
