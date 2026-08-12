import type { RouterOptions } from '@nuxt/schema'

export default <RouterOptions> {
    async scrollBehavior(to, from, savedPosition) {
      //const nuxtApp = useNuxtApp()
      const findEl = (hash: string, x = 0) => {
        return (
          document.querySelector(hash) ||
          new Promise((resolve) => {
            if (x > 50) {
              return resolve(document.querySelector('main'))
            }
            setTimeout(() => {
              resolve(findEl(hash, ++x || 1))
            }, 100)
          })
        )
      }
      if (to.hash) {
        const el: any = await findEl(to.hash)
        if ('scrollBehavior' in document.documentElement.style) {
          if (to.hash === '#about'){
            return window.scrollTo({top: el.offsetTop - 150, behavior: 'smooth'})
          }else{
            return window.scrollTo({top: el.offsetTop, behavior: 'smooth'})
          }

        } else {
          return window.scrollTo(0, el.offsetTop)
        }
      }
    }
}
