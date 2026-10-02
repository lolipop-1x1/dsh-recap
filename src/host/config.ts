import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { FIELDS, type RecapConfig } from '../core/config.js'
const fields: Record<string, z> = {}
for (const field of FIELDS) {
  let schema: z
  if (field.kind === 'boolean') schema = z.boolean()
  else if (field.kind === 'number') {
    schema = z
      .number()
      .min(field.min ?? 0)
      .max(field.max ?? Number.MAX_SAFE_INTEGER)
    if (field.key !== 'idleMinutes') schema = schema.step(1)
  } else if (field.kind === 'select') {
    schema = z.union((field.choices ?? []).map((value) => z.const(value)))
  } else schema = z.string().max(256)
  fields[field.key] = schema.default(field.default).description(field.label.en)
}
/** Live references are required for native settings to accept edits without remounting. */
export const Config = z.object(fields).volatile() as z<Volatile<RecapConfig>>
export type Config = Volatile<RecapConfig>
