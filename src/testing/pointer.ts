// jsdom has no PointerEvent and no pointer capture (the drag-to-reorder hook needs both; 2026-09-23
// spec §2.6). Imported by the tests that drive pointer drags — deliberately NOT in the global setup,
// so no other suite runs against a polyfilled window. Guarded: a jsdom that grows the real thing wins.
export function installPointerEvents(): void {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number
      readonly pointerType: string
      readonly isPrimary: boolean
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.pointerType = init.pointerType ?? 'mouse'
        this.isPrimary = init.isPrimary ?? true
      }
    }
    Object.defineProperty(window, 'PointerEvent', {
      value: PointerEventPolyfill,
      configurable: true,
      writable: true,
    })
  }
  const proto = Element.prototype
  if (typeof proto.setPointerCapture !== 'function') proto.setPointerCapture = () => {}
  if (typeof proto.releasePointerCapture !== 'function') proto.releasePointerCapture = () => {}
  if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false
}
