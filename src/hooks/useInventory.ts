import { useCallback, useEffect, useState } from 'react'
import { InventoryStatus, InventorySyncResult } from '../../shared/types'

const emptyStatus: InventoryStatus = {
  path: '',
  source: 'none',
  consent: false,
  lastSynced: '',
  itemCount: 0,
  uniqueCount: 0,
  revision: 0,
  loaded: false,
  helperReady: false,
  warframeRunning: false,
  stale: true,
  staleAgeMs: null,
  platform: 'win32',
  protonPlay: false,
  error: null,
  candidates: [],
  playerLevel: null,
}

function api() {
  return window.voidlens
}

export function useInventory() {
  const [status, setStatus] = useState<InventoryStatus>(emptyStatus)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!api()) return
    const next = await api().getInventoryStatus()
    setStatus(next)
  }, [])

  useEffect(() => {
    let unsubStatus = () => {}
    let unsubProgress = () => {}
    const boot = async () => {
      if (!api()) return
      await refresh()
      unsubStatus = api().onInventoryUpdated(setStatus)
      if (api().onInventoryProgress) {
        unsubProgress = api().onInventoryProgress((p) => {
          setProgress(p.message)
          if (p.stage === 'done' || p.stage === 'error') {
            window.setTimeout(() => setProgress(null), 2500)
          }
        })
      }
    }
    void boot()
    return () => {
      unsubStatus()
      unsubProgress()
    }
  }, [refresh])

  const setConsent = useCallback(async (consent: boolean) => {
    if (!api()) return
    const next = await api().setInventoryConsent(consent)
    setStatus(next)
  }, [])

  const detect = useCallback(async () => {
    if (!api()) return
    setBusy(true)
    setMessage(null)
    try {
      const next = await api().detectInventorySources()
      setStatus(next)
      setMessage(
        next.candidates.length
          ? `Found ${next.candidates.length} inventory source${next.candidates.length === 1 ? '' : 's'}`
          : 'No inventory files found in common locations',
      )
    } finally {
      setBusy(false)
    }
  }, [])

  const useCandidate = useCallback(async (path: string) => {
    if (!api()) return
    setBusy(true)
    setMessage(null)
    try {
      const result: InventorySyncResult = await api().useInventoryCandidate(path)
      if (result.ok) {
        setMessage(`Loaded ${result.uniqueCount ?? 0} unique items (${result.itemCount ?? 0} total)`)
        await refresh()
      } else {
        setMessage(result.error || 'Failed to load inventory')
      }
      return result
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const syncFromGame = useCallback(async () => {
    if (!api()) return
    setBusy(true)
    setMessage('Syncing from Warframe… stay logged in')
    setProgress('Starting sync…')
    try {
      const result = await api().syncInventoryFromGame()
      if (result.ok) {
        setMessage(`Synced ${result.uniqueCount ?? 0} unique items from game`)
        await refresh()
      } else {
        setMessage(result.error || 'Sync failed')
      }
      return result
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const browse = useCallback(async () => {
    if (!api()) return
    setBusy(true)
    setMessage(null)
    try {
      const path = await api().pickInventoryPath()
      if (path) {
        setMessage(`Loaded inventory from ${path}`)
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const clear = useCallback(async () => {
    if (!api()) return
    setBusy(true)
    try {
      const next = await api().clearInventory()
      setStatus(next)
      setMessage('Inventory data cleared')
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    status,
    busy,
    message,
    progress,
    setConsent,
    detect,
    useCandidate,
    syncFromGame,
    browse,
    clear,
    refresh,
  }
}
