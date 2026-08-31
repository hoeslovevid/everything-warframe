const REPO = 'hoeslovevid/everything-warframe'
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`

function pickAsset(assets, kind) {
  if (!Array.isArray(assets)) return null
  if (kind === 'setup') {
    return assets.find((a) => /Setup.*\.exe$/i.test(a.name) && !/\.blockmap$/i.test(a.name))
  }
  if (kind === 'portable') {
    return assets.find((a) => /portable.*\.exe$/i.test(a.name))
  }
  if (kind === 'linux') {
    return (
      assets.find((a) => /\.AppImage$/i.test(a.name)) ||
      assets.find((a) => /\.deb$/i.test(a.name))
    )
  }
  return null
}

function setHref(id, url) {
  const el = document.getElementById(id)
  if (el && url) el.href = url
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`
}

function formatDate(iso) {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso))
  } catch {
    return null
  }
}

function extractDigest(asset) {
  const raw = asset?.digest || asset?.sha256 || ''
  if (typeof raw !== 'string' || !raw) return null
  const hex = raw.replace(/^sha256:/i, '').trim()
  return hex || null
}

function setText(id, text) {
  const el = document.getElementById(id)
  if (el && text) el.textContent = text
}

function preferLinuxUi() {
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  return /linux/i.test(ua) || /linux/i.test(platform) || /x11/i.test(platform)
}

function firstChangelogLine(body) {
  if (typeof body !== 'string' || !body.trim()) return null
  const lines = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^[-*#>\s]+/, '').trim())
    .filter(Boolean)
  const skip = /^(what's new|changelog|release notes|summary)$/i
  for (const line of lines) {
    if (skip.test(line)) continue
    if (line.length < 8) continue
    return line.length > 140 ? `${line.slice(0, 137)}…` : line
  }
  return null
}

async function loadLatestRelease() {
  const versionLine = document.getElementById('version-line')
  const meta = document.getElementById('download-meta')
  const checksumLine = document.getElementById('checksum-line')
  const changelog = document.getElementById('changelog-strip')

  try {
    const res = await fetch(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = await res.json()
    const tag = data.tag_name || data.name || 'latest'
    const setup = pickAsset(data.assets, 'setup')
    const portable = pickAsset(data.assets, 'portable')
    const linux = pickAsset(data.assets, 'linux')
    const published = formatDate(data.published_at)
    const size = formatBytes(setup?.size)
    const linuxSize = formatBytes(linux?.size)
    const digest = extractDigest(setup)

    setHref('download-setup', setup?.browser_download_url || LATEST_PAGE)
    setHref('download-setup-2', setup?.browser_download_url || LATEST_PAGE)
    setHref('download-portable', portable?.browser_download_url || LATEST_PAGE)
    setHref('download-portable-2', portable?.browser_download_url || LATEST_PAGE)
    setHref('download-linux', linux?.browser_download_url || LATEST_PAGE)
    setHref('download-linux-2', linux?.browser_download_url || LATEST_PAGE)

    // On Linux browsers, lead with the Linux CTA.
    if (preferLinuxUi()) {
      const heroLinux = document.getElementById('download-linux')
      const heroWin = document.getElementById('download-setup')
      if (heroLinux && heroWin && heroLinux.parentElement === heroWin.parentElement) {
        heroWin.parentElement.insertBefore(heroLinux, heroWin)
      }
    }

    if (versionLine) {
      const bits = [`Latest <strong>${tag}</strong>`, 'Windows &amp; Linux x64']
      if (published) bits.push(published)
      versionLine.innerHTML = bits.join(' · ')
    }

    if (meta) {
      setText('meta-version', tag)
      setText('meta-date', published || '—')
      setText('meta-size', size ? `Win ${size}` : 'Win —')
      setText(
        'meta-size-linux',
        linuxSize ? `Linux ${linuxSize}` : linux ? 'Linux —' : 'Linux soon',
      )
      meta.hidden = false
    }

    if (checksumLine && digest) {
      checksumLine.hidden = false
      checksumLine.textContent = `SHA-256 (Windows Setup): ${digest}`
    }

    const note = firstChangelogLine(data.body)
    if (changelog && note) {
      changelog.hidden = false
      changelog.textContent = `${tag}: ${note}`
    }
  } catch {
    setHref('download-setup', LATEST_PAGE)
    setHref('download-setup-2', LATEST_PAGE)
    setHref('download-portable', LATEST_PAGE)
    setHref('download-portable-2', LATEST_PAGE)
    setHref('download-linux', LATEST_PAGE)
    setHref('download-linux-2', LATEST_PAGE)
    if (versionLine) {
      versionLine.innerHTML = `Get the latest build from <a href="${LATEST_PAGE}">GitHub Releases</a>`
    }
  }
}

function setupReveal() {
  const nodes = document.querySelectorAll(
    '.section-inner, .feature-row, .steps li, .trust-list li, .faq-item, .trust-bar__inner',
  )
  let stagger = 0
  nodes.forEach((el) => {
    el.classList.add('reveal')
    if (el.classList.contains('feature-row') || el.matches('.steps li')) {
      el.style.transitionDelay = `${Math.min(stagger, 8) * 45}ms`
      stagger += 1
    }
  })

  if (!('IntersectionObserver' in window)) {
    nodes.forEach((el) => el.classList.add('is-in'))
    return
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in')
          io.unobserve(entry.target)
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  )

  nodes.forEach((el) => io.observe(el))
}

function setupNavChrome() {
  const nav = document.getElementById('site-nav')
  if (!nav) return

  const onScroll = () => {
    nav.classList.toggle('is-scrolled', window.scrollY > 24)
  }
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })

  const more = nav.querySelector('.nav-more')
  if (more) {
    document.addEventListener('click', (e) => {
      if (!(e.target instanceof Node)) return
      if (!more.contains(e.target)) more.open = false
    })
    more.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        more.open = false
      })
    })
  }
}

function setupDiscordInviteCopy() {
  const INVITE =
    'https://discord.com/oauth2/authorize?client_id=1543118817654476840&permissions=536955880&scope=bot%20applications.commands'
  const btn = document.getElementById('copy-discord-invite')
  const status = document.getElementById('discord-copy-status')
  if (!btn) return
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(INVITE)
      if (status) {
        status.hidden = false
        window.setTimeout(() => {
          status.hidden = true
        }, 2000)
      }
    } catch {
      window.prompt('Copy invite URL:', INVITE)
    }
  })
}

function setupHubLiveBadge() {
  const badge = document.getElementById('nav-hub-badge')
  if (!badge) return
  const HUB = 'https://everything-warframe-production.up.railway.app'
  const tick = async () => {
    try {
      const res = await fetch(`${HUB}/metrics`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      const n = typeof data.listings === 'number' ? data.listings : 0
      const bot = data.discord?.botReady
      badge.hidden = false
      badge.classList.toggle('is-offline', bot === false)
      badge.textContent = bot === false ? 'hub offline' : `${n} open`
      badge.title =
        bot === false
          ? 'LFG hub Discord bot offline'
          : `${n} open listing${n === 1 ? '' : 's'} on the community board`
    } catch {
      badge.hidden = false
      badge.classList.add('is-offline')
      badge.textContent = 'hub ?'
      badge.title = 'Could not reach LFG hub metrics'
    }
  }
  void tick()
  window.setInterval(() => void tick(), 30_000)
}

document.addEventListener('DOMContentLoaded', () => {
  void loadLatestRelease()
  setupReveal()
  setupNavChrome()
  setupDiscordInviteCopy()
  setupHubLiveBadge()
})
