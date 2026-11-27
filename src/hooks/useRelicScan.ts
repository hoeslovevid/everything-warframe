import { useCallback, useSyncExternalStore } from 'react'
import type { RelicScanState } from '../../shared/types'
import { createLiveStore } from './liveStore'

const empty: RelicScanState = {
  active: false,
  scanning: false,
  scannedAt: '',
  trigger: 'none',
  error: null,
  rewards: [],
  inventoryLoaded: false,
  celebration: false,
  squadSize: null,
  scanMeta: null,
}


const store = createLiveStore(empty, () => window.voidlens?.getRelicScan(),
  (cb) => window.voidlens?.onRelicScanUpdated(cb))

export function useRelicScan() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const scan = useCallback(async () => {
    try { return await store.request(() => window.voidlens?.scanRelicRewards()) }
    catch (err) {
      store.set({ ...store.getSnapshot(), scanning: false, active: true,
        error: err instanceof Error ? err.message : 'Scan failed. Try again.' })
      throw err
    }
  }, [])
  const clear = useCallback(() => store.request(() => window.voidlens?.clearRelicScan()), [])
  const ackCelebration = useCallback(() => store.request(() => window.voidlens?.ackRelicCelebration()), [])
  return { state, scan, clear, ackCelebration }
}
