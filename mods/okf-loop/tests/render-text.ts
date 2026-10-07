// Renders a RenderElement tree (a fake table's, or the engine's `ui.drawn()`)
// to plain text lines, to eyeball a view and to assert on its content and width.
// Pure: no engine. It models only what the views use: column/row Boxes, gap,
// width, padding, borders, margins, Text/Button/Input/Select/Markdown/Link/Code.

import { cells, clip } from '../hooks/ui/theme'

export type TreeNode = string | { type: string; props?: Record<string, unknown>; children?: unknown[] } | null | undefined | false

type Lines = string[]

const BORDERS: Record<string, [string, string, string, string, string, string]> = {
  round: ['╭', '╮', '╰', '╯', '─', '│'],
  single: ['┌', '┐', '└', '┘', '─', '│'],
  double: ['╔', '╗', '╚', '╝', '═', '║'],
  bold: ['┏', '┓', '┗', '┛', '━', '┃'],
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const width = (lines: Lines): number => lines.reduce((m, l) => Math.max(m, cells(l)), 0)
const padTo = (l: string, w: number): string => l + ' '.repeat(Math.max(0, w - cells(l)))

function kids(node: { children?: unknown[] }): TreeNode[] {
  return (node.children ?? []) as TreeNode[]
}

/** The text a Text-like node shows: its strings and nested inline elements, joined. */
export function textOf(node: TreeNode): string {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  switch (node.type) {
    case 'Button': {
      const label = String(node.props?.label ?? '')
      if (node.props?.plain) return node.props?.hotkey ? `${String(node.props.hotkey)}: ${label}` : label
      return `[ ${label} ]`
    }
    case 'Input': {
      const p = node.props ?? {}
      const shown = String(p.value ?? '') || String(p.placeholder ?? '')
      return `${String(p.label ?? '')}▏${shown}`
    }
    case 'Select': {
      const p = node.props ?? {}
      const options = (p.options ?? []) as { value: string; label?: string }[]
      const current = options.find(o => o.value === p.value) ?? options[0]
      return `${String(p.label ?? '')}‹ ${current?.label ?? current?.value ?? ''} ▾›`
    }
    case 'Markdown':
      return String(node.props?.text ?? '')
    case 'Code':
      return String(node.props?.source ?? '')
    case 'Link':
      return kids(node).length ? kids(node).map(textOf).join('') : String(node.props?.label ?? node.props?.href ?? '')
    default:
      return kids(node).map(textOf).join('')
  }
}

type Opts = { avail: number; strict: boolean }

function box(node: { props?: Record<string, unknown>; children?: unknown[] }, o: Opts): Lines {
  const p = node.props ?? {}
  if (p.display === 'none') return []
  const column = p.flexDirection === 'column' || p.flexDirection === 'column-reverse'
  const gap = num(p.gap) || (column ? num(p.rowGap) : num(p.columnGap))
  const border = typeof p.borderStyle === 'string' ? BORDERS[p.borderStyle] : undefined
  const padL = num(p.paddingLeft) || num(p.paddingX) || num(p.padding)
  const padR = num(p.paddingRight) || num(p.paddingX) || num(p.padding)
  const padT = num(p.paddingTop) || num(p.paddingY) || num(p.padding)
  const padB = num(p.paddingBottom) || num(p.paddingY) || num(p.padding)
  const fixed = typeof p.width === 'number' ? p.width : p.width === '100%' ? o.avail : undefined
  const frame = (border ? 2 : 0) + padL + padR
  const inner = fixed !== undefined ? Math.max(0, fixed - frame) : Math.max(0, o.avail - frame)
  const inOpts: Opts = { avail: o.strict && fixed === undefined ? Infinity : inner, strict: o.strict }

  const blocks = kids(node)
    .map(child => ({ child, lines: render(child, inOpts) }))
    .filter(b => b.lines.length > 0)

  let lines: Lines = []
  if (column) {
    blocks.forEach((b, i) => {
      const cp = typeof b.child === 'object' && b.child ? ((b.child as { props?: Record<string, unknown> }).props ?? {}) : {}
      if (i > 0) lines.push(...Array(gap).fill(''))
      lines.push(...Array(num(cp.marginTop) || num(cp.marginY) || num(cp.margin)).fill(''), ...b.lines, ...Array(num(cp.marginBottom) || num(cp.marginY) || num(cp.margin)).fill(''))
    })
  } else {
    const rows = Math.max(0, ...blocks.map(b => b.lines.length))
    const ws = blocks.map(b => width(b.lines))
    for (let r = 0; r < rows; r++) {
      lines.push(blocks.map((b, i) => padTo(b.lines[r] ?? '', ws[i] ?? 0)).join(' '.repeat(gap)).trimEnd())
    }
  }
  lines = [...Array(padT).fill(''), ...lines, ...Array(padB).fill('')]
  let w = width(lines) + padL + padR
  if (fixed !== undefined) w = fixed - (border ? 2 : 0)
  const body = lines.map(l => ' '.repeat(padL) + padTo(o.strict ? l : clip(l, Math.max(0, w - padL - padR)), Math.max(0, w - padL)))
  const framed = border
    ? [border[0] + border[4].repeat(w) + border[1], ...body.map(l => border[5] + padTo(l, w) + border[5]), border[2] + border[4].repeat(w) + border[3]]
    : body
  return framed
}

function render(node: TreeNode, o: Opts): Lines {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string') return node.split('\n')
  switch (node.type) {
    case 'Box':
      return box(node, o)
    case 'Text': {
      const wrap = String(node.props?.wrap ?? 'wrap')
      return textOf(node)
        .split('\n')
        .flatMap(l => {
          if (o.strict) return [l]
          if (wrap.startsWith('truncate')) return [clip(l, o.avail)]
          return cells(l) <= o.avail ? [l] : [clip(l, o.avail)]
        })
    }
    default:
      return textOf(node)
        .split('\n')
        .map(l => (o.strict ? l : clip(l, o.avail)))
  }
}

/** Lines at their natural width: nothing is clipped, so an overflowing row shows. */
export function renderNatural(tree: TreeNode): string[] {
  return render(tree, { avail: Infinity, strict: true }).map(l => l.trimEnd())
}

/** Lines as the surface would draw them in `columns` cells: Text that cannot fit is cut. */
export function renderText(tree: TreeNode, columns: number): string[] {
  return render(tree, { avail: columns, strict: false }).map(l => l.trimEnd())
}

export function maxWidth(lines: string[]): number {
  return width(lines)
}

type Found = { type: string; props: Record<string, unknown> }

export function walk(tree: TreeNode, visit: (n: Found) => void): void {
  if (tree === null || tree === undefined || tree === false || typeof tree === 'string') return
  visit({ type: tree.type, props: tree.props ?? {} })
  for (const c of kids(tree)) walk(c, visit)
}

export function findAll(tree: TreeNode, type: string): Found[] {
  const out: Found[] = []
  walk(tree, n => {
    if (n.type === type) out.push(n)
  })
  return out
}

export function findButton(tree: TreeNode, key: string): Found | undefined {
  return findAll(tree, 'Button').find(b => b.props.key === key)
}
