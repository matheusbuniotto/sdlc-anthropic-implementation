// Ledger tab: the audit trail, newest first, with filter chips, a run filter,
// a search field where the surface has Input, and the AUDIT.md export.

import type { RenderElement } from 'claude-code'

import type { LedgerEntry, LedgerFilter, LedgerKind } from '../../types'
import { blank, btn, flow, line, para, rule, type Ctx, type Item } from './kit'
import { C, clip, dayLabel, dim, hhmm, ledgerColor, ledgerIcon, pad, plural, strong } from './theme'

export const LEDGER_FILTERS: { id: string; label: string; kinds: LedgerKind[] | null }[] = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'gates', label: 'Gates', kinds: ['stage.entered', 'gate.opened', 'gate.approved', 'gate.rejected', 'release.granted', 'release.revoked'] },
  { id: 'guards', label: 'Guards', kinds: ['guard.blocked'] },
  { id: 'proof', label: 'Proof', kinds: ['proof.pass', 'proof.fail', 'agent.verdict'] },
  { id: 'autopilot', label: 'Autopilot', kinds: ['autopilot.queued', 'autopilot.halted'] },
  { id: 'bands', label: 'Bands', kinds: ['band.sample', 'band.breach', 'incident.intent'] },
]

const MAX_ROWS = 40

function sameKinds(a: LedgerKind[] | null, b: LedgerKind[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every(k => b.includes(k))
}

export function applyLedgerFilter(entries: LedgerEntry[], f: LedgerFilter): LedgerEntry[] {
  const q = f.query.trim().toLowerCase()
  return entries
    .filter(e => (f.kinds === null || f.kinds.includes(e.kind)) && (f.run === null || e.run === f.run))
    .filter(e => q === '' || `${e.summary} ${e.kind} ${e.actor} ${e.run ?? ''}`.toLowerCase().includes(q))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.ts - a.e.ts || b.i - a.i)
    .map(x => x.e)
}

const ACTOR_COLOR = { human: C.human, agent: C.active, mod: C.dim } as const

function toolbar(ctx: Ctx): RenderElement[] {
  const { vm, ui, act, w, el } = ctx
  const f = ui.ledgerFilter
  const items: Item[] = LEDGER_FILTERS.map(c =>
    btn(ctx, {
      key: `ledger:filter:${c.id}`,
      label: c.label,
      primary: sameKinds(f.kinds, c.kinds),
      onPress: () => act.setLedgerFilter({ ...f, kinds: c.kinds }),
    }),
  )
  const at = LEDGER_FILTERS.findIndex(c => sameKinds(f.kinds, c.kinds))
  items.push(
    btn(ctx, {
      key: 'ledger:cycle',
      label: 'cycle',
      plain: true,
      hotkey: 'f',
      hint: 'filter',
      onPress: () => act.setLedgerFilter({ ...f, kinds: LEDGER_FILTERS[(at + 1) % LEDGER_FILTERS.length]?.kinds ?? null }),
    }),
  )
  const rows = flow(ctx, items, w)

  const second: Item[] = []
  if (vm.runs.length > 0) {
    const slugs = [null, ...vm.runs.map(r => r.slug)]
    const next = slugs[(slugs.indexOf(f.run) + 1) % slugs.length] ?? null
    second.push(
      btn(ctx, {
        key: 'ledger:run',
        label: `run: ${f.run ? clip(f.run, 24) : 'all'}`,
        hotkey: 'u',
        hint: 'run filter',
        onPress: () => act.setLedgerFilter({ ...f, run: next }),
      }),
    )
  }
  second.push(btn(ctx, { key: 'ledger:export', label: 'e Export AUDIT.md', hotkey: 'e', hint: 'export', onPress: () => act.exportAudit() }))
  rows.push(...flow(ctx, second, w, 2))

  const { Input } = el
  if (Input) {
    rows.push(
      <Input key="ledger:query" label="search " placeholder="gate, guard, run, text" value={f.query} onInput={v => act.setLedgerFilter({ ...f, query: v })} onSubmit={v => act.setLedgerFilter({ ...f, query: v })} />,
    )
  }
  return rows
}

export function ledgerTab(ctx: Ctx): RenderElement[] {
  const { vm, ui, w } = ctx
  const all = vm.ledger
  const shown = applyLedgerFilter(all, ui.ledgerFilter)
  const out: RenderElement[] = [...toolbar(ctx), rule(ctx, [strong('Ledger'), dim(`  ${shown.length} of ${plural(all.length, 'entry', 'entries')} · newest first`)], w)]

  if (all.length === 0) {
    out.push(...para(ctx, 'No entries yet. Every gate, guard block, proof run and autopilot step lands here.', w, 2, '', { dimColor: true }))
    return out
  }
  if (shown.length === 0) {
    out.push(line(ctx, [dim('Nothing matches this filter.')]))
    return out
  }

  const showRun = w >= 110 && ui.ledgerFilter.run === null && vm.runs.length > 1
  let day = ''
  for (const e of shown.slice(0, MAX_ROWS)) {
    const label = dayLabel(e.ts, vm.now)
    if (label !== day) {
      day = label
      out.push(line(ctx, [dim(`${label}`)]))
    }
    const runCol = showRun ? pad(e.run ?? '', 16) + ' ' : ''
    const room = w - 5 - 2 - 2 - 2 - 7 - (showRun ? 17 : 0)
    out.push(
      line(ctx, [
        dim(hhmm(e.ts)),
        '  ',
        { t: ledgerIcon(e.kind), color: ledgerColor(e.kind) },
        '  ',
        { t: pad(e.actor, 5), color: ACTOR_COLOR[e.actor], dimColor: e.actor === 'mod' },
        '  ',
        runCol ? dim(runCol) : '',
        clip(e.summary, Math.max(10, room)),
      ]),
    )
  }
  if (shown.length > MAX_ROWS) {
    out.push(blank(ctx), line(ctx, [dim(`… ${shown.length - MAX_ROWS} older entries. Export AUDIT.md for the full chain of custody.`)]))
  }
  return out
}
