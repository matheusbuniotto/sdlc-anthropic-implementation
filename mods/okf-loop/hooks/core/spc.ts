// Statistical process control for Stage 6 (Play 13): rolling baseline, oriented z-scores and the
// Western Electric rules. Detection is 100% deterministic; no model is involved.

import type { BandReading, Tier } from '../../types'

// so a value that is exactly 2σ or 3σ on paper is not lost to float rounding
const EPS = 1e-9
const TIER_RANK: Record<Tier, number> = { 'in-control': 0, '1sigma': 1, '2sigma': 2, '3sigma': 3 }
/** How many trailing points the Western Electric rules look at (WE4 needs eight). */
const RULE_SPAN = 8

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

/** Population standard deviation; 0 for fewer than two points. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let sum = 0
  for (const x of xs) sum += (x - m) * (x - m)
  return Math.sqrt(sum / xs.length)
}

/** Baseline over the last `window` samples, excluding the newest (the one being judged). */
export function rollingStats(samples: number[], window: number): { mean: number; sd: number; n: number } {
  const history = samples.slice(0, -1)
  const size = Number.isFinite(window) && window >= 1 ? Math.floor(window) : history.length
  const recent = size >= history.length ? history : history.slice(-size)
  return { mean: mean(recent), sd: stdev(recent), n: recent.length }
}

/** Positive means "worse": above the mean when a rise hurts, below it when a fall hurts. A flat baseline (sd 0) scores 0. */
export function zScore(value: number, m: number, sd: number, higherIsWorse: boolean): number {
  if (!(sd > 0)) return 0
  const z = (value - m) / sd
  const oriented = higherIsWorse ? z : -z
  return oriented === 0 ? 0 : oriented
}

/**
 * Western Electric rules over oriented z-scores (oldest to newest). Each rule is judged at the
 * newest point: it must take part in the pattern, so a rule fires once, when the pattern completes.
 */
export function westernElectric(zs: number[]): { rule: string; tier: Tier }[] {
  const out: { rule: string; tier: Tier }[] = []
  const n = zs.length
  const last = zs[n - 1]
  if (last === undefined) return out
  const beyond = (xs: number[], limit: number): number => xs.filter(z => z + EPS >= limit).length
  if (last + EPS >= 3) out.push({ rule: 'WE1', tier: '3sigma' })
  if (last + EPS >= 2 && beyond(zs.slice(-3), 2) >= 2) out.push({ rule: 'WE2', tier: '2sigma' })
  if (last + EPS >= 1 && beyond(zs.slice(-5), 1) >= 4) out.push({ rule: 'WE3', tier: '2sigma' })
  if (n >= 8 && zs.slice(-8).every(z => z > 0)) out.push({ rule: 'WE4', tier: '1sigma' })
  return out
}

/** The highest tier among the z-score itself and every fired rule. */
export function classifyTier(z: number, rules: { rule: string; tier: Tier }[]): Tier {
  let tier: Tier = z + EPS >= 3 ? '3sigma' : z + EPS >= 2 ? '2sigma' : z + EPS >= 1 ? '1sigma' : 'in-control'
  for (const r of rules) if (TIER_RANK[r.tier] > TIER_RANK[tier]) tier = r.tier
  return tier
}

export function evaluateSeries(
  metric: string,
  samples: { at: number; value: number }[],
  opts: { window: number; higherIsWorse: boolean; minSamples?: number; rules?: 'western_electric' | 'simple' },
): BandReading | null {
  const clean = samples.filter(s => Number.isFinite(s.at) && Number.isFinite(s.value))
  // stable sort: samples that share a timestamp keep their order
  clean.sort((a, b) => a.at - b.at)
  const minSamples = Math.max(2, opts.minSamples ?? 8)
  const newest = clean[clean.length - 1]
  if (clean.length < minSamples || newest === undefined) return null

  const values = clean.map(s => s.value)
  // each recent point against the baseline that preceded it: what the watcher saw at that time
  const zs: number[] = []
  for (let i = Math.max(0, values.length - RULE_SPAN); i < values.length; i++) {
    const stats = rollingStats(values.slice(0, i + 1), opts.window)
    const v = values[i] ?? 0
    zs.push(zScore(v, stats.mean, stats.sd, opts.higherIsWorse))
  }
  const base = rollingStats(values, opts.window)
  const z = zs[zs.length - 1] ?? 0
  const fired = opts.rules === 'simple' ? [] : westernElectric(zs)
  return {
    metric,
    at: newest.at,
    value: newest.value,
    mean: base.mean,
    sd: base.sd,
    z,
    tier: classifyTier(z, fired),
    rules: fired.map(r => r.rule),
    n: base.n,
  }
}

const BLOCKS = '▁▂▃▄▅▆▇█'

/** One block per value (the last `width` of them), scaled between the series' own min and max. */
export function sparkline(values: number[], width?: number): string {
  let vs = values.filter(Number.isFinite)
  if (width !== undefined && Number.isFinite(width) && width >= 1 && vs.length > width) vs = vs.slice(-Math.floor(width))
  if (vs.length === 0) return ''
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  if (hi === lo) return BLOCKS.charAt(0).repeat(vs.length)
  return vs.map(v => BLOCKS.charAt(Math.round(((v - lo) / (hi - lo)) * (BLOCKS.length - 1)))).join('')
}
