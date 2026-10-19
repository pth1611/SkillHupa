import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import i18n from '../i18n'

// jsdom báo navigator.language = en-US nên đặt cố định tiếng Việt để test không phụ thuộc môi trường.
beforeEach(async () => {
  await i18n.changeLanguage('vi')
})

afterEach(() => {
  cleanup()
})
