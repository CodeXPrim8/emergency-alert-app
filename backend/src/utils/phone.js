function normalizePhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[\s().-]/g, '');
  if (compact.startsWith('+')) return compact;
  const digits = compact.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function normalizeEmail(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  return trimmed || null;
}

/** Variants to match phones stored before normalization was consistent. */
function phoneLookupVariants(value) {
  const normalized = normalizePhone(value);
  if (!normalized) return [];

  const digits = normalized.replace(/\D/g, '');
  const variants = new Set([
    normalized,
    String(value || '').trim(),
    digits,
    `+${digits}`,
  ]);

  if (digits.length === 10) variants.add(`+1${digits}`);
  if (digits.length === 11 && digits.startsWith('1')) {
    variants.add(`+${digits}`);
    variants.add(digits.slice(1));
  }

  return [...variants].filter(Boolean);
}

module.exports = { normalizePhone, normalizeEmail, phoneLookupVariants };
