/** One IPC subscription per renderer, shared by every consumer of a scan. */
export function createLiveStore<T>(initial: T, read: () => Promise<T> | undefined,
  listen: (cb: (next: T) => void) => (() => void) | undefined) {
  let snapshot = initial
  let revision = 0
  let generation = 0
  let unsubscribe: (() => void) | undefined
  const listeners = new Set<() => void>()
  const set = (next: T) => { snapshot = next; revision++; listeners.forEach((cb) => cb()) }
  return {
    getSnapshot: () => snapshot,
    set,
    async request(action: () => Promise<T> | undefined) {
      const before = revision
      const next = await action()
      if (next !== undefined && revision === before) set(next)
      return next
    },
    subscribe(cb: () => void) {
      listeners.add(cb)
      if (listeners.size === 1) {
        const activeGeneration = ++generation
        unsubscribe = listen(set)
        const before = revision
        void read()?.then((next) => {
          if (generation === activeGeneration && revision === before) set(next)
        }).catch(() => {})
      }
      return () => {
        listeners.delete(cb)
        if (!listeners.size) { generation++; unsubscribe?.(); unsubscribe = undefined }
      }
    },
  }
}
