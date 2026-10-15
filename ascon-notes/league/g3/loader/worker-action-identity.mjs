import { createHash } from 'node:crypto';

const safeCanonical = (value, seen = new WeakSet(), depth = 0) => {
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
    return { type: 'noncanonical-number' };
  }
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'bigint') return { type: 'bigint' };
  if (typeof value === 'undefined') return { type: 'undefined' };
  if (typeof value === 'function') return { type: 'function' };
  if (typeof value !== 'object') return { type: typeof value };
  if (depth >= 4) return { type: Array.isArray(value) ? 'array' : 'object', truncated: true };
  if (seen.has(value)) return { type: 'circular' };
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return { type: 'unsupported-array' };
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      const hasEnumerableExtra = Reflect.ownKeys(value).some(key => {
        if (key === 'length') return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) return false;
        if (typeof key !== 'string') return true;
        const index = Number(key);
        return !Number.isInteger(index) || index < 0 || index >= length || String(index) !== key;
      });
      if (hasEnumerableExtra) return { type: 'unsupported-array' };
      return { type: 'array', length, ...(length > 32 ? { truncated: true } : {}),
        items: Array.from({ length: Math.min(length, 32) }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          return !descriptor ? { type: 'hole' } : 'value' in descriptor
            ? safeCanonical(descriptor.value, seen, depth + 1) : { type: 'accessor' };
        }) };
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return { type: 'unsupported-object' };
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allKeys = Object.keys(descriptors).filter(key => descriptors[key].enumerable).sort();
    const keys = allKeys.slice(0, 32);
    return { type: 'object', ...(allKeys.length > 32 ? { truncated: true } : {}),
      fields: keys.map(key => [key, 'value' in descriptors[key]
      ? safeCanonical(descriptors[key].value, seen, depth + 1) : { type: 'accessor' }]) };
  } catch { return { type: 'uninspectable-object' }; }
  finally { seen.delete(value); }
};

// Bounded digest only; any shape/value omitted by the bound returns null and remains BLOCKED.
export function hashActionIdentity(value) {
  try {
    const canonical = safeCanonical(value);
    const containsIncompleteIdentity = node => {
      if (!node || typeof node !== 'object') return false;
      if (!Array.isArray(node) && (
        node.truncated === true || ['accessor', 'circular', 'uninspectable-object', 'function', 'symbol',
          'bigint', 'noncanonical-number', 'unsupported-array', 'unsupported-object'].includes(node.type)
      )) return true;
      return Object.values(node).some(containsIncompleteIdentity);
    };
    // A truncated or unsupported shape cannot uniquely identify a submitted action.
    if (containsIncompleteIdentity(canonical)) return null;
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  } catch { return null; }
}
