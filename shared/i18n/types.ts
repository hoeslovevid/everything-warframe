/** Supported companion UI locales (OCR / game data stay English). */
export type UiLocaleId = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'zh'

export type MessageKey =
  | 'nav.dashboard'
  | 'nav.modules'
  | 'nav.settings'
  | 'nav.help'
  | 'nav.inventory'
  | 'nav.market'
  | 'common.refresh'
  | 'common.clear'
  | 'common.sync'
  | 'sessionLedger.title'
  | 'sessionLedger.subtitle'
  | 'sessionLedger.endSession'
  | 'sessionLedger.copied'
  | 'inventory.stale'
  | 'inventory.helper'
  | 'crash.bannerTitle'
  | 'crash.openIssue'
  | 'crash.dismiss'
  | 'locale.label'
  | 'locale.system'
  | 'page.dashboard'
  | 'page.dashboardDesc'
  | 'page.settings'
  | 'page.settingsDesc'
  | 'page.help'
  | 'page.helpDesc'
  | 'page.modules'
  | 'page.modulesDesc'
  | 'settings.appearance'
  | 'settings.appearanceDesc'
  | 'settings.overlay'
  | 'settings.companion'

export type MessageDict = Record<MessageKey, string>

export const LOCALE_LABELS: Record<UiLocaleId | 'system', string> = {
  system: 'System default',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  ru: 'Русский',
  zh: '中文',
}
