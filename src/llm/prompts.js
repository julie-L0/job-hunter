import { readFile } from "fs/promises";

const PROMPT_DIR = new URL("../../prompts/", import.meta.url);
const cache = new Map();

/** 读取 prompts/<name>.md 并替换 {{var}} 占位符。 */
export async function loadPrompt(name, vars = {}) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`非法 prompt 名：${name}`);

  let template = cache.get(name);
  if (template === undefined) {
    template = await readFile(new URL(`${name}.md`, PROMPT_DIR), "utf8");
    if (process.env.NODE_ENV === "production") cache.set(name, template);
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}
