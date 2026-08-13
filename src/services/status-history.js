function asMillis(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Date.now();
}

function clean(value) {
  return String(value || "").trim();
}

export function parseStatusHistory(value) {
  if (Array.isArray(value)) return value;
  if (!clean(value)) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeStatusHistory(items) {
  return JSON.stringify((Array.isArray(items) ? items : []).slice(-100));
}

export function appendStatusHistory(value, event) {
  const to = clean(event?.to);
  if (!to) return clean(value);
  const current = parseStatusHistory(value);
  const entry = {
    at: asMillis(event?.at),
    from: clean(event?.from),
    to,
    resumeId: clean(event?.resumeId),
  };
  const duplicated = current.some((item) =>
    Number(item?.at) === entry.at && clean(item?.from) === entry.from && clean(item?.to) === entry.to,
  );
  return serializeStatusHistory(duplicated ? current : [...current, entry]);
}
