import { Link } from 'react-router-dom'
import type { GuideCard } from '../types'
import { SettingsMapTable } from './settingsMap'

// Chapter: Reference — ref-typing · ref-keyboard · ref-undo · ref-sandboxes · ref-links ·
// ref-assistant · ref-glossary · ref-settings-map (2026-09-14 guide spec §5.1). Written by
// lane G4 from research §5.4; every rule here was read off the source that implements it
// (AmountInput, paste.ts, CommandPalette, LocalSections, ToastProvider, the sandbox modules,
// the assistant drawer) rather than from the specs that asked for it.
export const REFERENCE_CARDS: GuideCard[] = [
  {
    id: 'ref-typing',
    title: 'Typing numbers and moving between cells',
    purpose:
      'Every money box takes what a spreadsheet would, does simple arithmetic, and commits when you leave it.',
    keywords: ['typing', 'number format', 'arithmetic', 'paste'],
    tasks: [
      {
        id: 'typing-formats',
        title: 'Type a number the way you already have it',
        where: 'Any money box',
        steps: [
          'Accepted: a dollar sign, commas or spaces as grouping, a leading plus or minus, and accounting parentheses.',
          'Refused: exponents, a second decimal point, a sign inside parentheses.',
          'The box turns invalid until you fix it.',
          'Blank means not entered. It never means zero.',
        ],
        keywords: ['dollar sign', 'commas', 'negative', 'format'],
      },
      {
        id: 'typing-arithmetic',
        title: 'Add up inside a box',
        where: 'Any money box',
        steps: [
          'Start with an equals sign: =1200+34.56 commits as 1234.56 when you press Enter or leave the box.',
          'Money boxes only — shares, prices, percents and counts take plain numbers.',
        ],
        keywords: ['formula', 'sum', 'equals'],
      },
      {
        id: 'typing-move',
        title: 'Move between cells',
        where: 'Any wizard or tax entry form',
        steps: [
          'Focus selects the whole value, so typing replaces it.',
          'Enter commits and moves down; Shift+Enter moves up; the up and down arrows do the same.',
          'Enter on the last cell moves to the step’s button — Enter twice finishes it.',
          'Escape puts back the value the box held when you arrived.',
        ],
        keywords: ['enter key', 'next cell', 'keyboard entry'],
      },
      {
        id: 'typing-paste',
        title: 'Paste a column from a spreadsheet',
        where: 'Monthly update',
        steps: [
          'Paste a single column into a cell and it fills downward from there.',
          'Paste name-and-value rows and each lands by name.',
          'A name that matches nothing is reported, never guessed.',
          'Empty cells are skipped, never blanked; a line under the table counts what landed.',
        ],
        to: '/update',
        keywords: ['paste', 'clipboard', 'spreadsheet'],
      },
    ],
    watch: ['A ledger row keeps the browser’s own Enter — the cell-to-cell advance belongs to the wizard and the tax forms.'],
  },
  {
    id: 'ref-keyboard',
    title: 'Keyboard shortcuts',
    purpose:
      'Few and consistent: one for the palette, two to save, Escape to back out, arrows inside grids and tab strips.',
    keywords: ['keyboard', 'shortcuts', 'hotkeys'],
    tasks: [
      {
        id: 'keys-palette',
        title: 'Open the command palette',
        where: 'Any page',
        steps: [
          'Ctrl+K, or ⌘K on a Mac — the same keys close it.',
          'Up and down move, Enter runs, Escape closes.',
        ],
        keywords: ['ctrl k', 'command palette', 'search'],
      },
      {
        id: 'keys-save',
        title: 'Save without reaching for the mouse',
        where: 'Any wizard or tax entry form',
        steps: ['Ctrl+Enter or Ctrl+S presses that step’s own button — the browser’s save dialog never opens.'],
        keywords: ['ctrl enter', 'ctrl s', 'save shortcut'],
      },
      {
        id: 'keys-escape',
        title: 'Back out',
        where: 'Any page',
        steps: [
          'Escape closes the palette, a hint bubble, a popover, a day drawer and the assistant.',
          'It steps out one level at a time.',
        ],
      },
      {
        id: 'keys-tabs',
        title: 'Move between a page’s views',
        where: 'Any tab strip',
        steps: [
          'With a tab focused, left and right move and wrap; Home and End jump to the ends.',
          'The address changes without a new history entry.',
        ],
      },
      {
        id: 'keys-calendar',
        title: 'Move in the calendar grid',
        where: 'Calendar',
        steps: [
          'Left and right move a day; up and down move a week.',
          'Home and End reach the week’s ends.',
          'PageUp and PageDown change month; Enter or Space opens the focused day.',
        ],
        to: '/calendar',
      },
      {
        id: 'keys-skip',
        title: 'Skip the sidebar',
        where: 'Any page',
        steps: ['Tab once from the top of the page and press Enter on **Skip to content**.'],
      },
    ],
    watch: ['Ctrl+Enter and Ctrl+S reach the wizard and the tax forms; a ledger row keeps the browser’s Enter.'],
  },
  {
    id: 'ref-undo',
    title: 'Undo, snapshots, and what cannot be undone',
    purpose:
      'Three layers — the toast, the Activity log and snapshots — and a short list of things none of them reverses.',
    keywords: ['undo', 'safety', 'backup', 'restore'],
    tasks: [],
    // The five layers as fact tiles (2026-09-15 polish spec §5.3): each bullet's bold lead is
    // the tile's heading, the sentences under it unchanged.
    body: (
      <div className="guide-facts">
        <div className="guide-fact">
          <h4>The toast</h4>
          <p>
            Most saves and deletes raise one for six seconds carrying <b className="guide-label">Undo</b>;
            the clock pauses while your pointer or your focus is on it.
          </p>
        </div>
        <div className="guide-fact">
          <h4>The Activity log</h4>
          <p>
            <Link to="/settings?section=data#activity">Settings → Data → Activity</Link> lists every
            money-bearing change, newest first, with <b className="guide-label">Undo</b> — press once to
            arm, again to fire — for as long as nothing later touched the same rows.
          </p>
        </div>
        <div className="guide-fact">
          <h4>Snapshots</h4>
          <p>
            The app writes one nightly at 23:30 PT and keeps the newest fourteen; press{' '}
            <b className="guide-label">Snapshot now</b> before an import or a big edit. A{' '}
            <Link to="/settings?section=data#restore">restore</Link> writes a pre-restore point first, so
            the step back is one more restore.
          </p>
        </div>
        <div className="guide-fact">
          <h4>Typed confirmations</h4>
          <p>
            Deleting a month asks you to type the month as YYYY-MM; restoring asks for the snapshot&apos;s
            date.
          </p>
        </div>
        <div className="guide-fact">
          <h4>Never undone</h4>
          <p>
            A revoked calendar feed link, and the sign-outs a password change causes. An import or a restore
            is undone only by restoring a snapshot.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'ref-sandboxes',
    title: 'Trying things without saving',
    purpose:
      'Three sandboxes answer what-if questions from live data. The address bar holds the scenario, and nothing writes.',
    keywords: ['sandbox', 'what if', 'scenario', 'try changes'],
    tasks: [],
    // Five facts, one tile each (2026-09-15 polish spec §5.3).
    body: (
      <div className="guide-facts">
        <div className="guide-fact">
          <h4>The three sandboxes</h4>
          <p>
            <Link to="/paycheck?section=changes">Paycheck → Try changes</Link>,{' '}
            <Link to="/taxes?section=whatif">Taxes → What-if</Link> and{' '}
            <Link to="/projection">Projection</Link>&apos;s planning assumptions — the{' '}
            <Link to="/guide?section=pages#page-projection">Projection card</Link> in this guide walks the
            third.
          </p>
        </div>
        <div className="guide-fact">
          <h4>The scenario rides in the address</h4>
          <p>
            The live scenario rides in the address as repeated <code>whatif=</code> entries, so{' '}
            <b className="guide-label">Copy link</b> hands someone the same run, and Back leaves the page
            instead of replaying every slider move.
          </p>
        </div>
        <div className="guide-fact">
          <h4>Pinning</h4>
          <p>
            <b className="guide-label">Pin this scenario</b> keeps at most three per page in this browser —
            the knobs only. A pin re-runs against live data at every visit and is never part of a link.
          </p>
        </div>
        <div className="guide-fact">
          <h4>Resetting</h4>
          <p>
            <b className="guide-label">Reset to actual</b>, or{' '}
            <b className="guide-label">Reset to baseline</b> on Projection, clears the scenario.
          </p>
        </div>
        <div className="guide-fact">
          <h4>The doors out</h4>
          <p>
            Nothing in a sandbox writes. The doors out are explicit and few: Paycheck fills in the profile
            form and you press its own <b className="guide-label">Add profile</b>; Taxes writes input
            overrides after showing you before and after; Projection has no apply at all.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'ref-links',
    title: 'Every view has a link',
    purpose:
      'The address carries the view, the month, whose figures, the window and any scenario — copy it to share exactly what you are looking at.',
    keywords: ['link', 'url', 'share', 'deep link'],
    tasks: [],
    // Four facts, one tile each (2026-09-15 polish spec §5.3).
    body: (
      <div className="guide-facts">
        <div className="guide-fact">
          <h4>The view and the month</h4>
          <p>
            <code>?section=</code> is the view on a tabbed page; <code>?month=YYYY-MM</code> is the month on
            pages that carry a month ribbon.
          </p>
        </div>
        <div className="guide-fact">
          <h4>Whose figures and the window</h4>
          <p>
            <code>?owner=</code> is whose figures — everyone, joint, or one person; <code>?range=</code> is
            the window. Owner and window are remembered as you move between pages; the month is not.
          </p>
        </div>
        <div className="guide-fact">
          <h4>Settings cards and scenarios</h4>
          <p>
            On <Link to="/settings">Settings</Link>, <code>#card</code> opens the tab that holds the card and
            rings it. <code>whatif=</code> carries a sandbox scenario.
          </p>
        </div>
        <div className="guide-fact">
          <h4>Back and Forward</h4>
          <p>Back and Forward restore the view, the month, the owner and the selection.</p>
        </div>
      </div>
    ),
  },
  {
    id: 'ref-assistant',
    title: 'Asking the assistant',
    purpose:
      'An analyst that answers from your own figures: it reads the page you are on, cites what it used, and links back to it.',
    keywords: ['assistant', 'ai', 'chat', 'ask'],
    tasks: [
      {
        id: 'assistant-open',
        title: 'Open the assistant',
        where: 'Any page',
        steps: [
          'Press the ✦ button at the bottom right, or run **Ask assistant** from the command palette.',
          'Escape closes it and hands focus back to where you were.',
        ],
        keywords: ['open assistant', 'chat', 'ai'],
      },
      {
        id: 'assistant-ask',
        title: 'Ask a question about what you see',
        where: 'Assistant → Conversation',
        steps: [
          'Type the question in the box at the bottom and press **Send**.',
          'It knows the page you are on and the month, owner or year selected.',
          'The strip above says **Context:** in words; open it to see the rows.',
          'Press a figure in an answer for its evidence, then follow the source link back.',
        ],
        keywords: ['ask', 'question', 'explain', 'why did'],
      },
      {
        id: 'assistant-presets',
        title: 'Use a preset instead of typing',
        where: 'Assistant → Conversation',
        steps: [
          '**Month in review**, **What changed in my spending?** and **Contribution-limit pace** are on every page.',
          'Some pages add a starter of their own — the answer is computed first, then written up.',
        ],
        keywords: ['preset', 'month in review'],
      },
      {
        id: 'assistant-findings',
        title: 'Keep an answer',
        where: 'Assistant → Saved findings',
        steps: [
          'Press **Save finding** under an answer — it keeps the words and the figures behind them.',
          'They live under **Saved findings**; **Remove saved finding** drops one.',
        ],
        keywords: ['save finding', 'keep answer', 'findings'],
      },
      {
        id: 'assistant-key-pointer',
        title: 'Set up the key',
        where: 'Settings → Integrations → Assistant',
        steps: ['The key and the model live on the **Assistant** card — the Settings card in this guide walks it.'],
        to: '/settings?section=integrations#assistant',
      },
    ],
    watch: [
      'Asking sends the figures behind your question to the provider under your key.',
      'A saved finding keeps the figures as they were — open its source to see them now.',
    ],
  },
  {
    id: 'ref-glossary',
    title: 'Words this dashboard uses',
    purpose: 'The terms that appear on tiles, receipts and badges, in one place.',
    keywords: ['glossary', 'definitions', 'terms', 'what does mean'],
    tasks: [],
    body: (
      <dl className="guide-body guide-glossary guide-glossary-grid">
        <dt>Living spending</dt>
        <dd>
          Spend in categories of kind Living — the lifestyle figure the budgets, the savings rate and the
          projection use.
        </dd>
        <dt>Tax paid from take-home · Transfers · Cash outflow</dt>
        <dd>
          Payments in Tax and in Transfer categories, always shown apart from living spend. Cash outflow
          is living plus tax, transfers excluded.
        </dd>
        <dt>Cash saved · Savings rate — cash</dt>
        <dd>
          Take-home minus living spend and tax paid, as an amount and as a share of take-home. The total
          rate counts payroll deductions as well.
        </dd>
        <dt>Typical</dt>
        <dd>The median of a category&apos;s three most recent entered months, shown beside the month you are entering.</dd>
        <dt>Eligible months</dt>
        <dd>
          The entered months inside the previous twelve calendar months, excluding the one you are
          looking at. A month nobody entered lowers the count rather than pulling in an older one.
        </dd>
        <dt>Not started · In progress · Ready to review · Reviewed · Changed since review · Not yet reviewed</dt>
        <dd>
          A month&apos;s review state. Only a reviewed month counts as complete; editing one afterwards
          makes it changed since review; data that predates reviewing reads as not yet reviewed.
        </dd>
        <dt>Snapshot</dt>
        <dd>
          One month&apos;s balances, one row per account, written by the monthly update. Also the export
          ZIP of everything, written nightly — the Backups card means this one.
        </dd>
        <dt>Derived parent · component account</dt>
        <dd>A parent whose balance is the sum of its components: you type the components, the parent is read-only.</dd>
        <dt>Retired</dt>
        <dd>Kept with its history but out of the monthly update and the charts. Delete is only for things with no history.</dd>
        <dt>Signed liabilities</dt>
        <dd>Card and loan balances are stored negative, so net worth is a plain sum.</dd>
        <dt>Effective-dated budget</dt>
        <dd>A budget applies from its month forward; the month on screen resolves to the latest row at or before it.</dd>
        <dt>Basis: confirmed · scheduled · estimated · your figure</dt>
        <dd>How sure a calendar amount is. Your figure replaces the estimate with what you actually paid.</dd>
        <dt>Qualifying date · bargain element</dt>
        <dd>When an ESPP lot becomes a qualifying disposition; the discount and lookback gain at purchase.</dd>
        <dt>Focal year</dt>
        <dd>The review year a grant or a raise belongs to — the column Focal history is keyed by.</dd>
        <dt>Marginal rate · effective rate · safe harbor</dt>
        <dd>What the next dollar costs; tax over its base; the withholding floor that avoids a penalty.</dd>
        <dt>FI target · FI ratio · withdrawal rate</dt>
        <dd>
          Annual spend divided by the withdrawal rate; the investable balance against that target; the
          yearly share of the portfolio you plan to draw.
        </dd>
        <dt>FI date · 1 in 10, half, 9 in 10 paths</dt>
        <dd>
          The month half of Projection&apos;s simulated paths first reach the FI target, with the months
          the earliest tenth and nine tenths of paths get there.
        </dd>
        <dt>Money lasts · plan until</dt>
        <dd>
          The share of simulated paths whose balance lasts through December of the plan-until year once
          withdrawals start after the last retirement; &ldquo;in 9 of 10 paths&rdquo; names the year the
          unluckiest tenth run out.
        </dd>
        <dt>Today&apos;s dollars · future dollars</dt>
        <dd>A display choice on Projection. Dates, probabilities and targets do not move with it.</dd>
        <dt>Weekly performance point</dt>
        <dd>One portfolio value a week, recorded by the Monday price refresh, behind the performance chart.</dd>
      </dl>
    ),
  },
  {
    id: 'ref-settings-map',
    title: 'Where to configure X',
    purpose: 'Every Settings card, by the job it does.',
    keywords: ['settings map', 'where is', 'configure'],
    tasks: [],
    body: <SettingsMapTable />,
  },
]
