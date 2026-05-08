# Render 部署 Studio Canvas 线上网站版

这条路线不依赖 Vercel。Render 会运行一个 Node 服务，同时托管前端页面和 `/api/*` 后端接口。

## 1. 先准备 Supabase

1. 打开 Supabase。
2. 创建一个新项目。
3. 打开 SQL Editor。
4. 执行 `docs/supabase-schema.sql`。
5. 打开 Authentication -> Providers，确认 Email 登录已启用。

等 Render 部署成功后，把 Render 给你的网址加入 Supabase：

```text
Authentication -> URL Configuration
```

需要加入：

```text
https://你的-render网址.onrender.com
```

## 2. 打开 Render

1. 打开 [https://render.com](https://render.com)
2. 用 GitHub 登录。
3. 点 `New +`。
4. 选 `Web Service`。
5. 选择 GitHub 仓库：

```text
pangxl66/studio-canvas
```

## 3. 填 Render 服务设置

如果 Render 识别到 `render.yaml`，可以按 Blueprint 创建。

如果手动填写，用这些值：

```text
Name: studio-canvas
Runtime: Node
Branch: main
Build Command: npm ci && npm run cloud:build
Start Command: npm start
```

## 4. 填环境变量

在 Render 的 Environment 页面添加：

```text
VITE_SAAS_MOCK=false
VITE_SUPABASE_URL=你的 Supabase Project URL
VITE_SUPABASE_ANON_KEY=你的 Supabase anon public key
VITE_LLM_PROXY_URL=/api/llm/chat

SUPABASE_URL=你的 Supabase Project URL
SUPABASE_ANON_KEY=你的 Supabase anon public key
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key

LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=你的模型 API Key
LLM_MODEL=gpt-5.5
LLM_FAST_MODEL=gpt-5.5
LLM_DEEP_MODEL=gpt-5.5
```

不要添加：

```text
VITE_LLM_API_KEY
VITE_LLM_BASE_URL
```

如果添加错了，`npm run cloud:build` 会故意失败，避免把模型密钥打进前端。

## 5. 部署后检查

部署成功后访问：

```text
https://你的-render网址.onrender.com/api/health
```

如果看到：

```json
{
  "ok": true
}
```

说明后端环境变量齐了。

## 6. 完整测试顺序

1. 打开 Render 网站地址。
2. 输入邮箱登录。
3. 到邮箱点击登录链接。
4. 回到网站，确认右上角出现账号和额度。
5. 新建一个节点。
6. 文件菜单里保存到云端。
7. 刷新页面，再打开云端工程。
8. 生成一次提示词，确认额度减少。
9. 到 Supabase `usage_events` 表确认有调用记录。

## 7. 常见问题

### 构建失败，提示缺少 Supabase 变量

说明 Render 的 Environment 没填完整。补齐 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。

### 构建失败，提示不能使用 `VITE_LLM_API_KEY`

这是安全保护。删除 `VITE_LLM_API_KEY`，只保留 `LLM_API_KEY`。

### 登录邮件点回后没登录

去 Supabase Authentication -> URL Configuration，把 Render 网址加入允许跳转地址。

### `/api/health` 不是 `ok: true`

说明服务端环境变量缺失。先看返回的 `checks` 哪个是 false，再回 Render 补变量。
