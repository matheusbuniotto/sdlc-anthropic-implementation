import { test, expect } from 'claude-code/testing'

const variants: Record<string, (el: any) => any> = {
  undefinedColor: ({ Box, Text }) => <Box><Text color={undefined}>x</Text></Box>,
  falseBold: ({ Box, Text }) => <Box><Text bold={false}>x</Text></Box>,
  falseDim: ({ Box, Text }) => <Box><Text dimColor={false}>x</Text></Box>,
  buttonInText: ({ Box, Text, Button }) => <Box><Text>a <Button key="b" label="B" onPress={() => {}} /></Text></Box>,
  boxInText: ({ Box, Text }) => <Box><Text>a <Box>x</Box></Text></Box>,
  nestedText: ({ Box, Text }) => <Box><Text>a <Text color="success">b</Text> c</Text></Box>,
  pctWidth: ({ Box, Text }) => <Box width="100%"><Text>x</Text></Box>,
  dupKeys: ({ Box, Button }) => <Box><Button key="b" label="B" onPress={() => {}} /><Button key="b" label="C" onPress={() => {}} /></Box>,
  dupHotkey: ({ Box, Button }) => <Box><Button key="b" hotkey="a" label="B" onPress={() => {}} /><Button key="c" hotkey="a" label="C" onPress={() => {}} /></Box>,
  upperHotkey: ({ Box, Button }) => <Box><Button key="b" hotkey="A" label="B" onPress={() => {}} /></Box>,
  falseAutoFocus: ({ Box, Button }) => <Box><Button key="b" autoFocus={false as any} label="B" onPress={() => {}} /></Box>,
  emptyLabel: ({ Box, Button }) => <Box><Button key="b" label="" onPress={() => {}} /></Box>,
  noLabel: ({ Box, Button }) => <Box><Button key="b" onPress={() => {}} /></Box>,
  numberChild: ({ Box, Text }) => <Box><Text>{3}</Text>{4}</Box>,
  nullTop: () => null,
  unknownBorder: ({ Box, Text }) => <Box borderStyle="fancy"><Text>x</Text></Box>,
  boxKey: ({ Box, Text }) => <Box key="card"><Text>x</Text></Box>,
  textKey: ({ Box, Text }) => <Box><Text key="t">x</Text></Box>,
  unknownProp: ({ Box, Text }) => <Box foo="bar"><Text>x</Text></Box>,
  textWrapTrunc: ({ Box, Text }) => <Box><Text wrap="truncate-end">x</Text></Box>,
  inputOk: ({ Box, Input }) => Input ? <Box><Input key="i" value="" placeholder="p" onSubmit={() => {}} /></Box> : <Box>no</Box>,
  inputUndefProps: ({ Box, Input }) => Input ? <Box><Input key="i" value="" label={undefined} onSubmit={() => {}} /></Box> : <Box>no</Box>,
  selectOk: ({ Box, Select }) => Select ? <Box><Select key="s" options={[{ value: 'a', label: 'A' }]} value="a" onSelect={() => {}} /></Box> : <Box>no</Box>,
  markdown: ({ Box, Markdown }) => <Box><Markdown text="# hi" /></Box>,
  rowGapPad: ({ Box, Text }) => <Box gap={1} paddingX={1} paddingY={0} marginBottom={1} flexGrow={1} flexShrink={0} justifyContent="space-between" alignItems="center" overflow="hidden" minWidth={10}><Text>x</Text></Box>,
  bgColor: ({ Box, Text }) => <Box backgroundColor="subtle" borderStyle="single" borderDimColor><Text backgroundColor="warning" inverse underline italic strikethrough>x</Text></Box>,
  unicodeLabel: ({ Box, Button }) => <Box><Button key="b" label="Run next ▸" hotkey="n" variant="primary" onPress={() => {}} /></Box>,
  plainBtn: ({ Box, Button }) => <Box><Button key="b" label="Run next ▸" hotkey="n" plain dimColor onPress={() => {}} /></Box>,
  multilineText: ({ Box, Text }) => <Box><Text>{'a\nb'}</Text></Box>,
  emptyText: ({ Box, Text }) => <Box><Text>{''}</Text></Box>,
  digitHotkey: ({ Box, Button }) => <Box><Button key="b" hotkey="1" label="B" onPress={() => {}} /></Box>,
  roleDismiss: ({ Box, Button }) => <Box><Button key="b" role="dismiss" label="B" onPress={() => {}} /></Box>,
}

for (const surface of ['terminal', 'mobile'] as const) {
  for (const [name, build] of Object.entries(variants)) {
    test(`probe ${surface} ${name}`, async ($, on) => {
      on('ui.render', { component: 'Pane' }, ($$, e) => build($$.ui.resolve(e)) ?? e)
      let msg = 'OK'
      try {
        await $.ui.mount({ plugin: 'test', surface, component: 'Pane', props: { title: 'x', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { bodyRows: 20 } as never, view: {} as never }, viewport: { columns: 120, rows: 40 } as never })
      } catch (err) { msg = 'REFUSED: ' + String((err as Error).message).slice(0, 160) }
      console.log(`${surface} ${name}: ${msg}`)
      expect(1).toBe(1)
    })
  }
}
