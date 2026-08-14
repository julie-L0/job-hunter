const MINI_PROGRAM_PREFIX = "#小程序://";

export function cleanSiteLink(value) {
  return String(value || "").trim();
}

export function isMiniProgramLink(value) {
  return cleanSiteLink(value).startsWith(MINI_PROGRAM_PREFIX);
}

export function isWebUrl(value) {
  const text = cleanSiteLink(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function siteLinkLabel(value) {
  if (isMiniProgramLink(value)) return "复制小程序链接";
  if (isWebUrl(value)) return "官网";
  return cleanSiteLink(value) ? "复制链接" : "";
}
