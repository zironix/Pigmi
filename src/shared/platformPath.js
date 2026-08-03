export function createPathHelpers(platform) {
  const separator = platform === 'win32' ? '\\' : '/';
  const normalizeSeparators = (value) => String(value).replace(/[\\/]/gu, separator);

  return {
    joinPath(...segments) {
      const parts = segments
        .filter((segment) => segment !== null && segment !== undefined && segment !== '')
        .map(normalizeSeparators);

      if (parts.length === 0) return '.';

      return parts.slice(1).reduce((joined, part) => {
        const base = joined.replace(/[\\/]+$/u, '');
        const child = part.replace(/^[\\/]+|[\\/]+$/gu, '');
        return `${base}${separator}${child}`;
      }, parts[0]);
    },
    separator,
  };
}
