// Where a tool's answer is allowed to send the reader (2026-09-03 planning-sandboxes spec
// §12, the 2026-09-02 audit's allow-list rule). Its own module rather than a second export
// from AssistantDrawer.tsx so the drawer stays a component file — and so this rule, which is
// a security boundary, can be unit-tested against the strings it is meant to refuse.
import { NAV_ITEMS } from '../navItems'

/** The three planning sandboxes: the only destinations the server ever mints a link for.
 *
 *  Deliberately NARROWER than NAV_ITEMS. /settings is a real page, but no tool has any
 *  business sending a reader there, and the day one tries, the honest answer is to render
 *  no link rather than to trust that the server meant it.
 *
 *  Read out of NAV_ITEMS rather than written as literals: if a route is ever renamed, this
 *  set shrinks and the size assertion in the tests fails, instead of the affordance quietly
 *  disappearing from every what-if answer. */
const SANDBOX_ROUTES = new Set(['/taxes', '/paycheck', '/projection'])
export const NAV_PATHS: ReadonlySet<string> = new Set(
  NAV_ITEMS.map((item) => item.to).filter((to) => SANDBOX_ROUTES.has(to)),
)

/** Whether `to` may be rendered as a react-router `Link`.
 *
 *  An exact match on the path before the query, which is what makes it safe: there is no
 *  prefix rule to get wrong, so `//evil.example`, `https://evil.example/x`,
 *  `javascript:alert(1)` and `/taxes/x` are all simply absent from the set. The QUERY is
 *  left free-form on purpose — it carries the scenario, and the page's own codec fences it. */
export function isNavLink(to: string): boolean {
  return NAV_PATHS.has(to.split('?')[0])
}
