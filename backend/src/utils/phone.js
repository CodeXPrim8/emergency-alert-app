function extractDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function stripTrunkZero(digits) {
  let d = digits;
  while (d.startsWith('0')) d = d.slice(1);
  return d;
}

/** Build equivalent digit keys so 0813…, 813…, +234813… all match. */
function buildPhoneDigitKeys(value) {
  const digits = extractDigits(value);
  if (!digits) return [];

  const keys = new Set([digits, stripTrunkZero(digits)]);

  for (const base of [...keys]) {
    if (!base) continue;

    if (base.startsWith('234') && base.length >= 12) {
      keys.add(base.slice(3));
      keys.add(`0${base.slice(3)}`);
    }

    if (base.length === 10 && /^[789]/.test(base)) {
      keys.add(`234${base}`);
      keys.add(`0${base}`);
    }

    if (base.length === 10) {
      keys.add(`1${base}`);
    }

    if (base.startsWith('1') && base.length === 11) {
      keys.add(base.slice(1));
    }
  }

  return [...keys].filter((k) => k.length >= 7);
}

function phonesMatch(a, b) {
  const keysA = buildPhoneDigitKeys(a);
  const keysB = buildPhoneDigitKeys(b);
  return keysA.some((k) => keysB.includes(k));
}

function normalizePhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/[\s().-]/g, '');
  if (compact.startsWith('+')) return compact;

  let digits = stripTrunkZero(extractDigits(compact));
  if (!digits) return null;

  if (digits.startsWith('234') && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10 && /^[789]/.test(digits)) return `+234${digits}`;
  if (digits.length === 10) return `+1${digits}`;

  return `+${digits}`;
}

function normalizeEmail(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  return trimmed || null;
}

function phoneLookupVariants(value) {
  const normalized = normalizePhone(value);
  const raw = String(value || '').trim();
  const variants = new Set([raw, normalized]);

  for (const key of buildPhoneDigitKeys(value)) {
    variants.add(key);
    variants.add(`+${key}`);
    variants.add(`0${key}`);
    if (key.length === 10 && /^[789]/.test(key)) {
      variants.add(`+234${key}`);
      variants.add(`234${key}`);
    }
  }

  return [...variants].filter(Boolean);
}

module.exports = {
  normalizePhone,
  normalizeEmail,
  phoneLookupVariants,
  buildPhoneDigitKeys,
  phonesMatch,
};
