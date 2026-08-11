const cleanText = (value) => String(value ?? "").trim();

export function larkText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object" && "text" in item) return item.text;
      return String(item ?? "");
    }).join("").trim();
  }
  if (typeof value === "object" && "text" in value) return cleanText(value.text);
  return cleanText(value);
}

export function buildExperienceMigrationPatch(fields) {
  const patch = {};
  const currentSummary = larkText(fields["经历摘要"]);
  const currentContent = larkText(fields["经历正文"]);

  if (!currentSummary) {
    const summary = larkText(fields["100字版"]) || larkText(fields["50字版"]);
    if (summary) patch["经历摘要"] = summary;
  }

  if (!currentContent) {
    const star = larkText(fields.STAR全文);
    if (star) patch["经历正文"] = star;
  }

  return patch;
}
