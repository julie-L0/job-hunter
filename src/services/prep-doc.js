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
 * 新建准备文档并授权目标用户访问。
 * 应用创建的文档默认只有应用能看，未授权的用户打开链接会 403。
 */
export async function createPrepDoc({ title, content = "" }) {
  // 文档走的是 docx API，不是 bitable，LARK_MOCK 的内存数据源挡不住它。
  // 本地假数据模式必须继续拦截，避免在用户云空间中创建真实文档。
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
