# AI Assistant (build.nvidia.com) — Design Spec

**Date:** 2026-09-01 · **Status:** approved (user Q&A 2026-09-01); not yet implemented
**Touches:** new backend router (`api/assistant.py`), new services (`services/assistant_models.py`, `services/assistant_context.py`, `services/assistant_tools.py`, `services/assistant_chat.py`), `config.py` (+3 optional env keys), two new `app_settings` rows, `api/export.py` (redaction), **one new backend dependency (`httpx`)**; frontend: `AssistantDrawer` + floating button mounted in `Layout`, `useAssistantView` hook, SSE fetch helper, sanitizing markdown renderer, Settings "Assistant" card, CommandPalette entry; `.env.example` ×2, `docker-compose.prod.yml` (one optional env), README addendum. **No migration** — storage rides the existing `app_settings` table.

## 1. Context & goals

The 2026-09-01 audit's #2 finding: the dashboard's attention layer is operational (stale quotes, missing months), never financial — nothing *interprets* the data. This feature adds a chat assistant that does, powered by NVIDIA's API catalog (`integrate.api.nvidia.com`, OpenAI-compatible), grounded in the app's own data so it answers faithfully rather than plausibly.

Two properties of this app make a faithful assistant cheap where it is usually expensive:

- **The data grain is small.** Monthly totals, ~37 snapshots, ~25 accounts, ~22 holdings, per-year tax summaries — a page's complete ground truth serializes to a few KB. Whole-truth context injection replaces RAG entirely: no embeddings, no vector store, no staleness.
- **The hard math is already deterministic.** Movers, YTD stats, marginal ladders, withholding projections, and the tax what-if engine already exist as services. The model narrates and cites engine output; it is never the calculator.

### User-confirmed decisions (2026-09-01 Q&A)

- **Capabilities:** context-grounded Q&A **plus read-only tools** — cross-page data fetch and the tax what-if engine (§7). No UI actions, no writes.
- **History:** session-only (sessionStorage), cleared on logout. No DB table.
- **Insights:** curated **quick-action prompts inside the chat** ("Month in review", …). The standalone Overview digest card is explicitly deferred (§13).
- **Form factor:** right-side **drawer** (~400 px), page stays visible and interactive; floating `✦` button bottom-right toggles it.
- **Loop architecture:** server-side agent loop, SSE-streamed (§2).
- **API key:** env var `NVIDIA_API_KEY` as the deploy-time baseline, overridable from Settings; precedence override → env → unset (§3). Key set at container **runtime** (compose `environment:`), never baked into an image.
- **Models:** `kimi-k3` (default), `deepseek-v4-pro-0813`, `nemotron-3-ultra-550b`, `nemotron-3.5-lightning`, user-switchable per conversation, registry-driven (§4).

## 2. Architecture — server-side loop over SSE

One endpoint holds one connection per user message. The backend calls NVIDIA, executes any tool calls in-process against the same service functions the routers use, re-prompts, and streams typed events to the browser. The client renders events and never sees the key. Rejected alternatives: client-orchestrated tool loop (N round trips, tool schemas duplicated in TS, streaming/tool interleave in the browser is the bug farm) and non-streaming JSON (10–30 s spinner chat).

The browser client is `fetch` + `ReadableStream`, **not** `EventSource` — EventSource cannot send the Authorization header or a POST body. A dedicated streaming helper sits beside `client.ts` (whose JSON-only 15 s `api()` is deliberately not reused); it parses SSE frames and exposes an `AbortController` for Stop.

**Proxy survival (verified against `nginx.conf` 2026-09-01):** the `/api/` block has default buffering ON and default `proxy_read_timeout` (60 s). Two app-level measures, zero nginx changes: the SSE response sets `X-Accel-Buffering: no` (nginx honors it per-response) + `Cache-Control: no-cache`, and the stream emits an SSE comment (`: ping`) every ~15 s while waiting on the model or a tool, so no 60 s byte gap ever occurs. Both also cover the Vite dev proxy.

## 3. API key — two sources, one precedence

**Effective key = Settings override → `NVIDIA_API_KEY` env → unset.** The env value is a live fallback, never copied into the DB: rotating it in `.env` + restart behaves like every other env secret. The override is an `app_settings` row (`nvidia_api_key`, readers' `{"value": ...}` envelope), written only from the Settings card.

- **`GET /api/v1/assistant/settings`** (all `/assistant/*` endpoints share the router-level auth dependency) → `{key: {configured: bool, source: "env" | "override" | null}, default_model: str}`. The key value itself **never** crosses to the browser; "pre-populated with `*`" is a UI state driven by `configured`/`source`, not a masked echo.
- **`PUT /api/v1/assistant/settings`** → `{api_key?: string | null, default_model?: string}` — tri-state on `api_key` (the wizard's `net_pay` rider precedent): absent = unchanged, `null`/empty = clear the override (falling back to env if present), non-empty string = set. `default_model` must name a registry key (422 otherwise). Own endpoints on the assistant router, deliberately **not** folded into the existing full-form `PUT /settings` — that contract re-sends all values every save, which cannot express a write-only secret.
- **Settings card UX (§10):** unset → empty field; configured → `••••••••` + a source badge ("from .env" / "set here"); an override masking an env key gets a "Revert to .env key" affordance; **Test key** probes live (§4) and names the source it tested.
- **Export redaction:** `api/export.py` currently serializes the whole `app_settings` table into every export ZIP — the `nvidia_api_key` row is **dropped** from both `app_settings.csv` and `finance-export.json`, and `manifest.json` notes the exclusion. The existing export test that pins table contents is extended to pin the redaction.
- **At-rest posture (decided, not deferred):** the override is stored **plaintext**. Verified 2026-09-01: neither `cryptography` nor any symmetric-crypto capable dependency is in `requirements.txt` (PyJWT is standalone), so encryption would mean a new dependency for a free-tier API key sitting in a database whose nightly dump already carries every financial figure the household has. Mitigations that do exist: env-first guidance (README + card copy name `.env` as the recommended home), export-ZIP redaction, and `BACKUP_PASSPHRASE` already encrypts dumps for anyone who wants it. Revisit only if the app ever grows a second user.
- **Config additions (`config.py`):** `nvidia_api_key: str | None = None`; `nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"` (tests point it at a mock; never user-facing); `nvidia_ca_bundle: str | None = None` — this dev box sits behind a TLS-intercepting proxy (the `yfinance_ca_bundle` precedent), so the httpx client takes `verify=nvidia_ca_bundle or True`; prod leaves it unset.

## 4. Model registry, availability, failover

`services/assistant_models.py` holds the registry as data:

| registry key | label | default | notes |
|---|---|---|---|
| `kimi-k3` | Kimi K3 | ✓ | |
| `deepseek-v4-pro-0813` | DeepSeek V4 Pro | | |
| `nemotron-3-ultra-550b` | Nemotron 3 Ultra 550B | | |
| `nemotron-3.5-lightning` | Nemotron 3.5 Lightning | | fastest — the failover ladder's last resort |

Each entry: `{key, catalog_id, label, supports_tools: bool, blurb}`. **`catalog_id` values and `supports_tools` flags are resolved at implementation time against the live `GET {base}/v1/models` with the real key** — all four models postdate the spec author's knowledge; the registry makes a catalog rename a one-line edit, and an entry the catalog doesn't list is shown as unavailable rather than crashing a send.

- **`GET /api/v1/assistant/models`** → `{configured: bool, key_source, checked_at, models: [{key, label, available, supports_tools, default}]}`. Availability comes from NVIDIA's models list, cached in-process ~1 h; `?probe=1` bypasses the cache and hits NVIDIA live (the Test-key button and the drawer's retry path). Unconfigured key → `configured: false`, all models `available: false`, no NVIDIA call.
- **Failover ladder (chat, §5):** on a retriable failure (connect error, timeout, 5xx, model-not-found) **before any content token has been forwarded**, retry the same request on the next available registry model and emit a `notice` event — the UI renders "answered by Nemotron 3.5 Lightning — Kimi K3 was unavailable". Never silent. Non-retriable: NVIDIA 401 (key problem — switching models can't help), 400 (payload), 429 (key-level quota — surfaced with `retry_after` and a worded suggestion to switch models manually). Failure **after** tokens streamed → `error` event; the UI keeps the partial text, marks it interrupted, and offers "Retry with ⟨next model⟩".

## 5. Chat endpoint

**`POST /api/v1/assistant/chat`** (the assistant router is auth-gated like every router; slowapi `20/minute` — generous for a human, a wall for a runaway loop):

```
{model: "kimi-k3", context: {route: "/spending", search: {...}, view: {...}}, messages: [{role, content}, ...]}
```

Stateless server: the client re-sends the transcript (capped: last 20 messages, each ≤ 8 k chars; 422 beyond). `model` must be a registry key. Response is `text/event-stream`:

| event | data | meaning |
|---|---|---|
| `notice` | `{kind: "failover", from, to}` | model switched before content |
| `tool_start` | `{name, summary}` | e.g. `{"run_tax_whatif", "sell 200 NVDA in 2026"}` — the UI's ⚙ chip |
| `tool_result` | `{name, summary}` | one-line outcome |
| `token` | `{text}` | content delta, forwarded as received |
| `done` | `{model_used}` | terminal |
| `error` | `{kind, message, retry_after?}` | terminal; `kind ∈ bad_key · rate_limited · unavailable · bad_request · internal` |

plus `: ping` comments every ~15 s during quiet spans (§2). Loop budget: **max 4 model rounds** (≤ 3 tool rounds + the answer), ≤ 6 tool executions total, ~90 s overall; exceeding any budget ends the stream with a worded `error`, never a hang. httpx client: connect timeout 10 s, streaming read per-chunk, one client instance per process. If the chosen model has `supports_tools: false`, the request omits tool schemas and the system prompt notes the reduced mode (§8) — context-only Q&A still works.

Error mapping is exact: NVIDIA 401 → `bad_key` ("API key was rejected — check it in Settings"; the UI deep-links `/settings`); 429 → `rate_limited` with `Retry-After` when present; connect/5xx/timeout after the ladder is exhausted → `unavailable` naming every model tried.

## 6. Context assembly — server-side, mirrors the screen

`services/assistant_context.py`: a route → builder map producing **compact JSON from the existing service/router layer** (never raw ORM dumps, never the frontend uploading data the backend already owns). The client sends only `{route, search, view}`; the backend rebuilds what that screen shows.

Every request gets the **household summary**: people, latest net-worth total + MoM + month, portfolio market value + day change + `as_of`, latest spending month + total + savings rate, current tax year gross/total/effective, today's date. Then the route bundle:

| route | bundle (beyond the household summary) |
|---|---|
| `/` | up-next events, money-flow summary (attention is client-side math; the household summary already carries its freshness feed) |
| `/net-worth` | monthly group-total series, latest per-account table (name, group, balance, MoM); honors `view.owner`/`view.granularity` |
| `/portfolio` | holdings rows (ticker, shares, price, value, weight, unrealized, yield, income), totals, allocation splits, realized summary, last-12 dividends, refresh status; honors `view.owner`, `view.detailTicker`. **Excludes** price history and sparklines |
| `/spending` | month list, per-category monthly series + budgets, focused-month movers, yearly rollups, net-pay + savings-rate series; focused month from `search.month` |
| `/credit-cards` | cards (fees, currencies, limits), best-card matrix summary, est. $/yr, credits |
| `/paycheck` | current profile(s), per-check breakdown, contribution pace vs entered limits; honors `view.person` |
| `/comp` | focal-year table, computed comp series, grants + priced vesting schedule |
| `/espp` | lots, offerings, modeler rows, $25k-limit numbers |
| `/taxes` | selected year (`view.year`) summary by jurisdiction, inputs as label/value pairs, bracket tables, marginal ladder, filing status; withholding outlook when it is the current year |
| `/projection` | assumptions, FI target/ratio/date, percentile bands decimated to yearly points |
| `/calendar` | next 60 days of events |
| `/update` | prior-month balances, coverage, typical-spend values — with a worded note that **unsaved wizard entries are client-side drafts the assistant cannot see** |

**`GET /api/v1/assistant/context-preview?route=…`** runs the same builders and returns a summarized outline (section names + row counts, no values) — the drawer's "what the assistant can see" expander (§9) reads it, so the transparency chip can never drift from what chat actually sends.

**Size discipline:** each bundle serializes under a per-route char cap (~50 k chars total request); a builder over cap truncates oldest months first and appends a `"truncated": …` marker so the model knows. Freshness stamps (`prices as of …`, `net worth through …`) ride inside the JSON — the model is instructed to caveat exactly the way the UI footer does.

**`useAssistantView` (frontend):** a module-singleton registry + hook. Pages whose view state is not in the URL publish it — Taxes `{year, filingStatus}`, NetWorth/Portfolio `{owner, …}` — one hook call per page; unmount clears. The drawer snapshots `{route, search, view}` at send time, so every message is answered against what the user was actually looking at.

## 7. Tools — three, read-only

`services/assistant_tools.py`, OpenAI function-calling schemas, executed in-process on the request's session:

1. **`get_page_data(page, params?)`** — any §6 bundle by route name (`params`: `year`, `month`, `owner`, `ticker`). One tool covers every cross-page question; small schema surface.
2. **`get_month_detail(month)`** — one spending month: category breakdown, movers, budgets, net pay.
3. **`run_tax_whatif(year, legs)`** — wraps the existing what-if service (`POST /taxes/what-if` semantics: sale / ESPP-sale / override legs, ≤ 20). The engine already never persists anything — the tool inherits read-only for free, and "what if I sell 200 NVDA?" is deterministic math, narrated.

Tool results are the builders' own compact JSON, capped (~20 k chars each, truncation-marked). Unknown tool name or invalid args → an error **result** back to the model (it can correct itself), never a stream failure.

## 8. System prompt discipline

Assembled per request: the assistant is this dashboard's analyst; **answer only from the provided context and tool results — never from general knowledge of markets or tax law beyond naming concepts**; figures quoted verbatim with their month/year; when the data doesn't contain the answer, say so and name which page or tool would; today's date + freshness stamps, with staleness caveated like the UI does; currency formatting matching the app; concise by default, tables for multi-row comparisons; the user's own data — analysis, not licensed financial advice, without nagging disclaimers on every message; in tool-less mode (§5), a line noting cross-page questions need a model that supports tools.

## 9. Frontend — drawer, button, streaming UI

**`✦` floating button** (bottom-right, fixed, hidden on `/login`): `aria-label="Open assistant"`, `aria-expanded`, toggles the drawer. **`AssistantDrawer`** mounts in `Layout` beside `CommandPalette`:

- **Non-modal panel** (~400 px, full-height, `position: fixed; right: 0`, overlays content without reflow — charts keep their size). `role="complementary"`, `aria-label="Assistant"`. Open moves focus to the input; **Esc closes and returns focus to the button; no focus trap** — the page staying interactive is the point (CommandPalette's dialog contract deliberately does *not* apply). Slide-in honors `prefers-reduced-motion`. At phone widths the drawer goes full-width.
- **Header:** title, **model dropdown** (registry labels; unavailable models greyed with a title reason; selection persisted), new-chat, close.
- **Context chip:** "Seeing: Spending — Dec 2025 · All owners", with an expander listing exactly what the current context bundle contains (section names + row counts, from a tiny `GET /assistant/context-preview` — same builders, summarized). Context transparency is the feature's cheapest trust win.
- **Empty state:** if no key is configured, a friendly setup note linking to Settings (the button stays visible — discoverability). Otherwise per-route **sample chips** plus the global **insight presets**: "Month in review", "What changed in my spending?", "Am I on pace for my contribution limits?" — each a curated prompt through the normal pipeline. Samples per route live in one registry file beside the drawer.
- **Transcript:** `role="log"` (implicit polite announcements); user/assistant bubbles; assistant text rendered by a **hand-rolled sanitizing markdown renderer** (bold, italic, inline/fenced code, ordered/unordered lists, headings, pipe tables; everything HTML-escaped; links/images rendered as plain text — no model-driven navigation in v1; no new dependency, matching the hand-rolled-palette culture). Tool activity renders as inline ⚙ chips from `tool_start`/`tool_result`. Streaming shows a Stop button (aborts the fetch; partial text kept, marked "stopped").
- **Errors:** `bad_key` → message + Settings link; `rate_limited` → countdown from `retry_after` + "try Nemotron 3.5 Lightning"; `unavailable` → "Retry with ⟨next model⟩" button; failover `notice` → a muted line above the answer. The composed-but-unsent question is never lost — send failures restore it to the input.
- **Persistence:** sessionStorage `assistant:transcript` + `assistant:model` (one continuous conversation across routes; each message is answered under the route it was sent from). Cleared at both places snapshots are cleared today — `AuthContext.logout` and the 401 path in `client.ts`.
- **CommandPalette:** one new action, "Ask assistant" (opens the drawer, focuses the input).

## 10. Settings — "Assistant" card

New card on `/settings` (own save, like every card there): masked key field with the §3 states + source badge + revert affordance; default-model select (registry); **Test key** button → `GET /assistant/models?probe=1` → per-model ✓/✗ list naming the tested source; the privacy sentence, verbatim: *"When you use the assistant, the relevant figures from your dashboard (balances, spending, tax numbers) are sent to NVIDIA's API under this key."*; a hint that `.env`'s `NVIDIA_API_KEY` is the recommended home for the key on the server.

## 11. Deploy & docs

- `.env.example` (root) + `backend/.env.example`: `NVIDIA_API_KEY=` (optional, commented) — and `NVIDIA_CA_BUNDLE` noted as dev-box-only in the backend example.
- `docker-compose.prod.yml` backend `environment:` gains `NVIDIA_API_KEY: ${NVIDIA_API_KEY:-}` — optional, **no** `:?` guard: the app boots and runs fully without it; only the assistant reports unconfigured.
- README: one row in the Part 3.2 `.env` table + a short assistant subsection (what it is, env-vs-Settings precedence, free-tier rate-limit note); Part 7.6 addendum noting **zero migrations** and the spot-check (open drawer, ask one question).
- `requirements.txt`: `httpx` (exact pin chosen at implementation; 0.28.x known-good as of spec date).

## 12. Testing

- **pytest:** settings GET/PUT (tri-state key semantics; precedence override→env→unset; **the key value never appears in any response body**); export redaction (row dropped, manifest notes it — extends the pinned-table test); registry availability + probe against `httpx.MockTransport`; chat SSE framing end-to-end against a fake NVIDIA transport streaming OpenAI-format chunks (token events, done, keepalives present); tool loop (scripted model requests `get_month_detail` then answers — events in order, result capped); failover ladder (first model 502 → `notice` + second model answers; 401 → `bad_key`, no ladder; 429 → `rate_limited` + retry_after); budgets (5th round refused; oversized transcript 422); every §6 builder (shape, caps, `view` params honored, truncation marker).
- **vitest:** drawer open/close/focus/Esc/aria + reduced-motion; ✦ button states; sessionStorage persist/restore + logout clear at both call sites; streaming consumption over a mocked ReadableStream (accumulation, tool chips, stop-abort keeps partial text, every error state renders its affordance); failover notice line; markdown renderer table (each construct + HTML-escape pins); per-route sample chips; context chip + expander; Settings card states (blank / env badge / override badge / revert / probe results); palette entry.
- **Live smoke (manual, needs a real key):** probe lists the four models; one question on `/spending` whose answer must contain a figure from the context; one `run_tax_whatif` question cross-checked against the What-if panel's own numbers.

## 13. Explicitly not in v1

No persisted chat history; no Overview auto-digest card (the "Month in review" preset delivers the value — the card is a fast-follow on this plumbing); no model-driven navigation, form-filling, or writes of any kind; no redaction/anonymization mode (it would undermine the faithfulness that justifies the feature — the §10 sentence covers informed consent); no temperature/system-prompt knobs; no encryption-at-rest for the key override (§3, decided with rationale); no markdown links/images.

## 14. Resolved at implementation time

Exact `catalog_id` strings and `supports_tools` flags via live `GET /v1/models` (all four models postdate the spec author's knowledge cutoff); the `httpx` pin; any per-model request quirks NVIDIA's catalog documents (some models take extra body params — verify per model); whether the dev box needs `NVIDIA_CA_BUNDLE` (same TLS-intercepting proxy that required `YFINANCE_CA_BUNDLE`).
