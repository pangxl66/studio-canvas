# Studio Canvas 桌面授权码方案

这是轻量桌面商业版的第一版落地方式：Electron 负责桌面壳与本机授权缓存，React 负责激活界面，正式授权由一个远程接口完成。

## 开发测试

```powershell
npm.cmd run desktop:dev
```

开发模式下如果还没有配置授权服务，可以输入测试码：

```text
SC-DEV-LOCAL
```

测试码只在未打包的开发桌面环境可用，正式安装包不会接受这个本地测试码。

## 正式打包

1. 在 `electron/license-config.cjs` 中填写授权服务地址。
2. 运行打包命令。

```powershell
npm.cmd run desktop:pack
```

打包产物会输出到 `desktop-release/` 下的时间戳目录，避免 Windows 短时间占用旧产物导致重复打包失败。

## 授权接口协议

桌面端会向授权服务发送 `POST` 请求：

```json
{
  "appVersion": "0.0.2",
  "deviceId": "当前设备指纹",
  "licenseKey": "用户输入的授权码",
  "product": "Studio Canvas",
  "platform": "win32"
}
```

授权服务返回成功示例：

```json
{
  "ok": true,
  "plan": "personal",
  "owner": "buyer@example.com",
  "expiresAt": "2027-12-31T23:59:59.000Z",
  "activationToken": "server-issued-token",
  "message": "授权激活成功"
}
```

失败示例：

```json
{
  "ok": false,
  "message": "授权码不存在或设备数量已超限"
}
```

## 本机保存内容

激活成功后，桌面端会在 Electron 的 `userData` 目录保存一份本机授权缓存。缓存会绑定当前设备码，包含授权码掩码、方案、到期时间、激活时间和最后校验时间。

## 后续建议

第一版已经可以完成“安装包 + 授权码 + 本机激活”的闭环。下一步更适合补一个很轻的 Cloudflare Worker 或 Supabase 后台，用来管理授权码、设备数量、到期时间和禁用状态。
