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

async function loadLatestRelease() {
  const versionLine = document.getElementById('version-line')
  const meta = document.getElementById('download-meta')
  const checksumLine = document.getElementById('checksum-line')

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

document.addEventListener('DOMContentLoaded', () => {
  void loadLatestRelease()
  setupReveal()
  setupNavChrome()
})
