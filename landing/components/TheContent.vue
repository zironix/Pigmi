<template>
  <main>
    <section class="intro anchored" id="intro">
      <div class="backdrop"></div>
      <div class="intro-content">
        <div class="logo">
          <div class="s1"></div>
          <div class="s2"></div>
          <div class="s3"></div>
          <div class="s4"></div>
        </div>
        
        <div class="text">PIGMI</div>
        <div class="text-sm">{{ t('hero.tagline') }}</div>
        <a href="https://github.com/zironix/Pigmi/releases/latest" class="download" target="_blank" rel="noopener noreferrer">
          <div class="icon">
            <i class="las la-download"></i>
          </div>
          <div>{{ t('hero.download') }}</div>
          <div class="sep"></div>
          <div>GitHub</div>
        </a>
        <div class="info">
          <div>macOS</div>
          <div>Windows</div>
          <div>Linux</div>
        </div>
      </div>
    </section>
    <section class="about anchored" id="about">
      <div class="container">
        <h1 class="fade-up">{{ t('about.heading') }}</h1>
        <p class="fade-up">{{ t('about.subtitle') }}</p>
        <div class="row">
          <div class="col fade-up">
            <h2>{{ t('about.title') }}</h2>
            <p>{{ t('about.p1') }}</p>
            <p>{{ t('about.p2') }}</p>
            <p>{{ t('about.p3') }}</p>
            <p>{{ t('about.p4') }}</p>
            <div class="jump">
              <a class="btn fade-up" href="#downloads">
                {{ t('about.jump') }}
              </a>
            </div>
            
          </div>
          <div class="col fade-up" style="flex-grow: 0">
            <div class="skin-changer">
              <div class="skins">
                <div class="skin s1" :class="{active: selected_palette === 1}"><img src="/models/t1.webp"></div>
                <div class="skin s2" :class="{active: selected_palette === 2}"><img src="/models/t2.webp"></div>
                <div class="skin s3" :class="{active: selected_palette === 3}"><img src="/models/t3.webp"></div>
              </div>
              <div class="palettes">
                <div class="palette p1" :class="{active: selected_palette === 1}" @click="selected_palette = 1">
                  <div></div>
                  <div></div>
                  <div></div>
                </div>
                <div class="palette p2" :class="{active: selected_palette === 2}" @click="selected_palette = 2">
                  <div></div>
                  <div></div>
                  <div></div>
                </div>
                <div class="palette p3" :class="{active: selected_palette === 3}" @click="selected_palette = 3">
                  <div></div>
                  <div></div>
                  <div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    <section class="features anchored" id="features">
      <div class="container">
        <h1 class="fade-up">{{ t('features.heading') }}</h1>
        <p class="fade-up">{{ t('features.subtitle') }}</p>
        <div class="features">
          <div class="feature fade-up">
            <div class="image"><img src="/models/palette_painter.webp"></div>
            <div class="title">{{ t('features.easyTitle') }}</div>
            <div class="desc">{{ t('features.easyDesc') }}</div>
          </div>
          <div class="feature fade-up">
            <div class="image"><img src="/models/tree.webp"></div>
            <div class="title">{{ t('features.gameTitle') }}</div>
            <div class="desc">{{ t('features.gameDesc') }}</div>
          </div>
        </div>
        <div class="features fade-up">
          <div class="feature">
            <div class="image"><img src="/models/cars.webp"></div>
            <div class="title">{{ t('features.pbrTitle') }}</div>
            <div class="desc">{{ t('features.pbrDesc') }}</div>
          </div>
          <div class="feature fade-upc">
            <div class="image"><img src="/models/trees.webp"></div>
            <div class="title">{{ t('features.syncTitle') }}</div>
            <div class="desc">{{ t('features.syncDesc') }}</div>
          </div>
        </div>
      </div>
    </section>
    <section class="usage anchored" id="usage">
      <div class="container">
        <h1 class="fade-up">{{ t('usage.heading') }}</h1>
        <p class="fade-up">{{ t('usage.subtitle') }}</p>
        <div class="row fade-up">
          <div class="col">
            <div class="title"><i class="las la-rocket"></i>{{ t('usage.gettingStarted.title') }}</div>
            <ul>
              <li>{{ t('usage.gettingStarted.i1') }}</li>
              <li>{{ t('usage.gettingStarted.i2') }}</li>
              <li>{{ t('usage.gettingStarted.i3') }}</li>
              <li>{{ t('usage.gettingStarted.i4') }}</li>
              <li>{{ t('usage.gettingStarted.i5') }}</li>
            </ul>
          </div>
          <div class="col">
            <div class="title"><i class="las la-gamepad"></i>{{ t('usage.controls.title') }}</div>
            <ul>
              <li>{{ t('usage.controls.i1') }}</li>
              <li>{{ t('usage.controls.i2') }}</li>
              <li>{{ t('usage.controls.i3') }}</li>
              <li>{{ t('usage.controls.i4') }}</li>
              <li>{{ t('usage.controls.i5') }}</li>
            </ul>
          </div>
        </div>
        <div class="row fade-up single">
          <div class="col" style="flex-basis: 100%">
            <div class="left">
              <div class="title"><i class="las la-layer-group"></i>{{ t('usage.layers.title') }}</div>
              <p>{{ t('usage.layers.desc') }}</p>
              <ul>
                <li><strong>{{ t('usage.layers.k1') }}</strong> — {{ t('usage.layers.a1') }}</li>
                <li><strong>{{ t('usage.layers.k2') }}</strong> — {{ t('usage.layers.a2') }}</li>
                <li><strong>{{ t('usage.layers.k3') }}</strong> — {{ t('usage.layers.a3') }}</li>
                <li><strong>{{ t('usage.layers.k4') }}</strong> — {{ t('usage.layers.a4') }}</li>
                <li><strong>{{ t('usage.layers.k5') }}</strong> — {{ t('usage.layers.a5') }}; <strong>{{ t('usage.layers.k6') }}</strong> — {{ t('usage.layers.a6') }}</li>
              </ul>
            </div>
            <div class="right">
              <a href="https://github.com/zironix/Pigmi#layers" class="download" target="_blank" rel="noopener noreferrer">{{ t('usage.layers.guide') }}</a>
            </div>
          </div>
        </div>
        <div class="row fade-up single">
          <div class="col" style="flex-basis: 100%">
            <div class="left">
              <div class="title"><i class="las la-plug"></i>{{ t('usage.mcp.title') }}</div>
              <p>{{ t('usage.mcp.desc') }}</p>
              <ul>
                <li>{{ t('usage.mcp.i1') }}</li>
                <li>{{ t('usage.mcp.i2') }}</li>
                <li>{{ t('usage.mcp.i3') }}</li>
                <li>{{ t('usage.mcp.i4') }}</li>
              </ul>
            </div>
            <div class="right">
              <a href="https://github.com/zironix/Pigmi#mcp-automation" class="download" target="_blank" rel="noopener noreferrer">{{ t('usage.mcp.guide') }}</a>
            </div>
          </div>
        </div>
        <div class="row fade-up single">
          <div class="col" style="flex-basis: 100%">
            <div class="left">
              <div class="title"><i class="las la-compress-arrows-alt"></i>{{ t('usage.mrc.title') }}</div>
              <p>{{ t('usage.mrc.desc') }}</p>
            </div>
            <div class="right">
              <div class="mrc">
                <div class="color">
                  <div class="c1">R</div>
                  <div class="name">Metallic</div>
                </div>
                <div class="color">
                  <div class="c2">G</div>
                  <div class="name">Roughness</div>
                </div>
                <div class="color">
                  <div class="c3">B</div>
                  <div class="name">Clearcoat</div>
                </div>
                <div class="color">
                  <div class="c4">A</div>
                  <div class="name">Clearcoat roughness</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="row fade-up single">
          <div class="col" style="flex-basis: 100%">
            <div class="left">
              <div class="title"><i class="la la-file-image"></i>{{ t('usage.mix.title') }}</div>
              <p>{{ t('usage.mix.p1') }}</p>
              <p>{{ t('usage.mix.p2') }}</p>
            </div>
<!--            <div class="right">
              <img src="/models/mixed.jpg" class="miximg">
            </div>-->
          </div>
        </div>
        <div class="usage-subheading fade-up" id="addons">
          <h2>{{ t('addons.heading') }}</h2>
          <p>{{ t('addons.subtitle') }}</p>
        </div>
        <div class="row fade-up single">
          <div class="col" style="flex-basis: 100%">
            <div class="left">
              <div class="title"><i class="las la-th"></i>{{ t('addons.uv.title') }}</div>
              <p>{{ t('addons.uv.desc') }}</p>
              <ul>
                <li><strong>{{ t('addons.uv.k1') }}</strong> — {{ t('addons.uv.a1') }}</li>
                <li><strong>{{ t('addons.uv.k2') }}</strong> — {{ t('addons.uv.a2') }}</li>
                <li><strong>{{ t('addons.uv.k3') }}</strong> — {{ t('addons.uv.a3') }}</li>
                <li><strong>{{ t('addons.uv.k4') }}</strong> — {{ t('addons.uv.a4') }}</li>
                <li><strong>{{ t('addons.uv.k5') }}</strong> — {{ t('addons.uv.a5') }}; <strong>{{ t('addons.uv.k6') }}</strong> — {{ t('addons.uv.a6') }}</li>
                <li><strong>{{ t('addons.uv.k7') }}</strong> — {{ t('addons.uv.a7') }}</li>
                <li><strong>{{ t('addons.uv.k8') }}</strong> — {{ t('addons.uv.a8') }}</li>
                <li><strong>{{ t('addons.uv.k9') }}</strong> — {{ t('addons.uv.a9') }}</li>
              </ul>
            </div>
            <div class="right">
              <a href="https://github.com/zironix/Pigmi/raw/refs/heads/main/Pigmi%20Helpers/pigmi_uv2palette.py" class="download" target="_blank" rel="noopener noreferrer">{{ t('addons.download') }}</a>
            </div>
          </div>
        </div>
        <div class="row fade-up single">
          <div class="col" style="flex-basis: 100%">
            <div class="left">
              <div class="title"><i class="las la-highlighter"></i>{{ t('addons.highlighter.title') }}</div>
              <p>{{ t('addons.highlighter.desc') }}</p>
              <ul>
                <li><strong>{{ t('addons.highlighter.k1') }}</strong> — {{ t('addons.highlighter.a1') }}</li>
                <li><strong>{{ t('addons.highlighter.k2') }}</strong> — {{ t('addons.highlighter.a2') }}; <strong>{{ t('addons.highlighter.k3') }}</strong> — {{ t('addons.highlighter.a3') }}</li>
                <li><strong>{{ t('addons.highlighter.k4') }}</strong> — {{ t('addons.highlighter.a4') }}</li>
              </ul>
            </div>
            <div class="right">
              <a href="https://github.com/zironix/Pigmi/raw/refs/heads/main/Pigmi%20Helpers/pigmi_highlighter.py" class="download" target="_blank" rel="noopener noreferrer">{{ t('addons.download') }}</a>
            </div>
          </div>
        </div>
        <div class="row fade-up single">
          <div class="col" style="flex-basis: 100%">
            <div class="left">
              <div class="title"><i class="las la-magnet"></i>{{ t('addons.face.title') }}</div>
              <p>{{ t('addons.face.desc') }}</p>
              <ul>
                <li><strong>{{ t('addons.face.k1') }}</strong> — {{ t('addons.face.a1') }}</li>
                <li><strong>{{ t('addons.face.k2') }}</strong> — {{ t('addons.face.a2') }}</li>
              </ul>
            </div>
            <div class="right">
              <a href="https://github.com/zironix/Pigmi/raw/refs/heads/main/Pigmi%20Helpers/pigmi_face2face.py" class="download" target="_blank" rel="noopener noreferrer">{{ t('addons.download') }}</a>
            </div>
          </div>
        </div>
      </div>
    </section>
    
    <section class="downloads anchored" id="downloads">
      <div class="container">
        <h1 class="fade-up">{{ t('downloads.heading') }}</h1>
        <p class="fade-up">{{ t('downloads.subtitle') }}</p>
        <div class="row">
          <div class="col fade-up">
            <div class="items">
              <div class="item">
                <div class="title"><div>{{ t('downloads.main') }}</div></div>
                <div class="i-row">
                  <div class="icon"><i class="la la-rocket"></i></div>
                  <div class="name">
                    <div class="top">Pigmi v2.0.3</div>
                    <div class="desc">{{ t('downloads.release') }}</div>
                  </div>
                  <a class="dl" href="https://github.com/zironix/Pigmi/releases/latest" target="_blank" rel="noopener noreferrer"> {{ t('downloads.github') }} <i class="las la-download"></i></a>
                </div>
                <div class="i-row">
                  <div class="icon"><i class="lab la-github"></i></div>
                  <div class="name">
                    <div class="top">{{ t('downloads.source') }}</div>
                    <div class="desc">{{ t('downloads.sourceDesc') }}</div>
                  </div>
                  <a class="dl" href="https://github.com/zironix/Pigmi" target="_blank" rel="noopener noreferrer"> {{ t('downloads.github') }} <i class="las la-external-link-alt"></i></a>
                </div>
              </div>
            </div>
          </div>
          <div class="col fade-up">
            <div class="items">
              <div class="item">
                <div class="title"><div>{{ t('downloads.addons') }}</div></div>
                <div class="i-row">
                  <div class="icon"><i class="las la-th"></i></div>
                  <div class="name">
                    <div class="top">UV to Palette</div>
                    <div class="desc">{{ t('downloads.uvDesc') }}</div>
                  </div>
                  <a class="dl" href="https://github.com/zironix/Pigmi/raw/refs/heads/main/Pigmi%20Helpers/pigmi_uv2palette.py" target="_blank" rel="noopener noreferrer"> {{ t('downloads.github') }} <i class="las la-download"></i></a>
                </div>
                <div class="i-row">
                  <div class="icon"><i class="las la-highlighter"></i></div>
                  <div class="name">
                    <div class="top">Highlighter</div>
                    <div class="desc">{{ t('downloads.highlighterDesc') }}</div>
                  </div>
                  <a class="dl" href="https://github.com/zironix/Pigmi/raw/refs/heads/main/Pigmi%20Helpers/pigmi_highlighter.py" target="_blank" rel="noopener noreferrer"> {{ t('downloads.github') }} <i class="las la-download"></i></a>
                </div>
                <div class="i-row">
                  <div class="icon"><i class="las la-magnet"></i></div>
                  <div class="name">
                    <div class="top">Face to Face</div>
                    <div class="desc">{{ t('downloads.faceDesc') }}</div>
                  </div>
                  <a class="dl" href="https://github.com/zironix/Pigmi/raw/refs/heads/main/Pigmi%20Helpers/pigmi_face2face.py" target="_blank" rel="noopener noreferrer"> {{ t('downloads.github') }} <i class="las la-download"></i></a>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="row">
          <div class="col fade-up">
            <div class="items">
              <div class="item donate">
                <div class="title"><div>{{ t('donations.heading') }}</div></div>
                <div class="i-row">
                  <div class="text">
                    {{ t('donations.text') }}
                  </div>
                  <div class="pay-items">
                    <div class="item">
                      <div class="name">SBER (RU)</div>
                      <div class="value">2202 2053 0426 3772</div>
                    </div>
                    <a class="item" href="https://www.donationalerts.com/r/zenoxus" target="_blank">
                      <div class="name">Donationalerts</div>
                      <div class="value"><i class="las la-link"></i></div>
                    </a>
                    <a class="item" href="https://t.me/godot3d" target="_blank">
                      <div class="name">{{ t('donations.channel') }}</div>
                      <div class="value"><i class="lab la-telegram"></i></div>
                    </a>
                    <a class="item" href="https://t.me/zironix" target="_blank">
                      <div class="name">{{ t('donations.personal') }}</div>
                      <div class="value"><i class="lab la-telegram"></i></div>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    <div :class="{visible: yScroll > 1000}" class="back-to-top" @click="toTop()"><i class="las la la-angle-up"></i></div>
  </main>
</template>

<script setup lang="ts">
import { CustomEase } from "gsap/CustomEase"

const { $gsap } = useNuxtApp()
const { t } = useI18n()
$gsap.registerPlugin(CustomEase)

const { y: yScroll } = useWindowScroll()
const { width: windowWidth, height: windowHeight } = useWindowSize()


let selected_palette : any = ref(1)




const toTop = () => {
  window.scrollTo({top: 0, behavior: 'smooth'})
}

const loaded = () => {
  let responsive = {
  
  }
  $gsap.timeline()
    .to('.intro-content .logo', {
      opacity: 1,
      width: 200,
      ease: "power4",
      duration: 1.5,
      delay: 0
    })
    .to('.intro-content .logo div', {
      opacity: 1,
      "--bscale": '50%',
      ease: CustomEase.create("custom", "M0,0 C0.057,0.112 0.036,1.103 0.465,0.762 0.767,0.52 0.839,0.541 1,1 "),
      duration: 1.5,
      stagger: 0.2,
      delay: 0
    },0)
    .to('.intro-content .logo div', {
      "--brotate": '45deg',
      "--bscale": '100%',
      y: -130,
      ease: "power1",
      duration: 1,
      stagger: 0.05
    }, '-=1')
    .to('.intro-content .text', {
      ease: "none",
      opacity: 1,
      duration: 2,
    }, '-=0.5')
    .to('.intro-content .text-sm', {
      ease: "none",
      opacity: .7,
      duration: 2,
    }, '-=1.5')
    .from('.intro-content .download', {
      ease: "sine",
      opacity: 0,
      duration: .8,
      y: 50
    }, '-=1')
    .from('.intro-content .info', {
      ease: "sine",
      y: -50,
      opacity: 0,
      duration: .8,
    }, '-=.5')
  
  $gsap.utils.toArray('.fade-up').forEach((box) => {
    $gsap.from(box, {
      y: 100,
      duration: 1,
      opacity: 0,
      scrollTrigger: {
        trigger: box,
        start: 'top bottom',
        /*markers: true,*/
      }
    })
  })
}

onMounted(async () => {
  //await nextTick()
  loaded()
  
})

/*onMounted(() => {
  let threshold = []
  for (let i = 0; i <= 1.0; i += 0.01) {
    threshold.push(i);
  }
  const observer = new IntersectionObserver(handleIntersection, {
    threshold: threshold,
  })
  observer.observe(aboutText.value)
})*/
/*const handleIntersection = (entries) => {
  entries.forEach((entry) => {
    console.log(entry)
  })
}*/
</script>

<style lang="scss" scoped>

</style>
