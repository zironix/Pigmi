export function isPlatformPrimaryModifier({ platform, ctrlKey = false, metaKey = false } = {}) {
  return platform === 'darwin' ? metaKey : ctrlKey;
}

export function isPlatformDeleteKey({ platform, code } = {}) {
  return code === 'Delete' || (platform === 'darwin' && code === 'Backspace');
}
