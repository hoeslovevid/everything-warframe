/**
 * Local HTTP server for OBS / external overlay browser sources.
 * Serves JSON snapshots and lightweight HTML widgets (no Electron preload).
 */
import http from 'node:http'
import { URL } from 'node:url'
import type { RelicScanState, RivenScanState, WorldstateSnapshot } from '../../shared/types'
import { loadSettings } from '../settings'
import { getRelicScanState } from './relic-scanner'
import { getRivenScanState } from './riven-scanner'

const DEFAULT_PORT = 17862

let server: http.Server | null = null
let boundPort = DEFAULT_PORT
let worldstateProvider: (() => WorldstateSnapshot | null) | null = null

export function setWidgetWorldstateProvider(fn: () => WorldstateSnapshot | null) {
  worldstateProvider = fn
}

function esc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function emptyWorld(): WorldstateSnapshot {
  return {
    fetchedAt: new Date(0).toISOString(),
    stale: true,
    error: null,
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
}

function snapshot() {
  const settings = loadSettings()
  const world = worldstateProvider?.() || emptyWorld()
  const relics: RelicScanState = getRelicScanState()
  const rivens: RivenScanState = getRivenScanState()
  return {
    updatedAt: new Date().toISOString(),
    settings: {
      modules: settings.modules,
      fissureTiers: settings.fissureTiers,
      fissurePathMode: settings.fissurePathMode,
      fissureShowStorms: settings.fissureShowStorms,
      fissureSort: settings.fissureSort,
      baroWishlist: settings.baroWishlist,
      nightwaveDoneIds: settings.nightwaveDoneIds,
      colorTheme: settings.colorTheme,
    },
    worldstate: world,
    relics,
    rivens,
  }
}

function widgetShell(title: string, bodyHtml: string, pollMs = 5000) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} · Everything Warframe</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: transparent; font: 14px/1.35 "Segoe UI", system-ui, sans-serif; color: #d7e2ea; }
  .card { padding: 10px 12px; background: rgba(6,10,14,0.82); border: 1px solid rgba(157,180,196,0.22); border-radius: 10px; backdrop-filter: blur(8px); }
  h1 { margin: 0 0 8px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #8fa6b5; font-weight: 600; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li { display: flex; justify-content: space-between; gap: 10px; }
  .muted { color: #7f96a6; }
  .accent { color: #5fd0c5; }
  .warn { color: #e0b35a; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .empty { color: #7f96a6; font-size: 13px; }
</style>
</head>
<body>
<div class="card" id="root">${bodyHtml}</div>
<script>
async function tick() {
  try {
    const res = await fetch('/api/snapshot', { cache: 'no-store' });
    const data = await res.json();
    if (window.__ewRender) window.__ewRender(data);
  } catch (e) {
    document.getElementById('root').innerHTML = '<p class="empty">Waiting for Everything Warframe…</p>';
  }
}
tick();
setInterval(tick, ${pollMs});
</script>
</body>
</html>`
}

function renderIndex(port: number) {
  const panels = [
    'fissures',
    'cycles',
    'baro',
    'nightwave',
    'arbitration',
    'invasions',
    'archon',
    'deepArchimedea',
    'relics',
    'rivens',
  ]
  const links = panels
    .map((p) => `<li><a href="/widget/${p}">${p}</a> — <code>http://127.0.0.1:${port}/widget/${p}</code></li>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"/><title>EW Widgets</title>
<style>body{font:14px/1.5 system-ui;background:#0b1116;color:#d7e2ea;padding:24px}a{color:#5fd0c5}code{color:#e0b35a}</style>
</head><body>
<h1>Everything Warframe — OBS widgets</h1>
<p>Add a Browser Source in OBS pointing at one of these URLs (localhost only).</p>
<ul>${links}</ul>
<p>JSON: <a href="/api/snapshot"><code>/api/snapshot</code></a></p>
</body></html>`
}

function widgetPage(panel: string): string {
  const renderers: Record<string, string> = {
    fissures: `
window.__ewRender = (d) => {
  const s = d.settings, w = d.worldstate || {};
  let list = (w.fissures || []).filter(f => (s.fissureTiers||[]).includes(f.tier));
  if (s.fissurePathMode === 'normal') list = list.filter(f => !f.isHard);
  if (s.fissurePathMode === 'steel') list = list.filter(f => f.isHard);
  if (s.fissureShowStorms === false) list = list.filter(f => !f.isStorm);
  list = list.slice(0, 12);
  const rows = list.map(f => '<li><span>'+f.tier+' · '+f.missionType+(f.isHard?' · SP':'')+(f.isStorm?' · Storm':'')+'<br/><span class="muted">'+f.node+'</span></span><span class="accent">'+f.eta+'</span></li>').join('') || '<p class="empty">No fissures match filters</p>';
  document.getElementById('root').innerHTML = '<h1>Fissures</h1><ul>'+rows+'</ul>';
};`,
    cycles: `
window.__ewRender = (d) => {
  const rows = (d.worldstate.cycles||[]).map(c => '<li><span>'+c.name+' · <span class="warn">'+c.state+'</span></span><span class="accent">'+c.timeLeft+'</span></li>').join('') || '<p class="empty">No cycle data</p>';
  document.getElementById('root').innerHTML = '<h1>World Cycles</h1><ul>'+rows+'</ul>';
};`,
    baro: `
window.__ewRender = (d) => {
  const b = d.worldstate.baro;
  if (!b) { document.getElementById('root').innerHTML = '<h1>Baro</h1><p class="empty">No data</p>'; return; }
  const wish = new Set((d.settings.baroWishlist||[]).map(x => x.toLowerCase()));
  const inv = (b.inventory||[]).filter(i => wish.has((i.item||'').toLowerCase())).slice(0, 10);
  const head = '<div class="row"><span>'+(b.active ? b.location : 'Travelling')+'</span><span class="accent">'+(b.eta||'')+'</span></div>';
  const rows = inv.map(i => '<li><span>'+i.item+'</span><span class="muted">'+i.ducats+'d</span></li>').join('') || '<p class="empty">No wishlist hits (star items in companion)</p>';
  document.getElementById('root').innerHTML = '<h1>Baro Ki\\'Teer</h1>'+head+'<ul style="margin-top:8px">'+rows+'</ul>';
};`,
    nightwave: `
window.__ewRender = (d) => {
  const done = new Set(d.settings.nightwaveDoneIds||[]);
  const ch = (d.worldstate.nightwave && d.worldstate.nightwave.challenges) || [];
  const rows = ch.filter(c => !done.has(c.id)).slice(0, 10).map(c => '<li><span>'+c.title+'</span><span class="muted">'+(c.isDaily?'Daily':'Weekly')+'</span></li>').join('') || '<p class="empty">No open challenges</p>';
  document.getElementById('root').innerHTML = '<h1>Nightwave</h1><ul>'+rows+'</ul>';
};`,
    arbitration: `
window.__ewRender = (d) => {
  const a = d.worldstate.arbitration;
  if (!a || !a.node) { document.getElementById('root').innerHTML = '<h1>Arbitration</h1><p class="empty">No schedule</p>'; return; }
  const up = (a.upcoming||[]).slice(0,5).map(s => '<li><span>'+s.node+' · '+s.type+'</span><span class="muted">'+ (s.eta||'') +'</span></li>').join('');
  document.getElementById('root').innerHTML = '<h1>Arbitration</h1><div class="row"><span>'+a.node+' · '+a.type+'</span><span class="accent">'+(a.eta||'')+'</span></div>'+(up ? '<ul style="margin-top:8px">'+up+'</ul>' : '');
};`,
    invasions: `
window.__ewRender = (d) => {
  const rows = (d.worldstate.invasions||[]).slice(0, 8).map(i => '<li><span>'+i.node+'</span><span class="muted">'+Math.round((i.completion||0))+'%</span></li>').join('') || '<p class="empty">No invasions</p>';
  document.getElementById('root').innerHTML = '<h1>Invasions</h1><ul>'+rows+'</ul>';
};`,
    archon: `
window.__ewRender = (d) => {
  const a = d.worldstate.archonHunt;
  if (!a) { document.getElementById('root').innerHTML = '<h1>Archon Hunt</h1><p class="empty">No data</p>'; return; }
  const missions = (a.missions||[]).map(m => m.node + ' · ' + m.type).join('<br/>');
  document.getElementById('root').innerHTML = '<h1>Archon Hunt</h1><p class="warn">'+(a.boss||'')+'</p><p class="muted">'+missions+'</p><p class="accent">'+(a.eta||'')+'</p>';
};`,
    deepArchimedea: `
window.__ewRender = (d) => {
  const a = d.worldstate.deepArchimedea;
  if (!a) { document.getElementById('root').innerHTML = '<h1>Deep Archimedea</h1><p class="empty">No data</p>'; return; }
  const missions = (a.missions||[]).map(m => (m.node||'') + ' · ' + (m.type||'')).join('<br/>');
  const risks = (a.riskVariables||[]).slice(0,4).join(' · ');
  document.getElementById('root').innerHTML = '<h1>Deep Archimedea</h1><p>'+missions+'</p><p class="muted">'+risks+'</p><p class="accent">'+(a.eta||'')+'</p>';
};`,
    relics: `
window.__ewRender = (d) => {
  const r = d.relics;
  if (!r || !r.active) { document.getElementById('root').innerHTML = '<h1>Relic Rewards</h1><p class="empty">No active scan</p>'; return; }
  const rows = (r.rewards||[]).map(x => '<li><span>'+(x.name||'?')+(x.bestPick?' <span class="accent">Best</span>':'')+'</span><span class="warn">'+(x.platinum!=null?('~'+x.platinum+'p'):'—')+'</span></li>').join('');
  document.getElementById('root').innerHTML = '<h1>Relic Rewards</h1><ul>'+rows+'</ul>';
};`,
    rivens: `
window.__ewRender = (d) => {
  const r = d.rivens;
  if (!r || !r.active) { document.getElementById('root').innerHTML = '<h1>Riven Grader</h1><p class="empty">No active scan</p>'; return; }
  const card = (roll, label) => !roll ? '' : '<div style="margin-bottom:8px"><div class="muted">'+label+'</div><div><strong>'+roll.weapon+'</strong> · '+roll.tier+' ('+roll.score+')'+(roll.platinum!=null?' · ~'+roll.platinum+'p':'')+'</div></div>';
  document.getElementById('root').innerHTML = '<h1>Riven Grader</h1>'+card(r.current,'Current')+card(r.reroll,'Reroll')+'<p class="accent">'+(r.recommendation||'')+'</p>';
};`,
  }

  const script = renderers[panel]
  if (!script) {
    return widgetShell('Unknown', '<p class="empty">Unknown widget</p>')
  }
  const html = widgetShell(panel, '<p class="empty">Loading…</p>', panel === 'relics' || panel === 'rivens' ? 2000 : 5000)
  return html.replace('</script>', `${script}\n</script>`)
}

function sendJson(res: http.ServerResponse, code: number, data: unknown) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
}

function sendHtml(res: http.ServerResponse, html: string) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(html)
}

export function getWidgetServerStatus() {
  return {
    running: !!server?.listening,
    port: boundPort,
    baseUrl: `http://127.0.0.1:${boundPort}`,
  }
}

export async function startWidgetServer(port = DEFAULT_PORT): Promise<{ ok: boolean; port: number; error?: string }> {
  await stopWidgetServer()
  boundPort = port > 0 && port < 65536 ? port : DEFAULT_PORT

  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${boundPort}`)
        if (url.pathname === '/api/snapshot') {
          sendJson(res, 200, snapshot())
          return
        }
        if (url.pathname === '/' || url.pathname === '/widgets') {
          sendHtml(res, renderIndex(boundPort))
          return
        }
        const m = url.pathname.match(/^\/widget\/([a-zA-Z]+)$/)
        if (m) {
          sendHtml(res, widgetPage(m[1]))
          return
        }
        sendJson(res, 404, { error: 'not_found' })
      } catch (err) {
        sendJson(res, 500, { error: String(err) })
      }
    })

    srv.once('error', (err: NodeJS.ErrnoException) => {
      server = null
      resolve({ ok: false, port: boundPort, error: err.message })
    })

    srv.listen(boundPort, '127.0.0.1', () => {
      server = srv
      console.info(`[Everything Warframe] Widget server on http://127.0.0.1:${boundPort}`)
      resolve({ ok: true, port: boundPort })
    })
  })
}

export async function stopWidgetServer() {
  if (!server) return
  const srv = server
  server = null
  await new Promise<void>((resolve) => srv.close(() => resolve()))
}

export async function syncWidgetServerFromSettings() {
  const settings = loadSettings()
  if (settings.widgetServerEnabled) {
    return startWidgetServer(settings.widgetServerPort || DEFAULT_PORT)
  }
  await stopWidgetServer()
  return { ok: true, port: boundPort }
}
