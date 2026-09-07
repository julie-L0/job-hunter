# Errors

## [ERR-20260903-001] 本地 Playwright 未安装可用浏览器

**Priority**: low
**Status**: resolved
**Area**: tools

### 摘要
仓库内无法直接导入 Playwright；Node REPL 提供的 Playwright 也没有已下载的内置 Chromium。

### 错误信息
```text
ERR_MODULE_NOT_FOUND: Cannot find package 'playwright'
Executable doesn't exist: chromium_headless_shell.exe
```

### 上下文
- 为前端改动执行桌面和 390px 窄屏浏览器验收。

### 建议修复
通过 Node REPL 使用 Playwright，并将 `executablePath` 指向系统已安装的 Chrome；无需给项目新增依赖或下载浏览器。

### 元数据
- Reproducible: yes

---

## [ERR-20260907-001] Git 提交缺少作者配置

**Priority**: low
**Status**: resolved
**Area**: config

### 摘要
仓库没有本地或全局 `user.name`、`user.email`，导致已检查并暂存的改动无法提交。

### 错误信息
```text
Author identity unknown
fatal: unable to auto-detect email address
```

### 上下文
- 执行 `git commit` 时失败。
- 历史提交已有稳定作者身份。

### 建议修复
从最近提交读取既有作者身份，仅写入当前仓库的 Git 配置后重试；不要修改全局配置或擅自匿名化作者。

### 元数据
- Reproducible: yes
- See Also: LRN-20260902-001

---
