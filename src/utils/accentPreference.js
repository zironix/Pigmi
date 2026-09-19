export const DEFAULT_ACCENT = '#ea1f62';
const KEY = 'pigmi.accent-color';
const TEXT_KEY = 'pigmi.accent-text';
export const isAccentColor = (value) => /^#[0-9a-f]{6}$/i.test(value);

export function readAccentPreference() {
  try {
    const value = window.localStorage.getItem(KEY);
    return isAccentColor(value) ? value : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function readAccentTextPreference() {
  try {
    return window.localStorage.getItem(TEXT_KEY) === 'dark' ? 'dark' : 'white';
  } catch {
    return 'white';
  }
}

export function applyAccentTextPreference(value) {
  const choice = value === 'dark' ? 'dark' : 'white';
  document.documentElement.style.setProperty(
    '--studio-on-primary',
    choice === 'dark' ? '#18191c' : '#ffffff',
  );
  try {
    window.localStorage.setItem(TEXT_KEY, choice);
  } catch {
    /* Keep the session choice. */
  }
}

export function applyAccentPreference(color, persist = false, text = readAccentTextPreference()) {
  if (!isAccentColor(color)) return;
  const rgb = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  const mix = (target, amount) =>
    '#' +
    rgb
      .map((value) =>
        Math.round(value + (target - value) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  const luminance = rgb
    .map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const variables = {
    '--studio-accent': color,
    '--studio-primary': color,
    '--studio-primary-hover': mix(luminance > 0.4 ? 0 : 255, 0.12),
    '--studio-on-primary': text === 'dark' ? '#18191c' : '#ffffff',
    '--studio-link': mix(255, 0.55),
    '--studio-accent-wash': color + '29',
    '--studio-selection': color + '38',
    '--studio-accent-glow': color + '26',
    '--studio-accent-edge': color + '66',
    '--studio-accent-ambient': color + '0c',
  };
  for (const [name, value] of Object.entries(variables))
    document.documentElement.style.setProperty(name, value);
  if (persist) {
    try {
      window.localStorage.setItem(KEY, color);
    } catch {
      /* Keep the preference for this session if storage is unavailable. */
    }
  }
}
