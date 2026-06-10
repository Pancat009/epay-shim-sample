[English](README.md) | 简体中文

# EPay Shim for NewAPI（中文说明）

这是一个为 NewAPI 提供的「易支付」协议适配层。NewAPI 按照易支付协议向本服务发起请求，本服务再分别调用支付宝官方 SDK 和微信支付 v2 官方接口完成真实下单，并把支付结果以易支付回调格式转发给 NewAPI。

## 当前支持

- ✅ 支付宝（PC 网页跳转 `submit.php`，扫码 `mapi.php`）
- ✅ 微信支付 v2（NATIVE 扫码支付，`submit.php` 跳转到内置二维码页，`mapi.php` 返回二维码链接）
- 订单数据保存在内存中，服务重启后会丢失（不影响已完成订单的对账，仅影响查单接口）

⚠️ 在配置好 HTTPS、正式域名和真实支付商户密钥之前，不要把本服务暴露在公网。

## 环境变量配置

复制 `.env.example` 为 `.env` 并填写：

```env
PORT=3000
# 公网可访问地址，支付宝/微信回调要用，不要带末尾斜杠
PUBLIC_BASE=https://your-domain.example.com

# 易支付协议侧（NewAPI 那边填这两个）
EPAY_PID=1000
EPAY_KEY=replace-with-a-long-random-secret

# 支付宝当面付（开放平台 -> 应用 -> 密钥）
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=

# 微信支付 v2（商户平台 -> 账户中心 -> API安全）
WX_APP_ID=
WX_MCH_ID=
WX_API_KEY=
```

字段说明：

- `PORT`：服务监听端口。
- `PUBLIC_BASE`：本服务的公网访问地址，用于生成支付宝/微信的异步通知地址，**末尾不要带 `/`**。
- `EPAY_PID` / `EPAY_KEY`：易支付商户号 / 商户密钥，NewAPI 支付设置中要填同样的值。
- `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY`：支付宝开放平台应用的 AppID、应用私钥、支付宝公钥。
- `WX_APP_ID`：微信支付绑定的公众号/应用 AppID。
- `WX_MCH_ID`：微信支付商户号。
- `WX_API_KEY`：微信支付商户平台 -> 账户中心 -> API安全 中设置的 APIv2 密钥（32 位字符串，**不是**公钥 `PUB_KEY_ID_xxx`）。

## 本地运行

```bash
npm install
npm start
```

健康检查：

```text
GET /
```

返回：

```text
epay shim ok
```

## Docker 运行

项目自带 `Dockerfile` 和 `docker-compose.yml`，默认会加入和 NewAPI 相同的 Docker 网络，方便容器间互相访问。

```bash
docker compose up -d --build
```

如果和 NewAPI 不在同一个 compose 项目中，请根据实际情况修改 `docker-compose.yml` 里的外部网络名称（用 `docker network ls` 查看）。

## NewAPI 配置

在 NewAPI 后台 -> 系统设置 -> 支付设置中开启「易支付」，填写：

```text
易支付地址：https://your-domain.example.com   （即 PUBLIC_BASE）
商户 ID：和 EPAY_PID 保持一致
商户密钥：和 EPAY_KEY 保持一致
```

支付方式列表（同时支持支付宝和微信）：

```json
[
  {
    "color": "rgba(var(--semi-blue-5), 1)",
    "name": "支付宝",
    "type": "alipay"
  },
  {
    "color": "rgba(var(--semi-green-5), 1)",
    "name": "微信支付",
    "type": "wxpay"
  }
]
```

NewAPI 生成订单后会提交到：

```text
https://your-domain.example.com/submit.php
```

或调用扫码接口：

```text
https://your-domain.example.com/mapi.php
```

## 支付流程说明

- **支付宝**：`submit.php` 直接跳转到支付宝收银台页面；`mapi.php` 调用 `alipay.trade.precreate` 返回二维码链接。
- **微信支付**：`submit.php` 调用微信统一下单接口（`trade_type=NATIVE`），成功后跳转到本服务内置的二维码展示页 `/wxpay/qrcode`；该页面会每 2 秒轮询一次订单状态，支付成功后自动跳转回 `return_url`。`mapi.php` 同样调用统一下单并直接返回二维码链接。

## 异步通知

- 支付宝：`POST /alipay/notify`，验签通过且交易状态为 `TRADE_SUCCESS`/`TRADE_FINISHED` 时，标记订单成功并转发给 NewAPI 的 `notify_url`。
- 微信支付：`POST /wxpay/notify`，验签通过且 `result_code=SUCCESS` 时，标记订单成功并转发给 NewAPI 的 `notify_url`。

转发到 NewAPI 失败时会自动重试，最多 5 次，每次间隔递增（30s、60s、90s...）。

## 常见问题

- **微信报错 "ISV权限不足"**：检查微信支付商户号是否已经完成 `Native支付` 产品的签约，以及 `WX_APP_ID` 是否和商户号正确绑定。
- **微信支付失败: undefined**：通常是 `WX_API_KEY` 配置错误（必须是 APIv2 密钥，不是 APIv3 的 `PUB_KEY_ID_xxx`），或网络无法访问 `api.mch.weixin.qq.com`。
- **混合内容警告（Mixed Content）**：如果 NewAPI 是 HTTPS，但本服务是 HTTP，浏览器跳转/表单提交时会被拦截，请给本服务也配置 HTTPS（推荐 nginx + certbot）。
