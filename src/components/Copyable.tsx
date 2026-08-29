import { ReactNode } from 'react'
import { copyText } from '../lib/tradeClipboard'
import { pushToast } from '../lib/toast'

type Props = {
  text: string
  children?: ReactNode
  className?: string
  title?: string
  toastOk?: string
  /** Stop click from bubbling (e.g. inside buttons). */
  stopPropagation?: boolean
}

/** Click (or Enter) to copy `text` and toast. */
export function Copyable({
  text,
  children,
  className = '',
  title,
  toastOk = 'Copied',
  stopPropagation,
}: Props) {
  const run = async (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (stopPropagation) e?.stopPropagation()
    const ok = await copyText(text)
    pushToast(ok ? toastOk : 'Copy failed', ok ? 'ok' : 'warn', 2200)
  }
  return (
    <button
      type="button"
      className={`copyable ${className}`.trim()}
      title={title || `Copy: ${text}`}
      onClick={(e) => void run(e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void run(e)
        }
      }}
    >
      {children ?? text}
    </button>
  )
}
