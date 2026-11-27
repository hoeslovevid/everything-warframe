import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppSettings,
  DEFAULT_SETTINGS,
  ModuleId,
  WorldstateSnapshot,
} from '../../shared/types'

const emptyWorldstate: WorldstateSnapshot = {
  fetchedAt: '',
  error: null,
  stale: false,
  circuit: null,
  cycles: [],
  fissures: [],
  baro: null,
  nightwave: null,
  arbitration: null,
  invasions: [],
  archonHunt: null,
  deepArchimedea: null,
  sortie: null,
  alerts: [],
}

function api() {
  return window.voidlens
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let unsub = () => {}
    const boot = async () => {
      if (!api()) {
        setReady(true)
        return
      }
      const initial = await api().getSettings()
      setSettings(initial)
      setReady(true)
      unsub = api().onSettingsChanged(setSettings)
    }
    void boot()
    return () => unsub()
  }, [])

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    if (!api()) return
    const next = await api().updateSettings(partial)
    setSettings(next)
  }, [])

  const setModuleEnabled = useCallback(async (id: ModuleId, enabled: boolean) => {
    if (!api()) return
    const next = await api().setModuleEnabled(id, enabled)
    setSettings(next)
  }, [])

  return { settings, ready, updateSettings, setModuleEnabled }
}

export function useWorldstate() {
  const [data, setData] = useState<WorldstateSnapshot>(emptyWorldstate)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refreshingRef = useRef(false)

  const refresh = useCallback(async (quiet = false) => {
    if (!api() || refreshingRef.current) {
      if (!api()) setLoading(false)
      return
    }
    refreshingRef.current = true
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const next = await api().refreshWorldstate()
      setData(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load worldstate')
    } finally {
      refreshingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let unsub = () => {}
    const boot = async () => {
      if (!api()) {
        setLoading(false)
        return
      }
      try {
        const initial = await api().getWorldstate()
        setData(initial)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load worldstate')
      } finally {
        setLoading(false)
      }
      // Expiry rollover is handled in the main process (avoids dual 1s polls)
      unsub = api().onWorldstateUpdated(setData)
    }
    void boot()
    return () => unsub()
  }, [])

  return { data, loading, error, refresh }
}
