import React, { useEffect, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { Settings } from './Settings.js'
import { useLanguage } from './i18n.js'

const loadedAt = Date.now()
const openedCommands = new Set<string>()

/** 新命令直接打开；历史加载和同一命令重挂载不重复弹窗。 */
export function SettingsDialog({
  requestId,
  requestedAt,
  ...props
}: ComponentProps<typeof Settings> & {
  requestId: string
  requestedAt: number
}): React.ReactElement | null {
  const dialog = useRef<HTMLDialogElement>(null)
  const [status, setStatus] = useState<'pending' | 'open' | 'closed'>('pending')
  const openedHere = useRef(false)
  const language = useLanguage(props.locale)
  useEffect(() => {
    if (openedHere.current) return
    if (requestedAt < loadedAt || openedCommands.has(requestId)) {
      setStatus('closed')
      return
    }
    openedHere.current = true
    openedCommands.add(requestId)
    setStatus('open')
    dialog.current?.showModal()
  }, [requestId, requestedAt])
  if (status === 'closed') return null
  return (
    <dialog
      ref={dialog}
      className="dshr-settings-dialog"
      aria-label={language === 'zh' ? '会话回顾设置' : 'Recap settings'}
      onClose={() => setStatus('closed')}
    >
      <button className="dshr-text-button" onClick={() => dialog.current?.close()}>
        {language === 'zh' ? '关闭' : 'Close'}
      </button>
      {status === 'open' && <Settings {...props} />}
    </dialog>
  )
}
