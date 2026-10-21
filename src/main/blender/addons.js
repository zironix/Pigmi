// Pigmi Helpers add-ons installed into Blender, in display order. Each file is
// downloaded from the repository's main branch, independently of Pigmi releases.
export const BLENDER_ADDONS = Object.freeze([
  { id: 'uv2palette', fileName: 'pigmi_uv2palette.py', name: 'Pigmi: UV to Palette' },
  { id: 'highlighter', fileName: 'pigmi_highlighter.py', name: 'Pigmi: Highlighter' },
  { id: 'face2face', fileName: 'pigmi_face2face.py', name: 'Pigmi: Face to Face' },
]);

export function addonDownloadUrl(fileName) {
  return `https://raw.githubusercontent.com/zironix/Pigmi/main/Pigmi%20Helpers/${encodeURIComponent(fileName)}`;
}
