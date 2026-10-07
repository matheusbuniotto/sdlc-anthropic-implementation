import { describe, expect, test } from 'claude-code/testing'
import { classifyTier, evaluateSeries, mean, rollingStats, sparkline, stdev, westernElectric, zScore } from '../hooks/core/spc'

const close = (a: number, b: number, eps = 1e-3): void => expect(Math.abs(a - b)).toBeLessThan(eps)
const series = (values: number[]): { at: number; value: number }[] => values.map((value, i) => ({ at: 1_000 * i, value }))
const BASE = [8, 12, 8, 12, 8, 12, 8, 12] // mean 10, population sd 2

describe('mean and standard deviation', () => {
  test('the textbook set 2,4,4,4,5,5,7,9 has mean 5 and population sd 2', () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5)
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2)
  })

  test('degenerate inputs', () => {
    expect(mean([])).toBe(0)
    expect(stdev([])).toBe(0)
    expect(stdev([42])).toBe(0)
    expect(stdev([3, 3, 3])).toBe(0)
  })
})

describe('rollingStats', () => {
  test('excludes the newest sample', () => {
    // history 1,2,3,4 -> window 3 keeps 2,3,4: mean 3, sd sqrt(2/3)
    const r = rollingStats([1, 2, 3, 4, 100], 3)
    expect(r.n).toBe(3)
    expect(r.mean).toBe(3)
    close(r.sd, Math.sqrt(2 / 3), 1e-9)
  })

  test('a window larger than the history takes all of it; no history yields n 0', () => {
    expect(rollingStats([2, 4, 6, 99], 30)).toEqual({ mean: 4, sd: Math.sqrt(8 / 3), n: 3 })
    expect(rollingStats([5], 30)).toEqual({ mean: 0, sd: 0, n: 0 })
    expect(rollingStats([], 30)).toEqual({ mean: 0, sd: 0, n: 0 })
  })

  test('a window below one falls back to the whole history', () => {
    expect(rollingStats([1, 2, 3, 9], 0).n).toBe(3)
  })
})

describe('zScore', () => {
  test('oriented: positive is worse', () => {
    expect(zScore(16, 10, 2, true)).toBe(3)
    expect(zScore(4, 10, 2, true)).toBe(-3)
    expect(zScore(4, 10, 2, false)).toBe(3)
    expect(zScore(16, 10, 2, false)).toBe(-3)
  })

  test('a flat baseline (sd 0) scores 0, never Infinity or -0', () => {
    expect(zScore(99, 10, 0, true)).toBe(0)
    expect(zScore(10, 10, 2, false)).toBe(0)
  })
})

describe('classifyTier', () => {
  test('thresholds are 1, 2 and 3 sigma; the better direction counts for nothing', () => {
    expect(classifyTier(0.99, [])).toBe('in-control')
    expect(classifyTier(1, [])).toBe('1sigma')
    expect(classifyTier(1.99, [])).toBe('1sigma')
    expect(classifyTier(2, [])).toBe('2sigma')
    expect(classifyTier(2.99, [])).toBe('2sigma')
    expect(classifyTier(3, [])).toBe('3sigma')
    expect(classifyTier(-5, [])).toBe('in-control')
  })

  test('the highest of the z-based and rule-based tiers wins', () => {
    expect(classifyTier(0.2, [{ rule: 'WE4', tier: '1sigma' }])).toBe('1sigma')
    expect(classifyTier(0.2, [{ rule: 'WE2', tier: '2sigma' }, { rule: 'WE4', tier: '1sigma' }])).toBe('2sigma')
    expect(classifyTier(2.5, [{ rule: 'WE4', tier: '1sigma' }])).toBe('2sigma')
    expect(classifyTier(2.5, [{ rule: 'WE1', tier: '3sigma' }])).toBe('3sigma')
  })
})

describe('Western Electric rules (oriented z, oldest to newest)', () => {
  test('WE1: the newest point at or beyond 3 sigma -> 3sigma', () => {
    expect(westernElectric([0, 0, 3])).toEqual([{ rule: 'WE1', tier: '3sigma' }])
    expect(westernElectric([0, 0, 2.99]).map(r => r.rule)).not.toContain('WE1')
    expect(westernElectric([3.5, 0, 0])).toEqual([])
  })

  test('WE2: two of three consecutive at or beyond 2 sigma, newest included -> 2sigma', () => {
    expect(westernElectric([2, 0, 2])).toEqual([{ rule: 'WE2', tier: '2sigma' }])
    expect(westernElectric([0, 2.1, 2.2])).toEqual([{ rule: 'WE2', tier: '2sigma' }])
    expect(westernElectric([0, 0, 2]).map(r => r.rule)).not.toContain('WE2')
    expect(westernElectric([2, 0, 0, 2]).map(r => r.rule)).not.toContain('WE2')
    // the pair is already history once the newest point has recovered
    expect(westernElectric([2.1, 2.2, 0])).toEqual([])
  })

  test('WE3: four of five consecutive at or beyond 1 sigma, newest included -> 2sigma', () => {
    expect(westernElectric([1, 1, 1, 0, 1])).toEqual([{ rule: 'WE3', tier: '2sigma' }])
    expect(westernElectric([0, 1.5, 1.2, 1.1, 1.3]).map(r => r.rule)).toContain('WE3')
    expect(westernElectric([1, 1, 0, 0, 1])).toEqual([])
    expect(westernElectric([1, 1, 1, 1, 0.5])).toEqual([])
  })

  test('WE4: eight consecutive above the mean -> 1sigma', () => {
    const eight = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    expect(westernElectric(eight)).toEqual([{ rule: 'WE4', tier: '1sigma' }])
    expect(westernElectric([-1, ...eight])).toEqual([{ rule: 'WE4', tier: '1sigma' }])
    expect(westernElectric(eight.slice(1))).toEqual([])
    expect(westernElectric([0.1, 0.2, 0.3, 0, 0.5, 0.6, 0.7, 0.8])).toEqual([])
  })

  test('several rules can fire together, in rule order; nothing fires on an empty series', () => {
    expect(westernElectric([1.5, 2.5, 2.5, 2.6, 3.1]).map(r => r.rule)).toEqual(['WE1', 'WE2', 'WE3'])
    expect(westernElectric([])).toEqual([])
  })
})

describe('evaluateSeries', () => {
  test('returns null until minSamples (default 8)', () => {
    expect(evaluateSeries('m', series(BASE.slice(0, 7)), { window: 30, higherIsWorse: true })).toBeNull()
    expect(evaluateSeries('m', series(BASE), { window: 30, higherIsWorse: true })).not.toBeNull()
    expect(evaluateSeries('m', series(BASE.slice(0, 4)), { window: 30, higherIsWorse: true, minSamples: 4 })).not.toBeNull()
    expect(evaluateSeries('m', [], { window: 30, higherIsWorse: true })).toBeNull()
  })

  test('a 3-sigma spike: value 20 over a baseline of mean 10, sd 2 -> z 5, 3sigma, WE1', () => {
    const r = evaluateSeries('latency', series([...BASE, 20]), { window: 30, higherIsWorse: true })
    expect(r).toEqual({ metric: 'latency', at: 8_000, value: 20, mean: 10, sd: 2, z: 5, tier: '3sigma', rules: ['WE1'], n: 8 })
  })

  test('exactly 2 sigma (value 14) is 2sigma, exactly 1 sigma (value 12) is 1sigma, 11 is in control', () => {
    expect(evaluateSeries('m', series([...BASE, 14]), { window: 30, higherIsWorse: true })).toMatchObject({ z: 2, tier: '2sigma' })
    expect(evaluateSeries('m', series([...BASE, 12]), { window: 30, higherIsWorse: true })).toMatchObject({ z: 1, tier: '1sigma', rules: [] })
    expect(evaluateSeries('m', series([...BASE, 11]), { window: 30, higherIsWorse: true })).toMatchObject({ z: 0.5, tier: 'in-control' })
  })

  test('a falling metric with higherIsWorse=false breaches downwards, and a rise is fine', () => {
    expect(evaluateSeries('throughput', series([...BASE, 0]), { window: 30, higherIsWorse: false })).toMatchObject({ z: 5, tier: '3sigma', rules: ['WE1'] })
    expect(evaluateSeries('throughput', series([...BASE, 20]), { window: 30, higherIsWorse: false })).toMatchObject({ z: -5, tier: 'in-control', rules: [] })
    expect(evaluateSeries('errors', series([...BASE, 0]), { window: 30, higherIsWorse: true })).toMatchObject({ z: -5, tier: 'in-control' })
  })

  test('a flat series has sd 0 and z 0 whatever the value', () => {
    const flat = evaluateSeries('m', series([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]), { window: 30, higherIsWorse: true })
    expect(flat).toEqual({ metric: 'm', at: 9_000, value: 5, mean: 5, sd: 0, z: 0, tier: 'in-control', rules: [], n: 9 })
  })

  test('a steady climb 1..10 is caught by the rules before any single point is: z 1.94, WE3 and WE4', () => {
    // newest 10 against history 1..9: mean 5, sd sqrt(60/9) = 2.582, z = 1.936
    const r = evaluateSeries('drift', series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { window: 30, higherIsWorse: true })
    expect(r?.mean).toBe(5)
    close(r?.sd ?? 0, 2.582)
    close(r?.z ?? 0, 1.936)
    expect(r?.rules).toEqual(['WE3', 'WE4'])
    expect(r?.tier).toBe('2sigma')
  })

  test("rules: 'simple' ignores Western Electric and judges the z-score alone", () => {
    const climb = series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(evaluateSeries('drift', climb, { window: 30, higherIsWorse: true, rules: 'simple' })).toMatchObject({ tier: '1sigma', rules: [] })
    expect(evaluateSeries('m', series([...BASE, 20]), { window: 30, higherIsWorse: true, rules: 'simple' })).toMatchObject({ tier: '3sigma', rules: [] })
  })

  test('the window limits the baseline to the most recent history', () => {
    // old regime around 100, new regime 8/12: a window of 8 sees only the new regime
    const old = [100, 100, 100, 100, 100, 100]
    const r = evaluateSeries('m', series([...old, ...BASE, 14]), { window: 8, higherIsWorse: true })
    expect(r).toMatchObject({ mean: 10, sd: 2, z: 2, n: 8, tier: '2sigma' })
  })

  test('samples are ordered by time and non-finite values are ignored', () => {
    const shuffled = [{ at: 8_000, value: 20 }, ...series(BASE).reverse(), { at: 9_999, value: Number.NaN }]
    expect(evaluateSeries('m', shuffled, { window: 30, higherIsWorse: true })).toMatchObject({ at: 8_000, value: 20, z: 5 })
  })
})

describe('sparkline', () => {
  test('eight rising values use all eight blocks', () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8])).toBe('▁▂▃▄▅▆▇█')
  })

  test('scales between the series min and max, flat is the floor, empty is empty', () => {
    expect(sparkline([0, 10])).toBe('▁█')
    expect(sparkline([5, 5, 5])).toBe('▁▁▁')
    expect(sparkline([])).toBe('')
    expect(sparkline([Number.NaN])).toBe('')
  })

  test('width keeps the most recent values', () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8], 4)).toBe('▁▃▆█')
    expect(sparkline([1, 2], 10)).toBe('▁█')
  })
})
