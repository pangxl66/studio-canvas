# 香港轻量服务器部署指南

这条路线适合先把 Studio Canvas 做成一个可访问的在线提示词生成网站。香港服务器通常不需要 ICP 备案，国内访问也比欧美节点更友好。

## 1. 推荐购买配置

优先选择腾讯云轻量应用服务器 Lighthouse 或阿里云香港轻量服务器。

- 地域：香港
- 系统：Ubuntu 22.04 LTS 或 Ubuntu 24.04 LTS
- 配置：2 核 2G 起步
- 系统盘：40G 起步
- 防火墙：放行 22、3000；后续绑定域名和 HTTPS 时再放行 80、443

腾讯云官方轻量应用服务器页面：<https://cloud.tencent.com/product/lighthouse>

## 2. 登录服务器

在本地 PowerShell 里执行，替换成你的服务器公网 IP：

```bash
ssh root@你的服务器IP
```

## 3. 安装 Docker

```bash
apt update
apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

## 4. 拉取代码

```bash
git clone https://github.com/pangxl66/studio-canvas.git
cd studio-canvas
```

如果之后更新代码：

```bash
git pull origin main
```

## 5. 填环境变量

```bash
cp .env.production.example .env
nano .env
```

需要填这些值：

```text
VITE_SAAS_MOCK=false
VITE_SUPABASE_URL=/supabase
VITE_SUPABASE_ANON_KEY=Supabase Publishable key
VITE_LLM_PROXY_URL=/api/llm/chat

SUPABASE_URL=你的 Supabase URL
SUPABASE_ANON_KEY=Supabase Publishable key
SUPABASE_SERVICE_ROLE_KEY=Supabase Secret key

LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=你的模型 API Key
LLM_MODEL=gpt-5.5
LLM_FAST_MODEL=gpt-5.5
LLM_DEEP_MODEL=gpt-5.5
```

不要填写 `VITE_LLM_API_KEY` 或 `VITE_LLM_BASE_URL`，模型密钥只能放在服务端。

这里的 `VITE_SUPABASE_URL=/supabase` 表示浏览器先请求香港服务器，再由香港服务器转发到 Supabase，避免国内浏览器直接访问 `*.supabase.co` 时出现 `Failed to fetch`。

## 6. 启动网站

```bash
docker compose up -d --build
```

查看运行状态：

```bash
docker compose ps
docker compose logs -f --tail=100
```

访问：

```text
http://你的服务器IP:3000
```

检查后端：

```text
http://你的服务器IP:3000/api/health
```

看到 `"ok": true` 就说明 Supabase 和 LLM 环境变量齐了。

## 7. 配置 Supabase 登录回调

打开 Supabase 项目：

```text
Authentication -> URL Configuration
```

先用 IP 测试时填：

```text
Site URL: http://你的服务器IP:3000
Redirect URLs: http://你的服务器IP:3000/**
```

后续绑定域名和 HTTPS 后，再改成：

```text
Site URL: https://你的域名
Redirect URLs: https://你的域名/**
```

## 8. 后续绑定域名和 HTTPS

正式给用户使用时，建议绑定域名并开启 HTTPS。到时可以用 Caddy 或 Nginx 做反向代理：

```text
https://你的域名 -> http://127.0.0.1:3000
```

这一步先不急，先把 IP 访问、登录、保存工程、生成提示词跑通。

## 9. 常用维护命令

更新并重启：

```bash
git pull origin main
docker compose up -d --build
```

停止：

```bash
docker compose down
```

查看日志：

```bash
docker compose logs -f --tail=200
```
