// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: false },

  modules: [
    '@nuxtjs/i18n',
    'nuxt-icons',
    '@vueuse/nuxt',
    '@hypernym/nuxt-gsap',
    '@artmizu/yandex-metrika-nuxt'
  ],
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    bundle: {
      optimizeTranslationDirective: false
    },
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'ru', language: 'ru-RU', name: 'Русский', file: 'ru.json' }
    ]
  },
  yandexMetrika: {
    id: '98802249',
    webvisor: true
  },
  ssr: true,

  css: [
    '@/assets/styles/main.scss',
    '@/assets/la/css/line-awesome.min.css',
    'vue-final-modal/style.css',
    '@splidejs/vue-splide/css'
  ],

  experimental: {
    payloadExtraction: false
  },

  gsap: {
    composables: true,
    extraPlugins: {
      scrollTo: true,
      scrollTrigger: true
    },
  },

  compatibilityDate: '2024-07-09',
})
