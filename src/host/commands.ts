import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinitionId, CommandResult } from '@deepseek-ai/dsh-commands'
import type { RecapConfig } from '../core/config.js'
import type { RecapEngine } from '../core/engine.js'
export function installCommand(ctx: Context, engine: RecapEngine, config: () => RecapConfig): void {
  ctx.inject(['commands'], (child) => {
    child.effect(() =>
      child.commands.register({
        definitionId: 'dsh-recap:recap' as CommandDefinitionId,
        name: 'recap',
        description: '回顾当前会话 / Recap the current session',
        input: { hint: 'refresh | hide | status | settings | help' },
        handler: async ({ agent, rawInput }): Promise<CommandResult> => {
          try {
            const args = rawInput.trim()
            const en = config().language === 'en'
            if (!config().onCommand)
              return {
                kind: 'error',
                text: en
                  ? '/recap is disabled in Recap settings.'
                  : '已在回顾设置中关闭 /recap 命令。',
              }
            if (args === 'help')
              return {
                kind: 'success',
                text: '/recap · /recap refresh · /recap hide · /recap status · /recap settings',
              }
            if (args === 'settings')
              return {
                kind: 'success',
                text: en
                  ? 'Open Settings → Recap to configure triggers, model, language and privacy.'
                  : '打开「设置 → 会话回顾」，可以调整触发方式、模型、语言和隐私选项。',
              }
            if (args === 'hide') {
              engine.dismiss(agent.id)
              return {
                kind: 'success',
                text: en
                  ? 'Automatic recaps paused for this session; /recap resumes them.'
                  : '已暂停本会话的自动回顾，手动执行 /recap 可恢复。',
              }
            }
            if (args && !['refresh', 'status'].includes(args))
              return {
                kind: 'error',
                text: en
                  ? 'Unknown argument. Use /recap help.'
                  : '参数不支持，请使用 /recap help。',
              }
            if (args !== 'status') {
              // 命令确认受理后立即返回，生成由插件生命周期管理，结果在单一回顾位置更新。
              void engine
                .request(agent.id, 'manual', { force: args === 'refresh' })
                .catch(() => undefined)
            }
            const state = args === 'status' ? engine.reveal(agent.id) : engine.state(agent.id)
            if (state.status === 'busy')
              return {
                kind: 'error',
                text: en
                  ? 'The agent is working. Run /recap when it is idle.'
                  : '主会话正在运行，请在本轮结束后执行 /recap。',
              }
            if (state.error === 'CANCELLED')
              return {
                kind: 'error',
                text: en
                  ? 'Recap cancelled because the session changed.'
                  : '会话已变化，本次回顾已取消。',
              }
            if (state.status === 'queued' || state.status === 'generating')
              return {
                kind: 'success',
                text: en
                  ? 'Recap request accepted; preparing your recap.'
                  : '回顾请求已受理，正在整理。',
              }
            if (!state.recap)
              return {
                kind: 'error',
                text: en
                  ? 'There is no recap yet. Use /recap after a conversation.'
                  : '当前还没有可展示的回顾。对话后可执行 /recap。',
              }
            return { kind: 'success', text: en ? 'Recap is ready.' : '回顾已就绪。' }
          } catch {
            return {
              kind: 'error',
              text: '回顾未完成，请重试或检查设置。 / Recap did not complete; retry or check settings.',
            }
          }
        },
      }),
    )
  })
}
