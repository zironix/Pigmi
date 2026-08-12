import { useNuxtApp } from '#app'
export function useForm(source) {
  const ctx = useNuxtApp()
    const userData = reactive({
        name: '',
        email: '',
        phone: '',
        question: '',
        both: '',
        source: source,
    })
    let errors = ref(false)
    let isSent = ref(false)
    const send = async () => {
        if(userData.phone === ''){
            errors.value = true
        }
        if(!errors.value){
            const { data } = await useFetch(() => `/send.php`, {
                method: 'POST',
                body: userData,
                watch: false
            })
            isSent.value = true
            userData.name = '';
            userData.email = '';
            userData.phone = '';
            userData.question = '';
            userData.both = '';
            userData.source = '';
            if (process.client){
              ctx.$metrika.reachGoal('submitted')
            }
        }
    }
    return { userData,  errors, isSent, send}
}
