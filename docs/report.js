const REPO = 'hoeslovevid/everything-warframe'
const NEW_ISSUE = `https://github.com/${REPO}/issues/new`

const CATEGORY_LABELS = {
  relics: 'Relic OCR / rewards',
  rivens: 'Riven grader',
  overlay: 'Overlay / layout',
  inventory: 'Inventory / foundry',
  lfg: 'LFG / Discord bot',
  linux: 'Linux / Proton',
  website: 'Website / downloads',
  other: 'Other',
}

const PLATFORM_LABELS = {
  windows: 'Windows',
  linux: 'Linux',
  both: 'Both / unsure',
  'n/a': 'N/A (website / Discord only)',
}

function $(id) {
  return document.getElementById(id)
}

function setStatus(msg, ok) {
  const el = $('report-status')
  if (!el) return
  el.hidden = !msg
  el.textContent = msg || ''
  el.classList.toggle('is-ok', Boolean(ok))
}

function buildBody({ category, platform, version, description }) {
  const area = CATEGORY_LABELS[category] || category
  const plat = PLATFORM_LABELS[platform] || platform
  const ver = version.trim() || '_not provided_'
  return [
    '## Summary',
    description.trim(),
    '',
    '## Environment',
    `- **Area:** ${area}`,
    `- **Platform:** ${plat}`,
    `- **App version:** ${ver}`,
    `- **Reported from:** website form`,
    '',
    '## Extra',
    '<!-- Attach screenshots if useful. Do not paste tokens or webhook URLs. -->',
    '',
  ].join('\n')
}

function openIssue(draft) {
  const title =
    draft.title.trim() ||
    `[${CATEGORY_LABELS[draft.category] || 'Bug'}] (please fill title)`
  const params = new URLSearchParams()
  params.set('title', title.slice(0, 120))
  params.set('body', buildBody(draft))
  params.set('labels', 'bug')
  const url = `${NEW_ISSUE}?${params.toString()}`
  // GitHub caps URL length; keep a safety margin.
  if (url.length > 7500) {
    setStatus('Description is too long for a URL — shorten it or paste into a blank GitHub Issue.', false)
    window.open(`${NEW_ISSUE}?labels=bug`, '_blank', 'noopener,noreferrer')
    return false
  }
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

function init() {
  const form = $('report-form')
  if (!form) return

  const params = new URLSearchParams(window.location.search)
  const preset = params.get('category')
  if (preset && $('report-category')?.querySelector(`option[value="${preset}"]`)) {
    $('report-category').value = preset
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const title = $('report-title')?.value || ''
    const description = $('report-description')?.value || ''
    if (!description.trim()) {
      setStatus('Please describe what went wrong.', false)
      $('report-description')?.focus()
      return
    }
    if (!title.trim()) {
      setStatus('Please add a short title.', false)
      $('report-title')?.focus()
      return
    }
    const ok = openIssue({
      title,
      category: $('report-category')?.value || 'other',
      platform: $('report-platform')?.value || 'windows',
      version: $('report-version')?.value || '',
      description,
    })
    if (ok) {
      setStatus('Opened GitHub in a new tab — sign in if needed, then submit the issue.', true)
    }
  })
}

init()
