import { computed, isReactive } from 'vue';

const revisions = new WeakMap();

export function fingerprint(value) {
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

// Vue invalidates the computed value synchronously on nested edits. Repeated
// reads are cheap, and writes cannot reuse a hash from before an unflushed watcher.
export function documentRevision(texture) {
  if (!isReactive(texture)) return fingerprint(texture);
  let revision = revisions.get(texture);
  if (!revision) {
    revision = computed(() => fingerprint(texture));
    revisions.set(texture, revision);
  }
  return revision.value;
}
