// The controller: `reduce(model, action) -> { model, effects, reply? }`. Every decision of the
// mod lives here (and in the controller-*.ts files it is split into) as pure code over plain
// data; register.tsx only reads the disk into a DiskState, feeds actions in, and performs the
// effects that come out. Time is always a parameter.

import { onTurnComplete } from './controller-autopilot'
import { onDiagnosis, onMeasured } from './controller-bands'
import { runCommand } from './controller-commands'
import { afterIngest, blocked } from './controller-gates'
import { onToolDone } from './controller-guards'
import { ingestWith } from './controller-ingest'
import { done, start } from './controller-kit'
import type { Action, Reduced } from './controller-types'
import type { Model } from './controller-types'

export { onToolDone, classifyTool, judge, guardContext } from './controller-guards'
export { bandFile, dueMetrics, bandViews } from './controller-bands'
export { artifactReadPaths, blankModel, ingest, ingestWith, knowledgePaths, knowledgeRootOf, parseRunRecord, resolveConfig, userOverrides } from './controller-ingest'
export { activeRun, effectiveMode, isoDate, promptContext } from './controller-kit'
export { CHECK_SH_PATH, configText, existencePaths, setupItems } from './controller-scaffold'
export { CONFIRM_PREFIX } from './controller-scaffold'
export type { Action, DiskFile, DiskState, Effect, Facts, Model, Reduced, RunState, Runtime } from './controller-types'
export { NO_FACTS } from './controller-types'

/** A model for a first look at the disk, where `reduce` has nothing yet to build on. */
export function reduce(model: Model, action: Action): Reduced {
  const acc = start(model)
  switch (action.type) {
    case 'disk': {
      const prev = action.startup === true || !model.ready ? undefined : model
      const { model: next, findings } = ingestWith(action.disk, action.now, prev, action.facts)
      acc.model = next
      afterIngest(acc, prev, findings, action.now)
      break
    }
    case 'command':
      runCommand(acc, action)
      break
    case 'turn.complete':
      onTurnComplete(acc, action)
      break
    case 'tool.done':
      onToolDone(acc, action)
      break
    case 'guard.blocked':
      blocked(acc, action)
      break
    case 'band.measured':
      onMeasured(acc, action)
      break
    case 'band.diagnosis':
      onDiagnosis(acc, action)
      break
  }
  return done(acc)
}
