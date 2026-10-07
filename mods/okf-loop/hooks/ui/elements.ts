// The element constructors every okf-loop view draws with. Views never import
// them: the wiring resolves `$.ui.resolve(e)` and hands the table in, so one set
// of views serves the terminal, desktop, vscode and mobile tables.

import type {
  BoxProps,
  ButtonProps,
  CodeProps,
  ElementConstructor,
  InputProps,
  LinkProps,
  MarkdownProps,
  SelectProps,
  TextProps,
} from 'claude-code'

/** The subset all four surfaces have, plus the two that mobile lacks. */
export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Markdown: ElementConstructor<MarkdownProps>
  Link: ElementConstructor<LinkProps>
  Code: ElementConstructor<CodeProps>
  Input?: ElementConstructor<InputProps>
  Select?: ElementConstructor<SelectProps>
}

export type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

/** Boolean UI props accept only `true`, so a stray `false`/`undefined` is dropped before the engine sees it. */
function clean<P extends object>(make: ElementConstructor<P>): ElementConstructor<P> {
  return props => {
    const kept: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(props)) {
      if (value !== undefined && value !== false) kept[name] = value
    }
    return make(kept as typeof props)
  }
}

/** The table a view draws with: the same constructors, with unset props omitted. */
export function tidy(el: PaneElements): PaneElements {
  const out: PaneElements = {
    Box: clean(el.Box),
    Text: clean(el.Text),
    Button: clean(el.Button),
    Markdown: clean(el.Markdown),
    Link: clean(el.Link),
    Code: clean(el.Code),
  }
  if (el.Input) out.Input = clean(el.Input)
  if (el.Select) out.Select = clean(el.Select)
  return out
}
