import { useSyncExternalStore } from 'react'
import type { OcrWarmupStatus } from '../../shared/types'
import { createLiveStore } from './liveStore'
const idle: OcrWarmupStatus = { phase: 'idle', detail: 'Starts on first scan', updatedAt: '' }
const store = createLiveStore(idle, () => window.voidlens?.getOcrWarmupStatus(),
  (cb) => window.voidlens?.onOcrWarmupStatus(cb))
export function useOcrWarmup() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
