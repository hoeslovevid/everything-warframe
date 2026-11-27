import { useCallback, useSyncExternalStore } from 'react'
import type { RivenScanState } from '../../shared/types'
import { createLiveStore } from './liveStore'

const empty: RivenScanState = {
  active: false,
  scanning: false,
  scannedAt: '',
  trigger: 'none',
  error: null,
  current: null,
  reroll: null,
  recommendation: 'none',
}


const store = createLiveStore(empty, () => window.voidlens?.getRivenScan(),
  (cb) => window.voidlens?.onRivenScanUpdated(cb))

export function useRivenScan() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const scan = useCallback(async () => {
    try { return await store.request(() => window.voidlens?.scanRivens()) }
    catch (err) {
      store.set({ ...store.getSnapshot(), scanning: false, active: true,
        error: err instanceof Error ? err.message : 'Scan failed. Try again.' })
      throw err
    }
  }, [])
  const clear = useCallback(() => store.request(() => window.voidlens?.clearRivenScan()), [])
  return { state, scan, clear }
}
