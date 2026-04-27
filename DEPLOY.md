# 部署说明

这套博客现在支持以 **单个 Node 服务** 的方式部署：

- Express 提供后端 API
- Express 同时托管前端 `dist`
- SQLite 数据库存放在 `server/data/blog.db`
- 上传文件存放在 `server/uploads`

## 一、服务器要求

- Node.js 20+
- Windows / Linux 都可以
- 建议使用 Nginx 或 Caddy 做反向代理

## 二、首次部署

```bash
npm install
npm run build
```

启动服务：

```bash
node server/index.js
```

也可以先复制环境变量模板：

```bash
cp .env.production.example .env.production
```

然后修改 `.env.production` 中的后台账号和密码。

如果你要启用真实 AI 助手，也请一并配置 Dify：

```env
DIFY_API_KEY=你的 Dify 应用密钥
DIFY_BASE_URL=http://127.0.0.1
DIFY_USER_PREFIX=blog-user
DIFY_API_PATH=/chat-messages
```

其中：

- `DIFY_API_KEY` 为必填
- `DIFY_BASE_URL` 为你的 Dify 服务地址，代码会自动补 `/v1`
- `DIFY_API_PATH` 默认为 `/chat-messages`
- 未配置 Dify 时，前端助手会自动退回到本地检索模式

默认端口：

```bash
4000
```

如果要改端口：

```bash
PORT=8080 node server/index.js
```

Windows PowerShell:

```powershell
$env:PORT="8080"
node server/index.js
```

## 三、后台默认账号

默认账号和密码来自环境变量；如果你不设置，会使用：

- 用户名：`admin`
- 密码：`admin123`

建议上线前设置：

Linux/macOS:

```bash
export BLOG_ADMIN_USERNAME="你的账号"
export BLOG_ADMIN_PASSWORD="你的密码"
node server/index.js
```

Windows PowerShell:

```powershell
$env:BLOG_ADMIN_USERNAME="你的账号"
$env:BLOG_ADMIN_PASSWORD="你的密码"
node server/index.js
```

## 四、重要持久化目录

请务必备份这两个目录：

- `server/data/`
- `server/uploads/`

其中：

- `server/data/blog.db` 是数据库
- `server/uploads/` 是你上传的 PDF、附件、图片、封面图

## 五、建议的生产运行方式

建议使用 PM2：

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## 六、反向代理建议

项目已附带 Nginx 示例配置：

```text
deploy/nginx.simple-blog.conf
```

将域名反代到：

```text
http://127.0.0.1:4000
```

因为生产环境下，前端页面、API、上传文件都由同一个 Express 服务提供。

## 七、更新部署

```bash
git pull
npm install
npm run build
pm2 restart simple-blog
```

如果不用 PM2：

```bash
node server/index.js
```

## 八、访问地址

- 前台首页：`/`
- 后台登录：`/admin/login`
- 后台管理：`/admin`
