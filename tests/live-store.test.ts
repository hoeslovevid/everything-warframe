import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLiveStore } from '../src/hooks/liveStore'

test('many panels share one IPC listener and teardown releases it', async () => {
  let subscriptions = 0, removals = 0, emit = (_v: number) => {}
  const store = createLiveStore(0, async () => 1, (cb) => { subscriptions++; emit = cb; return () => { removals++ } })
  const a = store.subscribe(() => {}), b = store.subscribe(() => {})
  await Promise.resolve()
  assert.equal(subscriptions, 1)
  emit(4)
  assert.equal(store.getSnapshot(), 4)
  a(); assert.equal(removals, 0)
  b(); assert.equal(removals, 1)
})

test('late initial fetch cannot overwrite a newer scan event', async () => {
  let resolve!: (v: number) => void, emit = (_v: number) => {}
  const initial = new Promise<number>((r) => { resolve = r })
  const store = createLiveStore(0, () => initial, (cb) => { emit = cb; return () => {} })
  const off = store.subscribe(() => {})
  emit(8); resolve(2)
  await Promise.resolve()
  assert.equal(store.getSnapshot(), 8)
  off()
})

test('late scan response cannot resurrect a cleared result', async () => {
  let resolve!: (v: number) => void
  const store = createLiveStore(0, () => undefined, () => undefined)
  const request = store.request(() => new Promise<number>((r) => { resolve = r }))
  store.set(0); resolve(10); await request
  assert.equal(store.getSnapshot(), 0)
})

test('unmounting invalidates pending initialization', async () => {
  let resolve!: (v: number) => void
  const store = createLiveStore(0, () => new Promise<number>((r) => { resolve = r }), () => undefined)
  store.subscribe(() => {})()
  resolve(7); await Promise.resolve()
  assert.equal(store.getSnapshot(), 0)
})
