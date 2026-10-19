import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import vi from './vi.json'

export const LANGUAGES = ['vi', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
const STORAGE_KEY = 'skillmkt.lang'

function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'vi' || stored === 'en') return stored
  } catch {
    /* bỏ qua */
  }
  return (navigator.language || 'vi').toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: { vi: { translation: vi }, en: { translation: en } },
  lng: detectLanguage(),
  fallbackLng: 'vi',
  interpolation: { escapeValue: false }, // React đã tự escape
})

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
})

export function setLanguage(lng: Language): void {
  void i18n.changeLanguage(lng)
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* bỏ qua */
  }
}

export default i18n
