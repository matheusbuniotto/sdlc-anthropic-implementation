// Writing artifacts: the Twice Rule in CLAUDE.md, artifact skeletons from the
// templates, and scaffold files. Pure text in, text out.

import type { LoopConfig, TemplateName } from '../../types'
import { type Line, oneLine, scan, setArtifactStatus } from './artifact-text'
import { TEMPLATE_FILES } from './constants'
import { stripWikiFrontmatter } from './knowledge'

// ---------------------------------------------------------------------------
// CLAUDE.md: the Twice Rule
// ---------------------------------------------------------------------------

const TWICE_HEADING = 'Things Claude Gets Wrong (The "Twice Rule")'

const lessonKey = (s: string): string =>
  s
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\s*\(added [^)]*\)\s*$/i, '')
    .trim()
    .toLowerCase()

/** Add a lesson under "Things Claude Gets Wrong"; create the section when missing; an existing identical lesson is not repeated. */
export function appendTwiceRule(claudeMd: string, lesson: string, date: string): string {
  const entry = oneLine(lesson).replace(/^[-*+]\s+/, '')
  if (entry === '') return claudeMd
  const cr = claudeMd.includes('\r\n') ? '\r' : ''
  const bullet = `- ${entry}${date.trim() === '' ? '' : ` (added ${date.trim()})`}${cr}`
  const lines = scan(claudeMd)
  const start = lines.findIndex((l) => !l.fenced && /^##\s+Things Claude Gets Wrong\b/i.test(l.text))
  if (start < 0) {
    const base = claudeMd.replace(/\s+$/, '')
    return `${base === '' ? '' : `${base}\n\n`}## ${TWICE_HEADING}\n${bullet}\n`
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] as Line
    if (!l.fenced && /^#{1,2}\s/.test(l.text)) {
      end = i
      break
    }
  }
  const key = lessonKey(entry)
  if (lines.slice(start + 1, end).some((l) => lessonKey(l.text) === key)) return claudeMd
  let last = end - 1
  while (last > start && (lines[last] as Line).text.trim() === '') last--
  const raws = lines.map((l) => l.raw)
  raws.splice(last + 1, 0, bullet)
  const joined = raws.join('\n')
  return joined.endsWith('\n') ? joined : `${joined}\n`
}

// ---------------------------------------------------------------------------
// Rendering: artifact skeletons and scaffolds from the templates
// ---------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

type Field = { label: string; value: string }

function fieldLine(line: string, field: Field): string | null {
  const re = new RegExp(`^(\\s*(?:[-*+]\\s+)?(?:\\*\\*${esc(field.label)}:?\\*\\*:?|${esc(field.label)}:)\\s*)(.*?)(\\s*)$`, 'i')
  const m = re.exec(line)
  // Only a value that is still a template slot is replaced; a customized template keeps its fixed values.
  if (!m || !(m[2] ?? '').includes('[')) return null
  return `${m[1]}${field.value}${m[3]}`
}

const H1_PREFIX: Record<'intent' | 'spec' | 'plan', string> = { intent: 'Intent', spec: 'Specification', plan: 'Plan' }

/** A new artifact skeleton from the template: header fields filled, Status draft, body slots left for the author. */
export function renderArtifact(args: {
  kind: 'intent' | 'spec' | 'plan'
  template: string
  title: string
  author: string
  date: string
  slug: string
  intentPath?: string
  specPath?: string
  source?: string
  branch?: string
}): string {
  const title = oneLine(args.title) || args.slug
  const author = oneLine(args.author) || 'n/a'
  const source = oneLine(args.source ?? '')
  const ref = args.specPath ?? args.intentPath
  const fields: Field[] =
    args.kind === 'intent'
      ? [
          { label: 'Author', value: author },
          { label: 'Date', value: args.date },
          { label: 'Source Ticket / Anomaly Ref', value: source === '' || source === 'human' ? 'n/a' : source },
        ]
      : args.kind === 'spec'
        ? [
            { label: 'Intent Reference', value: args.intentPath ?? 'n/a' },
            { label: 'Lead Architect / PO', value: author },
          ]
        : [
            { label: 'Author / Engineer', value: author },
            { label: 'Branch', value: `\`${args.branch ?? `feature/${args.slug}`}\`` },
            { label: 'Date', value: args.date },
          ]
  const lines = stripWikiFrontmatter(args.template).replace(/\r\n/g, '\n').split('\n')
  const firstH2 = lines.findIndex((l) => /^##(?!#)\s/.test(l))
  const headerEnd = firstH2 < 0 ? lines.length : firstH2
  for (let i = 0; i < headerEnd; i++) {
    const line = lines[i] as string
    if (/^#\s/.test(line)) {
      if (line.includes('[')) {
        const prefix = /^#\s+([A-Za-z ]+):/.exec(line)?.[1] ?? H1_PREFIX[args.kind]
        lines[i] = `# ${prefix}: ${title}${args.kind === 'plan' && ref ? ` (from ${ref})` : ''}`
      }
      continue
    }
    for (const f of fields) {
      const next = fieldLine(line, f)
      if (next !== null) {
        lines[i] = next
        break
      }
    }
  }
  const out = setArtifactStatus(lines.join('\n'), args.kind, 'draft')
  return out.endsWith('\n') ? out : `${out}\n`
}

const dirOf = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i < 0 ? '.' : p.slice(0, i)
}

/**
 * A scaffold file from its template, wiki front-matter removed (a template's own
 * front-matter, like the verifier agent's, stays). Scripts keep their shebang first line.
 */
export function renderScaffold(
  name: TemplateName,
  template: string,
  vars: { project: string; date: string; paths: LoopConfig['paths'] },
): string {
  const project = oneLine(vars.project) || 'this repository'
  let out = stripWikiFrontmatter(template).replace(/\r\n/g, '\n')
  const stamp = `Scaffolded by okf-loop on ${vars.date} from openknowledge/${TEMPLATE_FILES[name]}.`

  if (name === 'claude-context') {
    out = out.replace(/\[Repository \/ Microservice Name\]/g, () => project)
  } else if (name === 'bands') {
    const dest = vars.paths.incident.replace(/\{date\}/g, () => '${DATE}')
    out = out.replace(/intent\/anomaly-\$\{DATE\}\.md/g, () => dest)
    out = out.replace(/^# Statistical Control Bands Specification\s*$/m, () => `# Statistical Control Bands Specification: ${project}`)
  } else if (name === 'ci-evals-workflow') {
    const evalDir = dirOf(vars.paths.eval)
    if (evalDir !== '.' && !evalDir.includes('{') && evalDir !== 'evals') out = out.replace(/\bevals\//g, () => `${evalDir}/`)
    if (vars.paths.claudeMd !== 'CLAUDE.md') out = out.replace(/- 'CLAUDE\.md'/g, () => `- '${vars.paths.claudeMd}'`)
    const header = [
      `# ${stamp}`,
      `# Expects ./${evalDir === '.' ? '' : `${evalDir}/`}check.sh <eval.json> <result.json> to exit 0 when an eval passes; add it with your first eval.`,
    ]
    out = `${header.join('\n')}\n${out}`
  }
  return out.endsWith('\n') ? out : `${out}\n`
}
