import { watch } from 'vue'

const STORAGE_KEY = 'pigmi-locale'
const supportedLocales = new Set(['en', 'ru'])

export default defineNuxtPlugin(async (nuxtApp) => {
  const i18n = nuxtApp.$i18n
  const savedLocale = localStorage.getItem(STORAGE_KEY)

  if (savedLocale && supportedLocales.has(savedLocale) && savedLocale !== i18n.locale.value) {
    await i18n.setLocale(savedLocale)
  }

  watch(i18n.locale, (nextLocale) => {
    if (supportedLocales.has(nextLocale)) {
      localStorage.setItem(STORAGE_KEY, nextLocale)
    }
  })
})
