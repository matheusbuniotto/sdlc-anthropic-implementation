// Guards tab: the production-gate panel (token, human grant), one card per
// deterministic guard with its hit count, and the latest interceptions.

import type { RenderElement } from 'claude-code'

import type { GuardView } from '../../types'
import { RELEASE_ENV } from '../core/constants'
import { blank, btn, card, flow, innerWidth, line, para, rowBox, rule, txt, type Ctx, type Item } from './kit'
import { C, ago, chip, clip, dim, hhmm, ledgerColor, ledgerIcon, pad, plural, releaseChip, strong } from './theme'

function productionPanel(ctx: Ctx): RenderElement {
  const { vm, act } = ctx
  const iw = innerWidth(ctx.w)
  const chipState = releaseChip(vm.release, vm.now)
  const guard = vm.guards.find(g => g.id === 'production-gate')
  const grantLeft = vm.release.grantUntil !== null && vm.release.grantUntil > vm.now ? vm.release.grantUntil - vm.now : 0
  const minutes = vm.config.guards.grantMinutes

  const rows: RenderElement[] = [
    line(ctx, [strong(chipState.text.startsWith('🔒') ? '🔒' : '🔓'), ' ', strong('Production gate'), dim(' · Play 11 · the agent cannot pass it')]),
    line(ctx, [
      dim('Env token  '),
      vm.release.envToken ? { t: `✔ ${RELEASE_ENV} is set`, color: C.human } : { t: `✖ ${RELEASE_ENV} not set`, dimColor: true },
    ]),
    line(ctx, [
      dim('Human grant '),
      grantLeft > 0
        ? { t: `${Math.max(1, Math.round(grantLeft / 60000))}m left (until ${hhmm(vm.release.grantUntil ?? vm.now)})`, color: C.human }
        : { t: 'none: production commands are denied', dimColor: true },
    ]),
  ]
  if (guard && !guard.active) rows.push(line(ctx, [{ t: clip(`Play 11 is not adopted: this gate is dormant.`, iw), color: C.human }]))
  else if (guard && !guard.enabled) rows.push(line(ctx, [{ t: clip('This guard is switched off: production commands are NOT blocked.', iw), color: C.bad }]))

  const actions: Item[] = [
    btn(ctx, { key: 'release:grant', label: `g Grant ${minutes}m`, hotkey: 'g', hint: 'grant release', primary: grantLeft === 0, onPress: () => act.grantRelease(minutes) }),
  ]
  if (grantLeft > 0 || vm.release.grantUntil !== null) {
    actions.push(btn(ctx, { key: 'release:revoke', label: 'x Revoke', hotkey: 'x', hint: 'revoke', onPress: () => act.revokeRelease() }))
  }
  rows.push(...flow(ctx, actions, iw, 2))
  return card(ctx, { width: ctx.w, color: chipState.open ? C.human : C.border }, rows)
}

function guardRow(ctx: Ctx, g: GuardView): RenderElement[] {
  const { act, vm } = ctx
  const labelW = Math.max(14, Math.min(24, ctx.w - 3 - 1 - 4 - 2 - 18 - 14))
  const hits =
    g.stat.hits > 0
      ? `${plural(g.stat.hits, 'hit')}${g.stat.lastAt ? ' · ' + ago(g.stat.lastAt, vm.now).replace(' ago', '') : ''}`
      : 'no hits'
  const status = !g.enabled ? chip('off', C.human) : !g.active ? chip('dormant', C.dim) : ''
  const head = rowBox(ctx, [
    btn(ctx, { key: `guard:${g.id}:toggle`, label: g.enabled ? '[x]' : '[ ]', plain: true, onPress: () => act.toggleGuard(g.id) }),
    txt(ctx, [
      { t: pad(g.label, labelW), bold: g.active, dimColor: !g.active },
      ' ',
      dim(`P${String(g.play).padStart(2, '0')}`),
      '  ',
      { t: pad(hits, 14), color: g.stat.hits > 0 ? C.bad : undefined, dimColor: g.stat.hits === 0 },
      ' ',
      status,
    ]),
  ])
  const rows = [head, line(ctx, ['    ', dim(clip(g.summary, ctx.w - 4))])]
  const last = g.stat.lastMessage.split('\n')[0] ?? ''
  if (g.stat.hits > 0 && last) rows.push(line(ctx, ['    ', { t: clip(`↳ ${last}`, ctx.w - 4), color: C.bad, dimColor: true }]))
  return rows
}

function interceptions(ctx: Ctx): RenderElement[] {
  const { vm } = ctx
  const recent = vm.ledger.filter(e => e.kind === 'guard.blocked').slice(-8).reverse()
  const head = rule(ctx, [strong('Recent interceptions'), dim(`  last ${Math.max(recent.length, 0)} of ${plural(vm.guards.reduce((n, g) => n + g.stat.hits, 0), 'block')}`)], ctx.w)
  if (recent.length === 0) {
    return [head, ...para(ctx, 'Nothing blocked yet. Guards stay quiet until the agent tries something it should not.', ctx.w, 2, '', { dimColor: true })]
  }
  return [
    head,
    ...recent.map(e => {
      const guard = typeof e.data?.guard === 'string' ? e.data.guard : ''
      return line(ctx, [
        dim(pad(ago(e.ts, vm.now), 10)),
        { t: ledgerIcon(e.kind) + ' ', color: ledgerColor(e.kind) },
        guard ? dim(pad(guard, 20) + ' ') : '',
        clip(e.summary, Math.max(10, ctx.w - 10 - 2 - (guard ? 21 : 0))),
      ])
    }),
  ]
}

export function guardsTab(ctx: Ctx): RenderElement[] {
  const { vm } = ctx
  const active = vm.guards.filter(g => g.active && g.enabled).length
  return [
    productionPanel(ctx),
    rule(ctx, [strong('Guards'), dim(`  ${active}/${vm.guards.length} enforcing · [x] toggles one off`)], ctx.w),
    ...vm.guards.flatMap(g => guardRow(ctx, g)),
    blank(ctx),
    ...interceptions(ctx),
  ]
}
