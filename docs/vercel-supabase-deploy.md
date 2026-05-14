# Studio Canvas 网站版部署联调清单

这份清单用于把当前 SaaS MVP 跑到真实环境：登录、云端工程、额度读取、LLM 后端代理。

## 1. Supabase 准备

1. 新建 Supabase 项目。
2. 打开 SQL Editor。
3. 执行 `docs/supabase-schema.sql`。
4. 在 Authentication -> Providers 中确认 Email 已启用。
5. 在 Authentication -> URL Configuration 中配置站点地址。

本地真实联调可先加入：

```text
http://127.0.0.1:3000
http://localhost:3000
http://127.0.0.1:5173
http://localhost:5173
```

正式 Vercel 域名上线后，再把 Vercel 域名也加入允许跳转地址。

## 2. 本地 `.env.local`

复制 `.env.example` 为 `.env.local`，真实模式至少填写：

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_LLM_PROXY_URL=/api/llm/chat
VITE_SAAS_MOCK=false

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=gpt-5.5
```

注意：

- `VITE_SUPABASE_ANON_KEY` 可以在浏览器公开。
- `SUPABASE_SERVICE_ROLE_KEY` 绝对不能公开，只能放在后端环境变量。
- `LLM_API_KEY` 绝对不能以 `VITE_` 开头。

## 3. 环境自检

```powershell
npm.cmd run saas:check
```

这个命令只检查变量是否存在，不会输出密钥内容。若仍显示缺失，先补 `.env.local` 或 Vercel 环境变量。

## 4. 本地真实联调

普通 `npm run dev` 只跑 Vite 前端，不会完整模拟 Vercel API。真实 Supabase + 后端代理联调请使用：

```powershell
npm.cmd run saas:dev
```

默认打开：

```text
http://127.0.0.1:3000
```

联调顺序：

1. 打开网站，应进入登录页。
2. 输入邮箱，收到魔法链接。
3. 点击邮件链接回到网站。
4. 右上角出现账号信息和额度条。
5. 文件菜单出现“保存到云端”和云端工程列表。
6. 新建一个文本节点，保存到云端。
7. 刷新页面，确认仍为登录状态。
8. 打开云端工程，确认画布恢复。
9. 执行一次文本润色或提示词生成。
10. 检查右上角额度减少。
11. 在 Supabase 的 `usage_events` 表确认有调用记录。

## 5. Mock 模式

如果还没创建 Supabase，也可以先测试网站版登录壳、额度条和云端工程 UI。

```text
VITE_SAAS_MOCK=true
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Mock 模式行为：

- 输入任意邮箱后会立刻登录，不会真的发邮件。
- 右上角显示本地模拟额度，默认 `30/30`。
- “保存到云端”会写入浏览器 `localStorage`，不会访问 Supabase。
- 本地 LLM 生成成功后会模拟扣减 1 次额度。
- 不会强制走 `/api/llm/chat`，可以继续使用本机模型配置测试生成。

关闭 Mock 模式后，改成：

```text
VITE_SAAS_MOCK=false
```

## 6. Vercel 环境变量

在 Vercel Project Settings -> Environment Variables 添加：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_LLM_PROXY_URL=/api/llm/chat
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
LLM_BASE_URL
LLM_API_KEY
LLM_MODEL=gpt-5.5
LLM_FAST_MODEL=gpt-5.5
LLM_DEEP_MODEL=gpt-5.5
```

如果你的上游已经是完整代理地址，可以填：

```text
LLM_PROXY_URL=
```

并且可以不填 `LLM_BASE_URL`。

## 7. 线上健康检查

部署后访问：

```text
https://你的域名/api/health
```

正常时应返回：

```json
{
  "ok": true,
  "checks": {
    "llmApiKey": true,
    "llmUpstream": true,
    "supabaseAnonKey": true,
    "supabaseServiceRoleKey": true,
    "supabaseUrl": true
  }
}
```

这个接口只返回“是否配置”，不会返回任何密钥内容。

## 8. 常见问题

### 登录邮件点回后仍未登录

检查 Supabase Authentication URL Configuration，确认本地或 Vercel 域名已加入允许跳转地址。

### `/api/health` 返回 `ok: false`

说明 Vercel 后端变量缺失。根据 `checks` 中的 false 项补环境变量，然后重新部署。

### 生成提示词提示 401

说明前端没有带 Supabase token。先确认已经登录，再确认 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 是同一个 Supabase 项目。

### 生成提示词提示 402

说明 `credit_wallets.remaining_quota` 不足。内测阶段可以在 Supabase 表里手动给用户加额度。

### 云端保存失败

先确认已执行 `docs/supabase-schema.sql`，并且 Vercel 后端已配置：

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

云端保存现在走 `/api/projects`，不是浏览器直连 Supabase 写库。

## 9. 当前未完成项

- 支付系统尚未接入。
- 扣额度目前是读取后更新，后续建议改成 Supabase RPC，保证并发安全。
- LLM 代理目前返回完整响应，流式透传可后续再增强。
