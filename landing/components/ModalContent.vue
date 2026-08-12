<template>
  <VueFinalModal
    class="confirm-modal"
    content-class="confirm-modal-content"
    overlay-transition="vfm-fade"
    content-transition="vfm-fade"
  >
    <h1 v-html="title"></h1>
    <p>
      <slot/>
    </p>
    <div class="form" @click="errors = false" v-if="!isSent">
      <input type="text" v-model="user_data.name" placeholder="Имя">
      <input type="email" :class="{error: errors}" v-model="user_data.email" placeholder="Email">
      <input type="text" :class="{error: errors}" v-model="user_data.phone" placeholder="Телефон">
    </div>
    <div v-else class="sent-container">
      <div class="sent-msg">Сообщение успешно отправлено</div>
      <div class="btn close" @click="emit('confirm')">Закрыть</div>
    </div>
    
    <div class="button-container" v-if="!isSent">
      <button class="btn close" @click="emit('confirm')">
        Закрыть
      </button>
      <button class="btn" @click="send">
        Отправить
      </button>
    </div>
    <div class="info">
      <div class="item">
        <div class="left"><i class="las la-phone"></i>
          <a href="tel:+79037000024">+7 (903) 700 00 24</a></div>
        <div class="right">Пн-Пт 9:00 - 18:00</div>
      </div>
<!--      <div class="item">
        <div class="left"><i class="las la-envelope"></i>
          <a href="mailto:info@smarts.ooo">info@smarts.ooo</a></div>
      </div>-->
    </div>
  </VueFinalModal>
</template>
<script setup lang="ts">
import {VueFinalModal} from 'vue-final-modal'
import { useNuxtApp } from '#app'
const ctx = useNuxtApp()

const props = defineProps<{
  title: string
}>()
const emit = defineEmits<{
  (e: 'confirm'): void
}>()
const user_data = reactive({
  name: '',
  email: '',
  phone: '',
  both: '',
  source: '',
})
let errors = ref(false)
let isSent = ref(false)
const send = async () => {
  if (user_data.email === '' && user_data.phone === '') {
    errors.value = true
  }
  if (!errors.value) {
    user_data.source = props.title
    const {data} = await useFetch(() => `/send.php`, {
      method: 'POST',
      body: user_data
    })
    isSent.value = true
    if (process.client){
      //ctx.$metrika.reachGoal('submitted')
    }
  }
}
</script>
<style lang="scss">
.confirm-modal {
  display: flex;
  justify-content: center;
  align-items: center;
  
  .info{
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-top: 2px solid #141414;
    margin-top: 30px;
    padding: 15px 0;
    color: white;
    .item{
      display: flex;
      width: 100%;
      align-items: center;
      font-size: 14px;
      .left{
        display: flex;
        align-items: center;
        gap: 10px;
        color: rgba(255, 255, 255, 0.7);
      }
      .right{
        margin-left: auto;
        color: rgba(255, 255, 255, 0.7);
        background: #161616;
        padding: 0 10px;
        border-radius: 4px;
        font-size: 12px;
      }
      i{
        color: #ffc006;
      }
    }
  }
  
  .confirm-modal-content {
    display: flex;
    flex-direction: column;
    padding: 30px;
    background: #1c1c1c;
    box-shadow: 0 0 11px black;
    border-radius: 0;
    border: 3px solid #090909;
    max-width: 450px;
    text-align: center;
    font-size: 16px;
    line-height: 25px;
    
    h1 {
      line-height: 27px;
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 15px;
      font-family: "Oswald", sans-serif;
      text-transform: uppercase;
      color: var(--main-color);
      br{
        display: none;
      }
    }
    
    .button-container {
      margin-top: 30px;
      display: flex;
      justify-content: space-between;
      gap: 15px;
      /*.close{
        background: #e9e9e9;
        color: black;
        border: none;
        font-size: 18px;
        padding: 15px 30px;
      }*/
    }
    .btn {
      width: 100%;
      background: var(--main-color);
      color: black;
      padding: 10px 30px;
      font-weight: 600;
      text-transform: uppercase;
      &:hover{
        background: var(--main-color-hover) !important;
        border-color: var(--main-color-hover) !important;
      }
      &.close{
        color: white;
        border-color: #141414;
        background: #141414;
        &:hover{
          border-color: #0e0e0e !important;
          background: #0e0e0e !important;
          color: white !important;
        }
      }
    }
    
    .form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 30px;
      
      input {
        width: 100%;
        padding: 10px 15px;
        transition: all 0.2s ease;
        outline: none;
        font-size: 14px;
        background: #0c0c0c;
        border: 3px solid #090909;
        color: white;
        
        &.error {
          background: #160c0c;
          border: 3px solid #590707;
        }
        &:focus{
          outline: none;
        }
      }
    }
    
    .sent-container {
      display: flex;
      justify-content: space-between;
      flex-direction: column;
      gap: 15px;
      align-items: center;
      margin-top: 30px;
      font-size: 14px;
      font-family: "Nunito Sans", Arial, sans-serif;
      
      
      .sent-msg {
        padding: 10px 30px;
        width: 100%;
        border: 1px dashed #535353;
        color: white;
        float: left;
      }
      
    }
    
  }
}
</style>
