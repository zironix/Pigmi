<template>
  <main>
    <section class="projects-intro" :style="`background-position: center ${yScroll*0.3}px;`">
      <div class="darkbox"></div>
      <div class="intro-content">
        <div class="text">НАШИ РАБОТЫ</div>
        <div class="text-sm">Качество и надежность в каждом проекте</div>
      </div>
    </section>
    <section class="projects">
      <div class="container">
        <div class="project-item">
          <div class="project-item-content">
            <div class="photos">
              <Splide :options="{
            type   : 'loop',
            perPage: 1,
            perMove: 1,
          }">
                <SplideSlide>
                  <div class="slide-wrapper" style="background-image: url('/projects/1/IMG_4525.jpg')"></div>
                </SplideSlide>
                <SplideSlide>
                  <div class="slide-wrapper" style="background-image: url('/projects/1/msg-523608855-553130.jpg')"></div>
                </SplideSlide>
                <SplideSlide>
                  <div class="slide-wrapper" style="background-image: url('/projects/1/msg-523608855-553130.jpg')"></div>
                </SplideSlide>
              
              </Splide>
            </div>
            <div class="info">
              <div class="name">
                <i class="las la-map-marker"></i>
                <div>Перделкино</div>
              </div>
              <div class="year">2024г.</div>
            </div>
            <div class="desc">Классная работа в Перделкино</div>
          </div>
        </div>
      </div>
    </section>
    <div :class="{visible: yScroll > 1000}" class="back-to-top" @click="toTop()"><i class="las la la-angle-up"></i></div>
  </main>
</template>

<style lang="scss">
.project-item{
  .splide__arrow {
    background: black;
    border-radius: 0;
    top: calc(50% + 20px);
    transition: all .2s ease;
    &--next{
      right: 20px;
    }
    &--prev{
      left: 20px;
    }
    svg{
      fill: white;
    }
  }
  .splide__pagination {
    bottom: 30px;
  }
  .splide__pagination__page {
    border-radius: 0;
    transition: all .2s ease;
    &.is-active{
      background: black;
      opacity: 1;
    }
  }
}

</style>

<script setup lang="ts">
</script>
