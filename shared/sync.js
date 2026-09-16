// Hot reload helper, shared by server and client.

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Make `target` equal to `source` without replacing the object itself: every module keeps
 * a reference to the same CONFIG (or profile) object, so the identity has to survive and
 * only the contents change. Nested plain objects are synced recursively; arrays and
 * scalars are replaced whole; keys missing from `source` are removed.
 */
export function syncInPlace(target, source) {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const [k, v] of Object.entries(source)) {
    if (isPlain(v) && isPlain(target[k])) syncInPlace(target[k], v);
    else target[k] = v;
  }
  return target;
}
