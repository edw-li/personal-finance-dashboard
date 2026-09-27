import { createContext, useContext } from 'react'

export interface GuideSession {
  taskId: string | null
  select: (id: string) => void
  close: () => void
}
export const GuideSessionContext = createContext<GuideSession | null>(null)
export const useGuideSession = () => useContext(GuideSessionContext)
export function guidedDestination(to: string, id: string): string {
  const url = new URL(to, 'http://guide.local')
  if (url.pathname !== '/guide') url.searchParams.set('guideTask', id)
  return `${url.pathname}${url.search}${url.hash}`
}
