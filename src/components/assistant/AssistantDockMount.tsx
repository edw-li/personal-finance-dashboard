import { useLayoutEffect, useRef } from 'react'

// The conversation stays mounted while an evidence inspector temporarily occupies
// the shared panel. Moving its portal host preserves the composer and scroll state.
export default function AssistantDockMount({ host }: { host: HTMLDivElement }) {
  const mount = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = mount.current
    element?.appendChild(host)
    return () => { if (host.parentElement === element) host.remove() }
  }, [host])
  return <div className="assistant-dock-mount" ref={mount} />
}
