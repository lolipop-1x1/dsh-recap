import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import {
  FIELDS,
  RecapError,
  resolveConfig,
  validatePatch,
  type RecapConfig,
} from '../core/config.js'
import type { SettingsView } from '../core/api.js'
export class SettingsBridge {
  constructor(
    private readonly ctx: Context,
    private readonly config: () => RecapConfig,
  ) {}
  private descriptor() {
    const settings = this.ctx.get('settings')
    const entry = this.ctx
      .get('configEditor')
      ?.entries()
      .find((row) => row.fiber === this.ctx.fiber)
    return settings && entry
      ? settings.describe().find((row) => row.ns === entry.options.id)
      : undefined
  }
  read(): SettingsView {
    const descriptor = this.descriptor()
    return {
      config: this.config(),
      fields: FIELDS,
      revision: descriptor?.revision ?? null,
      namespace: descriptor?.ns ?? null,
      writable: Boolean(descriptor && this.ctx.get('settings')?.writable),
    }
  }
  async save(input: unknown, expectedRevision: number): Promise<SettingsView> {
    const before = this.read(),
      settings = this.ctx.get('settings')
    if (!settings || !before.writable || !before.namespace)
      throw new RecapError('READ_ONLY', 'This plugin has no writable settings entry.', 503)
    if (before.revision !== expectedRevision)
      throw new RecapError('CONFLICT', 'Settings changed elsewhere. Reload before saving.', 409)
    const patch = validatePatch(input)
    resolveConfig({ ...before.config, ...patch })
    try {
      await settings.update(before.namespace, patch, expectedRevision)
    } catch (error) {
      if (this.descriptor()?.revision !== expectedRevision)
        throw new RecapError('CONFLICT', 'Settings changed elsewhere. Reload before saving.', 409)
      throw error
    }
    return this.read()
  }
}
import type {} from '@deepseek-ai/dsh-config-editor'
