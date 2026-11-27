import { lazy, Suspense, useEffect } from 'react'
const CompanionApp = lazy(() => import('./app/companion/CompanionApp').then((m) => ({ default: m.CompanionApp })))
const OverlayApp = lazy(() => import('./app/overlay/OverlayApp').then((m) => ({ default: m.OverlayApp })))

function resolveWindow(): 'companion' | 'overlay' {
  const params = new URLSearchParams(window.location.search)
  const q = params.get('window') || params.get('w')
  if (q === 'overlay') return 'overlay'
  if (window.location.hash.includes('overlay')) return 'overlay'
  return 'companion'
}

export default function App() {
  const mode = resolveWindow()

  useEffect(() => {
    document.documentElement.classList.toggle('is-overlay', mode === 'overlay')
    document.body.classList.toggle('is-overlay', mode === 'overlay')
    document.title = mode === 'overlay' ? 'Everything Warframe Overlay' : 'Everything Warframe'
    console.info(`[Everything Warframe] renderer mode=${mode} url=${window.location.href}`)
  }, [mode])

  return <Suspense fallback={null}>{mode === 'overlay' ? <OverlayApp /> : <CompanionApp />}</Suspense>
}
