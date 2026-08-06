import { config } from "../config.js";
import { grantUserAccess, larkRequest } from "../storage/lark-client.js";

const CHILDREN_PER_CALL = 40;

function textBlock(line) {
  // 空行也必须带一个 content 为空串的 text_run。elements 传空数组飞书会拒（1770001 invalid param），
  // 而准备文档的内容里 `\n\n` 是常态，不处理的话整个建文档流程必失败。
  return {
    block_type: 2,
    text: { elements: [{ text_run: { content: line } }], style: {} },
  };
}

/** 追加纯文本段落。只追加不覆盖，所以不需要用户确认（PRD 原则 4）。 */
export async function appendDocText(documentId, text) {
  if (config.lark.mock) return;
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i += CHILDREN_PER_CALL) {
    await larkRequest(
      "POST",
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
      { body: { children: lines.slice(i, i + CHILDREN_PER_CALL).map(textBlock), index: -1 } },
    );
  }
}

/**
 * 新建准备文档并把访问权限授给 lijue 本人。
 * 应用创建的文档默认只有应用能看，不授权她点自己的链接会 403。
 */
export async function createPrepDoc({ title, content = "" }) {
  // 文档走的是 docx API，不是 bitable，LARK_MOCK 的内存数据源挡不住它。
  // 不在这里也挡一道，本地假数据模式下点一次「建准备文档」就会在她云空间里留一个真文档。
  if (config.lark.mock) {
    const documentId = `docMOCK${Date.now().toString(36)}`;
    return { documentId, url: `${config.lark.docUrlBase}${documentId}`, grant: { mock: true } };
  }

  const { data } = await larkRequest("POST", "/docx/v1/documents", {
    body: {
      title,
      ...(config.lark.docFolderToken ? { folder_token: config.lark.docFolderToken } : {}),
    },
  });

  const documentId = data.document.document_id;
  if (content) await appendDocText(documentId, content);
  const grant = await grantUserAccess(documentId, "docx").catch((error) => ({ error: error.message }));

  return { documentId, url: `${config.lark.docUrlBase}${documentId}`, grant };
}
