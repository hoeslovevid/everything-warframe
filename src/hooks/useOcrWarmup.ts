import { useEffect, useState } from 'react'
import type { OcrWarmupStatus } from '../../shared/types'

const idle: OcrWarmupStatus = {
  phase: 'idle',
  detail: '…',
  updatedAt: '',
}

function api() {
  return window.voidlens
}

export function useOcrWarmup() {
  const [status, setStatus] = useState<OcrWarmupStatus>(idle)

  useEffect(() => {
    let unsub = () => {}
    const boot = async () => {
      if (!api()?.getOcrWarmupStatus) return
      try {
        setStatus(await api().getOcrWarmupStatus())
      } catch {
        // ignore
      }
      if (api().onOcrWarmupStatus) {
        unsub = api().onOcrWarmupStatus(setStatus)
      }
    }
    void boot()
    return () => unsub()
  }, [])

  return status
}
