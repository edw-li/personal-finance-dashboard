# Sandbox lane A — assistant seam (`sandbox_links.py`, `sandbox_url`, `link` on `tool_result`, the drawer chip) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the assistant seam of `docs/superpowers/specs/2026-09-03-planning-sandboxes-design.md` §12: a server-side encoder that turns a what-if body into a `/taxes?whatif=…` link with exactly the frontend grammar (pinned to the shared parity fixture), `sandbox_url` on `run_tax_whatif`'s compact result, an optional `link` on the `tool_result` SSE payload, and an internal `Link` chip "Open in What-if →" under the tool chip in the drawer — rendered only for NAV paths.

**Architecture:** `app/services/sandbox_links.py` is pure: `sandbox_link(page, entries)` allow-lists the three sandbox paths and builds the query with `urllib.parse.urlencode([("whatif", e) …])`, which percent-encodes `:` exactly as `URLSearchParams` does (the fixture proves byte equality); `whatif_entries(body: WhatIfIn)` formats legs in the page codec's canonical order (sales · ESPP · overrides sorted by key) with `format(decimal, "f")` so no `0E-9` ever reaches a URL. `_run_tax_whatif` adds `sandbox_url` to the dict it already returns; `assistant_chat.py` lifts it into `tool_result` as `link: { to, label }`. On the client, `assistantStream.ts` passes `link` through `onToolResult`, the drawer stores it on the `TranscriptTool` and renders a react-router `Link` when the path is one of `NAV_ITEMS` — the audit's allow-list rule; anything else renders no link.

**Tech Stack:** FastAPI/pydantic/pytest (`FINANCE_TEST_DB=finance_test_sandbox_a`), TypeScript/vitest.

**Worktree / commands:** Branch `sandbox-assistant`, worktree `.worktrees/sandbox-assistant`. Backend from `<worktree>/backend`: `FINANCE_TEST_DB=finance_test_sandbox_a ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`; ruff as in lane B. Frontend after `cmd /c mklink /J node_modules ..\..\node_modules`: `npx vitest run <file>`, `npx tsc -b`, `npx eslint src/api/assistantStream.ts src/api/assistantSession.ts src/components/assistant`.

**Prerequisites on main:** lane G (for `backend/tests/fixtures/sandbox_entries.json` — this lane READS it, never edits it). Nothing else: `niit_tax` (lane B) is additive and irrelevant to the link. Runs alongside the page lanes.

**Shared-file hotspots:** `backend/app/services/assistant_tools.py`, `assistant_chat.py`, `backend/tests/test_assistant_tools.py`, `test_assistant_chat_api.py` (this lane only); `src/api/assistantStream.ts`, `src/api/assistantSession.ts`, `src/components/assistant/AssistantDrawer.tsx` + tests (this lane only). Lane B edits `backend/tests/conftest.py` — this lane does not.

**Overnight rule:** no file deletions.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/sandbox_links.py` (new) | `SANDBOX_PATHS`, `sandbox_link`, entry encoders, `whatif_entries` |
| `backend/tests/test_sandbox_links.py` (new) | parity fixture, allow-list, entry formatting from a `WhatIfIn` |
| `backend/app/services/assistant_tools.py` (modify) | `sandbox_url` on the compact what-if result |
| `backend/tests/test_assistant_tools.py` (modify) | `sandbox_url` matches the encoder; a non-sandbox page is refused |
| `backend/app/services/assistant_chat.py` (modify) | `tool_result` gains `link` when the result carries `sandbox_url` |
| `backend/tests/test_assistant_chat_api.py` (modify) | a `run_tax_whatif` round emits the link |
| `src/api/assistantStream.ts` (modify) | `onToolResult` payload type gains `link?` |
| `src/api/assistantStream.test.ts` (modify) | the frame passes `link` through |
| `src/api/assistantSession.ts` (modify) | `TranscriptTool.link?` |
| `src/components/assistant/AssistantDrawer.tsx` (modify) | store `link`; render the chip's `Link` for NAV paths only |
| `src/components/assistant/AssistantDrawer.test.tsx` (modify) | link chip rendered; foreign path not rendered |

---

### Task 1: `sandbox_links.py`

**Files:**
- Create: `backend/app/services/sandbox_links.py`
- Test: `backend/tests/test_sandbox_links.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_sandbox_links.py
"""The assistant's sandbox encoder (2026-09-03 planning-sandboxes spec §12) — pinned to the SAME
parity fixture src/sandbox/scenarioUrl.test.ts reads, so the URL the server emits is the URL
the frontend decodes, byte for byte."""

import json
from decimal import Decimal
from pathlib import Path

import pytest

from app.schemas.taxes import EsppSaleIn, SaleLegIn, WhatIfIn
from app.services.sandbox_links import (
    SANDBOX_PATHS,
    espp_entry,
    knob_entry,
    override_entry,
    retire_entry,
    sale_entry,
    sandbox_link,
    whatif_entries,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sandbox_entries.json"


def test_parity_fixture_urls_byte_for_byte():
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 4
    for case in cases:
        assert sandbox_link(case["page"], case["entries"]) == case["url"]


def test_only_the_three_sandbox_pages_are_linkable():
    assert set(SANDBOX_PATHS) == {"taxes", "paycheck", "projection"}
    assert sandbox_link("taxes", []) == "/taxes"
    with pytest.raises(ValueError, match="not a sandbox page"):
        sandbox_link("settings", ["x:1"])
    with pytest.raises(ValueError, match="not a sandbox page"):
        sandbox_link("/taxes", [])


def test_entry_encoders_speak_the_wire_vocabulary():
    assert sale_entry(7, Decimal("40")) == "sale:7:40"
    assert sale_entry(9, Decimal("10"), price=Decimal("62.50"), term="short") == "sale:9:10:62.50:S"
    assert sale_entry(11, Decimal("5"), term="short") == "sale:11:5::S"
    assert sale_entry(7, Decimal("40.000000"), term="long") == "sale:7:40.000000"
    assert espp_entry(3) == "espp:3"
    assert espp_entry(4, Decimal("150.0000")) == "espp:4:150.0000"
    assert override_entry("qualified_dividends", None) == "qualified_dividends:null"
    assert override_entry("trad_401k_contributions", Decimal("23500")) == "trad_401k_contributions:23500"
    assert override_entry("x", Decimal("0E-9")) == "x:0.000000000"  # never scientific notation
    assert knob_entry("annual_return", Decimal("0.06")) == "annual_return:0.06"
    assert knob_entry("hsa_coverage", "family") == "hsa_coverage:family"
    assert retire_entry(2, "2035-06") == "retire:2:2035-06"


def test_whatif_entries_follow_the_page_codecs_canonical_order():
    body = WhatIfIn(
        year=2024,
        sales=[
            SaleLegIn(security_id=9, shares=Decimal("10"), price=Decimal("62.50"), term="short"),
            SaleLegIn(security_id=7, shares=Decimal("40")),
        ],
        espp_sales=[EsppSaleIn(lot_id=4, sale_price=Decimal("150.0000")), EsppSaleIn(lot_id=3)],
        overrides={"trad_401k_contributions": Decimal("23500"), "qualified_dividends": None},
    )
    # Sales and ESPP legs keep the body's order (a leg list is positional); overrides sort.
    assert whatif_entries(body) == [
        "sale:9:10:62.50:S",
        "sale:7:40",
        "espp:4:150.0000",
        "espp:3",
        "qualified_dividends:null",
        "trad_401k_contributions:23500",
    ]
    assert sandbox_link("taxes", whatif_entries(WhatIfIn(year=2024))) == "/taxes"
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_sandbox_a <venv-python> -m pytest tests/test_sandbox_links.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.sandbox_links`.

- [ ] **Step 3: Write the module**

```python
# backend/app/services/sandbox_links.py
"""Deep links into the planning sandboxes (2026-09-03 planning-sandboxes spec §6, §12).

One repeated `whatif` query param, each value one entry `<kind>:<fields>` in the SERVER'S
wire vocabulary — the same grammar src/sandbox/scenarioUrl.ts decodes. `urlencode` with
`quote_plus` percent-encodes the colon exactly as the browser's URLSearchParams does, so the
strings here and there are byte-identical (tests/fixtures/sandbox_entries.json is the pin
both sides read). Allow-listed to the three sandbox paths: an assistant can only ever link
INTO a sandbox, never anywhere else. Pure — no DB, no HTTP.
"""

from decimal import Decimal
from urllib.parse import urlencode

from app.schemas.taxes import WhatIfIn

SANDBOX_PATHS: dict[str, str] = {
    "taxes": "/taxes",
    "paycheck": "/paycheck",
    "projection": "/projection",
}

WHATIF_PARAM = "whatif"


def _text(value: Decimal | int | str) -> str:
    # `format(d, "f")`, never str(): a driver zero is Decimal("0E-9"), which no URL should
    # carry and no JS decimal parser reads as a number (schemas/espp.py's Pct9 note).
    return format(value, "f") if isinstance(value, Decimal) else str(value)


def sandbox_link(page: str, entries: list[str]) -> str:
    """`/taxes?whatif=sale%3A7%3A40&whatif=…` — or the bare path with no entries."""
    path = SANDBOX_PATHS.get(page)
    if path is None:
        raise ValueError(f"{page!r} is not a sandbox page")
    if not entries:
        return path
    return f"{path}?{urlencode([(WHATIF_PARAM, entry) for entry in entries])}"


def sale_entry(
    security_id: int,
    shares: Decimal,
    price: Decimal | None = None,
    term: str | None = None,
) -> str:
    """`sale:<security_id>:<shares>[:<price>][:<S>]` — an empty price field is the API's omit
    case (the latest quote); long is the default and is omitted."""
    fields = [str(security_id), _text(shares)]
    short = term == "short"
    if price is not None or short:
        fields.append("" if price is None else _text(price))
    if short:
        fields.append("S")
    return ":".join(["sale", *fields])


def espp_entry(lot_id: int, sale_price: Decimal | None = None) -> str:
    fields = ["espp", str(lot_id)]
    if sale_price is not None:
        fields.append(_text(sale_price))
    return ":".join(fields)


def override_entry(key: str, value: Decimal | None) -> str:
    return f"{key}:{'null' if value is None else _text(value)}"


def knob_entry(key: str, value: Decimal | int | str) -> str:
    return f"{key}:{_text(value)}"


def retire_entry(person_id: int, month: str) -> str:
    return f"retire:{person_id}:{month}"


def whatif_entries(body: WhatIfIn) -> list[str]:
    """A what-if body as entries, in the Taxes codec's canonical order: sales · ESPP ·
    overrides sorted by key. The leg lists keep their order (they are positional)."""
    return [
        *(sale_entry(leg.security_id, leg.shares, leg.price, leg.term) for leg in body.sales),
        *(espp_entry(leg.lot_id, leg.sale_price) for leg in body.espp_sales),
        *(override_entry(key, body.overrides[key]) for key in sorted(body.overrides)),
    ]
```

- [ ] **Step 4: Run the test**

Run: `FINANCE_TEST_DB=finance_test_sandbox_a <venv-python> -m pytest tests/test_sandbox_links.py -q`
Expected: 4 passed. If the fixture case fails on `%3A`, the fixture was edited — it must not be; the encoder here and `URLSearchParams` agree by construction.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sandbox_links.py backend/tests/test_sandbox_links.py
git commit -m "feat(assistant): sandbox_links — allow-listed whatif deep-link encoder pinned to the parity fixture"
```

---

### Task 2: `sandbox_url` on the compact what-if result

**Files:**
- Modify: `backend/app/services/assistant_tools.py`
- Test: `backend/tests/test_assistant_tools.py` (append)

- [ ] **Step 1: Write the failing test** — append:

```python
async def test_run_tax_whatif_carries_a_sandbox_link_in_the_page_grammar(db):
    """The seam (spec §12): the compact result names the URL the drawer can open — the SAME
    scenario the tool just ran, in the whatif grammar, so the user lands on the live panel."""
    from app.seed import seed_tax_definitions

    db.add(TaxYear(year=2026))
    await seed_tax_definitions(db)
    await db.commit()
    result = await execute_tool(
        db,
        "run_tax_whatif",
        {"year": 2026, "overrides": {"qualified_dividends": "2500", "interest_total": None}},
    )
    assert "error" not in result, result
    assert result["sandbox_url"] == "/taxes?whatif=interest_total%3Anull&whatif=qualified_dividends%3A2500"


async def test_run_tax_whatif_empty_scenario_links_to_the_bare_page(db):
    db.add(TaxYear(year=2026))
    await db.commit()
    result = await execute_tool(db, "run_tax_whatif", {"year": 2026, "overrides": {}})
    assert result["sandbox_url"] == "/taxes"
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_sandbox_a <venv-python> -m pytest tests/test_assistant_tools.py -q -k sandbox`
Expected: FAIL — `KeyError: 'sandbox_url'`.

- [ ] **Step 3: Implement** — in `_run_tax_whatif`, add `from app.services.sandbox_links import sandbox_link, whatif_entries` beside the other local imports and add one key to the compact dict, after `"warnings": out.warnings,`:

```python
                # The seam (spec §12): where the drawer can open THIS scenario live. Encoded
                # from the validated body, so the link models exactly what was modelled.
                "sandbox_url": sandbox_link("taxes", whatif_entries(body)),
```

- [ ] **Step 4: Run**

Run: `FINANCE_TEST_DB=finance_test_sandbox_a <venv-python> -m pytest tests/test_assistant_tools.py -q`
Expected: all passed (the existing compact-shape test asserts a superset with `>=`, so the new key is fine).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/assistant_tools.py backend/tests/test_assistant_tools.py
git commit -m "feat(assistant): run_tax_whatif returns sandbox_url — the scenario as a /taxes?whatif= link"
```

---

### Task 3: `link` on the `tool_result` event

**Files:**
- Modify: `backend/app/services/assistant_chat.py`
- Test: `backend/tests/test_assistant_chat_api.py` (append)

- [ ] **Step 1: Write the failing test** — append (the file's helpers `_openai_stream`, `_tool_call_chunk`, `_finish`, `_delta`, `_transport`, `_collect`, `_events` and the autouse `_wire` fixture already exist):

```python
async def test_tool_result_carries_a_sandbox_link_for_a_what_if(monkeypatch, db):
    """spec §12: the tool_result frame gains `link` when the tool answered with a sandbox_url,
    so the drawer can render "Open in What-if →" under the chip. Tools without one emit no key."""
    from app.models import TaxYear
    from app.seed import seed_tax_definitions

    db.add(TaxYear(year=2026))
    await seed_tax_definitions(db)
    await db.commit()

    calls = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            chunk = _tool_call_chunk(
                "call_1", "run_tax_whatif", {"year": 2026, "overrides": {"qualified_dividends": "2500"}}
            )
            return httpx.Response(
                200,
                text=_openai_stream([chunk, _finish("tool_calls")]),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            text=_openai_stream([_delta("done"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    events = _events(
        await _collect(
            stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "what if I had 2500 of dividends?"}],
                context={"route": "/taxes", "search": {}, "view": {"year": 2026}},
            )
        )
    )
    assert [e for e, _ in events] == ["tool_start", "tool_result", "token", "done"]
    assert events[1][1] == {
        "name": "run_tax_whatif",
        "summary": "ok",
        "link": {"to": "/taxes?whatif=qualified_dividends%3A2500", "label": "Open in What-if →"},
    }


async def test_tool_result_without_a_sandbox_url_has_no_link_key(monkeypatch):
    calls = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(
                200,
                text=_openai_stream(
                    [_tool_call_chunk("call_1", "get_page_data", {"page": "/calendar"}), _finish("tool_calls")]
                ),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200, text=_openai_stream([_delta("ok"), _finish()]), headers={"content-type": "text/event-stream"}
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    events = _events(
        await _collect(
            stream_chat(model_key="kimi-k3", messages=[{"role": "user", "content": "q"}], context={"route": "/", "search": {}, "view": {}})
        )
    )
    assert events[1][1] == {"name": "get_page_data", "summary": "ok"}
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_sandbox_a <venv-python> -m pytest tests/test_assistant_chat_api.py -q -k "sandbox_link or without_a_sandbox_url"`
Expected: the first FAILS (no `link` key); the second passes already.

- [ ] **Step 3: Implement** — in `assistant_chat.py`, replace the `tool_result` emission:

```python
            payload: dict = {
                "name": call["name"],
                "summary": "error" if "error" in result else "ok",
            }
            # The sandbox seam (2026-09-03 planning-sandboxes spec §12): a tool that computed
            # a scenario names where the drawer can open it live. Only sandbox_links.py mints
            # these, so the path is allow-listed by construction; the client checks again.
            sandbox_url = result.get("sandbox_url")
            if isinstance(sandbox_url, str) and sandbox_url.startswith("/"):
                payload["link"] = {"to": sandbox_url, "label": "Open in What-if →"}
            yield sse("tool_result", payload)
```

- [ ] **Step 4: Run the chat suite**

Run: `FINANCE_TEST_DB=finance_test_sandbox_a <venv-python> -m pytest tests/test_assistant_chat_api.py tests/test_assistant_tools.py -q`
Expected: all passed (existing sequence asserts read event NAMES; the one that pins `events[1][1]["summary"] == "error"` still holds — an error result has no `sandbox_url`).

- [ ] **Step 5: Ruff, commit**

Run: `<venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests`

```bash
git add backend/app/services/assistant_chat.py backend/tests/test_assistant_chat_api.py
git commit -m "feat(assistant): tool_result carries link {to, label} when the tool answered with a sandbox_url"
```

---

### Task 4: The drawer chip

**Files:**
- Modify: `src/api/assistantStream.ts`, `src/api/assistantStream.test.ts`, `src/api/assistantSession.ts`, `src/components/assistant/AssistantDrawer.tsx`, `src/components/assistant/AssistantDrawer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/api/assistantStream.test.ts` (it already imports `streamChat`/`extractFrames` and mocks `fetch`; follow its existing `fetch` stub pattern, or use the one below):

```ts
it('passes a tool_result link through to onToolResult untouched', async () => {
  const body =
    'event: tool_result\ndata: {"name":"run_tax_whatif","summary":"ok","link":{"to":"/taxes?whatif=qualified_dividends%3A2500","label":"Open in What-if →"}}\n\n' +
    'event: done\ndata: {"model_used":"kimi-k3"}\n\n'
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))
  const onToolResult = vi.fn()
  const handle = streamChat(
    { model: 'kimi-k3', context: { route: '/taxes', search: {}, view: {} }, messages: [] },
    { onToolResult, onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
  )
  expect(await handle.finished).toBe('done')
  expect(onToolResult).toHaveBeenCalledWith({
    name: 'run_tax_whatif',
    summary: 'ok',
    link: { to: '/taxes?whatif=qualified_dividends%3A2500', label: 'Open in What-if →' },
  })
  vi.restoreAllMocks()
})
```

Append to `src/components/assistant/AssistantDrawer.test.tsx` (reuse the file's `mount`, `openDrawer` and `streamChat` mock):

```tsx
it('renders "Open in What-if →" under the tool chip as an internal link, for NAV paths only', async () => {
  streamChat.mockImplementation(
    (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
      h.onToolStart?.({ name: 'run_tax_whatif', summary: 'year=2026' })
      h.onToolResult?.({
        name: 'run_tax_whatif',
        summary: 'ok',
        link: { to: '/taxes?whatif=qualified_dividends%3A2500', label: 'Open in What-if →' },
      })
      h.onToolStart?.({ name: 'get_page_data', summary: 'page=/calendar' })
      h.onToolResult?.({ name: 'get_page_data', summary: 'ok', link: { to: 'https://evil.example/x', label: 'Open' } })
      h.onToken('Dividends of $2,500 would…')
      h.onDone({ model_used: 'kimi-k3' })
      return { abort: vi.fn(), finished: Promise.resolve('done' as const) }
    },
  )
  mount()
  const input = await openDrawer()
  fireEvent.change(input, { target: { value: 'what if?' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(screen.getByText(/Dividends of/)).toBeTruthy())
  const link = screen.getByRole('link', { name: 'Open in What-if →' })
  expect(link.getAttribute('href')).toBe('/taxes?whatif=qualified_dividends%3A2500')
  expect(screen.queryByRole('link', { name: 'Open' })).toBeNull()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/api/assistantStream.test.ts src/components/assistant/AssistantDrawer.test.tsx`
Expected: the stream test FAILS on the payload shape (the handler is typed without `link`; TypeScript rejects the assertion or the value is dropped); the drawer test FAILS — no link rendered.

- [ ] **Step 3: Implement**

`src/api/assistantStream.ts` — add the type and widen the handler:

```ts
/** Where a tool's answer can be opened live (2026-09-03 planning-sandboxes spec §12). The
 *  server only mints these for the three sandbox paths; the drawer allow-lists again. */
export interface ToolLink {
  to: string
  label: string
}

export interface ToolResultEvent {
  name: string
  summary: string
  link?: ToolLink
}
```

and in `AssistantHandlers`: `onToolResult?: (tool: ToolResultEvent) => void`; in `dispatchFrame`'s `tool_result` case: `handlers.onToolResult?.(payload as ToolResultEvent)`.

`src/api/assistantSession.ts` — `TranscriptTool` gains `link?: { to: string; label: string }` (a plain structural copy — the session module must not import from the stream module).

`src/components/assistant/AssistantDrawer.tsx` —

the updater:

```tsx
        onToolResult: (tool) =>
          patchAnswer((item) => ({
            ...item,
            tools: (item.tools ?? []).map((t) =>
              t.name === tool.name && !t.done
                ? { ...t, summary: tool.summary, done: true, ...(tool.link === undefined ? {} : { link: tool.link }) }
                : t,
            ),
          })),
```

a module-scope allow-list next to `pageLabel`:

```tsx
// Only NAV paths are ever rendered as links (audit §11 idea 8's allow-list rule): the path
// before any query must be one of the app's own routes, and it must be a same-origin path.
const NAV_PATHS = new Set(NAV_ITEMS.map((item) => item.to))
export function isNavLink(to: string): boolean {
  if (!to.startsWith('/') || to.startsWith('//')) return false
  const path = to.split('?')[0]
  return NAV_PATHS.has(path)
}
```

and the chip:

```tsx
                      {(item.tools ?? []).map((tool, t) => (
                        <span key={t} className="assistant-tool-chip">
                          <span aria-hidden="true">⚙</span> {tool.name}
                          {tool.done ? '' : '…'}
                          {tool.link !== undefined && isNavLink(tool.link.to) && (
                            <>
                              {' '}
                              <Link className="assistant-tool-link" to={tool.link.to}>
                                {tool.link.label}
                              </Link>
                            </>
                          )}
                        </span>
                      ))}
```

`src/components/assistant/assistant.css` — append:

```css
.assistant-tool-link {
  margin-left: 0.35rem;
  font-size: 0.78rem;
}
```

- [ ] **Step 4: Run**

Run: `npx tsc -b && npx vitest run src/api/assistantStream.test.ts src/api/assistantSession.test.ts src/components/assistant`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

Run: `npx eslint src/api/assistantStream.ts src/api/assistantSession.ts src/components/assistant`

```bash
git add src/api/assistantStream.ts src/api/assistantStream.test.ts src/api/assistantSession.ts src/components/assistant/AssistantDrawer.tsx src/components/assistant/AssistantDrawer.test.tsx src/components/assistant/assistant.css
git commit -m "feat(assistant): tool chips link into the sandbox ('Open in What-if →') for NAV paths only"
```

---

### Task 5: Suites

- [ ] **Step 1: Backend**

`FINANCE_TEST_DB=finance_test_sandbox_a <venv-python> -m pytest -q tests/test_sandbox_links.py tests/test_assistant_tools.py tests/test_assistant_chat_api.py && <venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests`

- [ ] **Step 2: Frontend**

`npx tsc -b && npx vitest run src/api src/components/assistant`

- [ ] **Step 3: Report** — the encoder's public names (`sandbox_link`, `whatif_entries`, `knob_entry`, `retire_entry` for the future `run_paycheck_preview` / `run_projection` tools) and that `viewState.ts` publishing of live entries is left to the grounding lane, per spec.

---

## Self-review

**Spec coverage:** §12 `sandbox_links.py` with `sandbox_link(page, entries)` allow-listed to the three paths and the §6 grammar → Task 1; the parity fixture mirrored on both sides → Task 1 (reads lane G's file); `sandbox_url` on `_run_tax_whatif`'s compact result → Task 2; `tool_result` gains `link?: { to, label }` → Task 3; `assistantStream.ts` passes it through; the drawer renders an internal `Link` "Open in What-if →" under the tool chip, NAV paths only → Task 4; future tools reuse the encoder (`knob_entry`, `retire_entry` provided); `viewState.ts` publishing deferred to the grounding lane (stated). §14 `test_assistant_tools.py`: `sandbox_url` matches the parity fixture encoder; a non-sandbox page is refused → Tasks 1–2. **Placeholders:** none. **Type consistency:** Python `sandbox_link(page: str, entries: list[str]) -> str`, `whatif_entries(body: WhatIfIn) -> list[str]`; TS `ToolLink`/`ToolResultEvent`, `TranscriptTool.link?`, `isNavLink(to)`; the SSE payload `{ name, summary, link? }` matches between `assistant_chat.py` and `assistantStream.ts`.
