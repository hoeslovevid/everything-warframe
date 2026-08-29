import { en } from '../../shared/i18n/en'
import { es } from '../../shared/i18n/es'
import { fr } from '../../shared/i18n/fr'
import type { MessageKey, UiLocaleId } from '../../shared/i18n/types'

const PACKS: Partial<Record<UiLocaleId, Record<MessageKey, string>>> = {
  en,
  es,
  fr,
}

export function resolveUiLocale(
  setting: 'system' | UiLocaleId,
  navigatorLanguage?: string,
): UiLocaleId {
  if (setting !== 'system') return setting
  const raw = (navigatorLanguage || (typeof navigator !== 'undefined' ? navigator.language : 'en'))
    .toLowerCase()
    .slice(0, 2)
  if (raw === 'es' || raw === 'fr' || raw === 'de' || raw === 'pt' || raw === 'ru' || raw === 'zh') {
    return raw
  }
  return 'en'
}

export function t(locale: UiLocaleId, key: MessageKey): string {
  const pack = PACKS[locale]
  return pack?.[key] || en[key] || key
}
