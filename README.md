# 简博客

一个基于 `React + Vite + Express + SQLite` 的轻量博客系统，支持前台浏览、后台写作、文件导入上传，以及基于 Dify 的 AI 博客助手。

## 功能概览

- 前台文章浏览、搜索、排序、详情阅读
- 后台登录与文章管理
- 富文本编辑与段落级写作辅助
- PDF / DOCX 导入
- 图片、附件、封面上传
- 用户端站内文章问答与推荐
- 管理员 AI 写作、改写、续写、局部补充

## 技术栈

- 前端：`React 19`、`react-router-dom`、`Vite`
- 后端：`Express 5`
- 存储：`SQLite`（`better-sqlite3`）+ 本地文件上传
- 编辑器：`TipTap`
- 文档解析：`mammoth`、`pdf-parse`
- AI：`Dify Chat API`

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 复制环境变量模板：

macOS / Linux:

```bash
cp .env.production.example .env.production
```

Windows PowerShell:

```powershell
Copy-Item .env.production.example .env.production
```

3. 在 Dify 中导入工作流文件：

```text
workflowsdify/bolg-assistant.yml
```

导入后，按你自己的环境完成模型与相关插件配置，然后发布应用并获取 API Key。

4. 修改 `.env.production`

如果你暂时不接 Dify，可以先只修改后台账号密码，保留其他默认值；如果你需要启用 AI，再补充 Dify 配置。

最少建议确认这几项：

```env
BLOG_ADMIN_USERNAME=admin
BLOG_ADMIN_PASSWORD=replace-with-strong-password
DIFY_API_KEY=replace-with-your-dify-api-key
DIFY_BASE_URL=http://127.0.0.1
DIFY_API_PATH=/chat-messages
```

其中：

- `DIFY_API_KEY` 填你在 Dify 发布应用后拿到的 API Key
- `DIFY_BASE_URL` 填 Dify 服务地址，项目会自动补 `/v1`

5. 启动项目：

```bash
npm run dev
```

6. 打开开发地址：

- 用户端：`http://127.0.0.1:5200`
- 管理端登录页：`http://127.0.0.1:5200/admin/login`

7. 使用后台账号登录后，即可进入文章管理与编辑页面；如果 Dify 配置正确，前台助手和后台 AI 写作也会一并生效。


## 环境变量

项目启动时会读取根目录下的 `.env.production`。

示例：

```env
PORT=4000
VITE_API_BASE_URL=/api
BLOG_ADMIN_USERNAME=admin
BLOG_ADMIN_PASSWORD=replace-with-strong-password
DIFY_API_KEY=replace-with-your-dify-api-key
DIFY_BASE_URL=http://127.0.0.1
DIFY_USER_PREFIX=blog-user
DIFY_API_PATH=/chat-messages
```

说明：

- `VITE_API_BASE_URL`：前端请求 API 的地址
  - 同服务部署时使用 `/api`
  - 前后端分离时可改为 `https://your-domain.com/api`
- `BLOG_ADMIN_USERNAME` / `BLOG_ADMIN_PASSWORD`：后台登录账号密码
- `DIFY_API_KEY`：Dify 应用 API Key
- `DIFY_BASE_URL`：Dify 服务地址
- `DIFY_API_PATH`：通常为 `/chat-messages`

## Dify 集成

项目中的 AI 能力通过后端转发到 Dify，不会在前端暴露 Dify Key。

调用链路：

```text
浏览器前端
-> /api/assistant/chat
-> Express 后端
-> Dify
```

后端会传入这些核心变量：

- `IsAdmin`
- `query`
- `selectedText`
- `blog_context`

其中 `blog_context` 会包含文章上下文、当前文章、相关文章和会话历史。

### 工作流简介

管理员场景：

```text
用户输入
-> IsAdmin = true
-> 判断是否需要搜索
-> 需要搜索：生成搜索词 -> 搜索 -> 组织结果 -> 回答 / 写入
-> 不需要搜索：直接回答 / 写入
```

普通用户场景：

```text
用户输入
-> IsAdmin = false
-> 仅回答站内博客相关内容
-> 非博客问题直接拒答
```

### 推荐输出格式

后端默认支持如下结构：

```json
{
  "action": "reply",
  "format": "markdown",
  "content": "返回内容",
  "openArticles": []
}
```

可选 `action`：

- `reply`
- `insert`
- `replace`

## Dify 工作流复现

仓库中已提供 Dify 工作流文件：

```text
workflowsdify/bolg-assistant.yml
```

直接在 Dify 中导入即可复现项目里的工作流结构，再按你自己的环境补充模型、密钥和相关服务配置即可。