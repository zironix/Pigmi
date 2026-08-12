<template>
  <header>
    
    <div class="menu" :class="{mobileVisible: yScroll > 300}">
      <div class="container">
        
        <nav>
          <li class="item" :class="{active: active_item === index}" v-for="(item, index) in menu_items" :key="item.link"><a :href="item.link">{{ item.text }}</a></li>
        </nav>
        <div class="language-switcher" role="group" :aria-label="t('header.language')">
          <button type="button" :class="{active: locale === 'en'}" :aria-pressed="locale === 'en'" @click="setLocale('en')">EN</button>
          <span>/</span>
          <button type="button" :class="{active: locale === 'ru'}" :aria-pressed="locale === 'ru'" @click="setLocale('ru')">RU</button>
        </div>
        <nav class="mobile" :class="{opened: m_open}">
          <div class="container">
            <li class="item" :class="{active: active_item === index}" v-for="(item, index) in menu_items" :key="item.link"><a :href="item.link" @click="m_open = false">{{ item.text }}</a></li>
          </div>
        </nav>
        <div class="toggler" @click="m_open = !m_open">
          <i class="las la-bars"></i>
        </div>
      </div>
    </div>
    
  </header>
</template>

<script setup lang="ts">
const { $gsap } = useNuxtApp()
const { t, locale, setLocale } = useI18n()
let active_item = ref(0)
let m_open = ref(false)
const { y: yScroll } = useWindowScroll()
const menu_items = computed(() => [
  {
    link:'/#intro',
    text: t('header.home')
  },
  {
    link:'/#about',
    text: t('header.about')
  },
  {
    link:'/#features',
    text: t('header.features')
  },
  {
    link:'/#usage',
    text: t('header.usage')
  },
  {
    link:'/#downloads',
    text: t('header.downloads')
  },
])

onMounted( async () => {
  await nextTick()
  const scrollSections = $gsap.utils.toArray(".anchored");
  scrollSections.forEach((section, i) => {
    //console.log(section)
    useScrollTrigger.create({
      trigger: section,
      start: "top 50%",
      end: "bottom 50%",
      onEnter: () => setActive(i, 'enter', false),
      onEnterBack: () => setActive(i, 'enter', true),
      onLeave: () => setActive(i, 'leave', false),
      onLeaveBack: () => setActive(i, 'leave', false),
      //markers: true
    });
  });
})
const setActive = (index, event, is_back) => {
  if(event === 'enter'){
    active_item.value = index
  }
}
</script>

<style lang="scss" scoped>

</style>
