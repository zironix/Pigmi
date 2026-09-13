// Keep the historical rounded spacing, including exact first/last endpoints.
export function redistributeColorOffsets(offsets) {
  const last = offsets.length - 1;
  const spacing = last > 0 ? Math.round(100 / last) : 0;
  for (let index = 0; index <= last; index++) {
    offsets[index] = index === last && last > 0 ? 100 : index * spacing;
  }
}
