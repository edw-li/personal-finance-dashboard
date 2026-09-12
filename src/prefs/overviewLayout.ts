export const OVERVIEW_TILES = ['net_worth', 'portfolio', 'living_spending', 'tax'] as const
export const OVERVIEW_CARDS = ['ytd', 'performance', 'spending', 'money_flow'] as const
export type OverviewTile = typeof OVERVIEW_TILES[number]
export type OverviewCard = typeof OVERVIEW_CARDS[number]
export interface OverviewLayout { tiles: OverviewTile[]; cards: OverviewCard[] }
export const DEFAULT_OVERVIEW_LAYOUT: OverviewLayout = { tiles: [...OVERVIEW_TILES], cards: [...OVERVIEW_CARDS] }
export function isOverviewLayout(value: unknown): value is OverviewLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const layout = value as Record<string, unknown>
  const validList = (items: unknown, allowed: readonly string[]) => Array.isArray(items) && items.every(item => typeof item === 'string' && allowed.includes(item)) && new Set(items).size === items.length
  return Object.keys(layout).length === 2 && validList(layout.tiles, OVERVIEW_TILES) && (layout.tiles as unknown[]).length > 0 && validList(layout.cards, OVERVIEW_CARDS)
}
