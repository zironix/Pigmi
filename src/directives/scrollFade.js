const states = new WeakMap();

export const scrollFade = {
  mounted(element) {
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
        element.style.setProperty('--scroll-fade-top', element.scrollTop > 1 ? '12px' : '0px');
        element.style.setProperty('--scroll-fade-bottom', remaining > 1 ? '12px' : '0px');
      });
    };
    const resize = new ResizeObserver(update);
    const observe = () => {
      resize.disconnect();
      resize.observe(element);
      for (const child of element.children) resize.observe(child);
      update();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(element, { childList: true, subtree: true, characterData: true });
    element.classList.add('scroll-fade');
    element.addEventListener('scroll', update, { passive: true });
    observe();
    states.set(element, {
      update,
      cleanup: () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        mutation.disconnect();
        element.removeEventListener('scroll', update);
      },
    });
  },
  updated(element) {
    states.get(element)?.update();
  },
  unmounted(element) {
    states.get(element)?.cleanup();
    states.delete(element);
  },
};
