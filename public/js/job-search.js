function clean(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

export function searchTokens(query) {
  return clean(query).split(/\s+/).filter(Boolean);
}

export function matchesJobSearch(job, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const haystack = clean(`${job?.company || ""} ${job?.position || ""}`);
  return tokens.every((token) => haystack.includes(token));
}
