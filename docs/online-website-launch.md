# Studio Canvas 线上网站版上线步骤

目标：让别人通过网址打开工具，用邮箱登录，在线保存工程，并通过你的后端安全调用 LLM。

## 1. 线上架构

```text
用户浏览器
  -> Vercel 静态前端
  -> Vercel /api/llm/chat
  -> LLM 上游服务

用户浏览器
  -> Supabase Auth 邮箱登录
  -> Vercel /api/projects
  -> Supabase Database
```

线上版不要把模型密钥放进浏览器环境变量。任何真实 LLM Key 都只能使用 `LLM_API_KEY`，不能使用 `VITE_LLM_API_KEY`。

## 2. Supabase

1. 创建 Supabase 项目。
2. 打开 SQL Editor。
3. 执行 `docs/supabase-schema.sql`。
4. 打开 Authentication -> Providers，确认 Email 登录已启用。
5. 打开 Authentication -> URL Configuration，把本地和线上域名加入允许地址。

本地联调地址：

```text
http://127.0.0.1:3000
http://localhost:3000
```

Vercel 部署后再加入：

```text
https://你的项目名.vercel.app
https://你的自定义域名
```

## 3. GitHub

把源码推到 GitHub。不要提交这些内容：

```text
.env.local
.vercel/
dist/
node_modules/
*.zip
```

这些已经在 `.gitignore` 里保护了。

## 4. Vercel

1. 打开 Vercel。
2. Import Git Repository。
3. 选择这个 GitHub 仓库。
4. Framework Preset 选择 Vite。
5. Build Command 保持项目里的 `vercel.json` 配置。
6. Output Directory 为 `dist`。

## 5. Vercel 环境变量

在 Vercel Project Settings -> Environment Variables 填：

```text
VITE_SAAS_MOCK=false
VITE_SUPABASE_URL=你的 Supabase Project URL
VITE_SUPABASE_ANON_KEY=你的 Supabase anon public key
VITE_LLM_PROXY_URL=/api/llm/chat
VITE_ADMIN_TOOLS=false

SUPABASE_URL=你的 Supabase Project URL
SUPABASE_ANON_KEY=你的 Supabase anon public key
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
ADMIN_EMAILS=你的管理员邮箱

LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=你的模型 API Key
LLM_MODEL=gpt-5.5
LLM_FAST_MODEL=gpt-5.5
LLM_DEEP_MODEL=gpt-5.5
```

不要在 Vercel 填：

```text
VITE_LLM_API_KEY
VITE_LLM_BASE_URL
```

项目的 `npm run saas:check:prod` 会在部署时检查这一点。如果填错，Vercel 构建会失败，这是为了保护密钥。

## 6. 上线后验证

访问：

```text
https://你的域名/api/health
```

如果返回 `ok: true`，说明后端变量齐了。

然后按顺序测试：

1. 打开网站，看到登录页。
2. 输入邮箱，收到登录链接。
3. 点击邮件链接返回网站。
4. 右上角看到账号和额度。
5. 新建节点，文件菜单保存到云端。
6. 刷新页面，重新打开云端工程。
7. 生成一次提示词，确认额度减少。
8. 在 Supabase `usage_events` 表看到调用记录。

## 7. 常见失败原因

如果 Vercel 构建失败：

- `VITE_SAAS_MOCK` 不是 `false`。
- 缺少 Supabase 环境变量。
- 把 LLM Key 错填成 `VITE_LLM_API_KEY`。

如果登录后回不到网站：

- Supabase URL Configuration 没有加入 Vercel 域名。

如果生成失败：

- `/api/health` 先确认后端变量。
- 再检查 `credit_wallets.remaining_quota` 是否大于 0。
- 再检查 `LLM_BASE_URL` 和 `LLM_API_KEY` 是否正确。
