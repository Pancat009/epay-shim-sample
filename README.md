English | [简体中文](README.zh-CN.md)

# EPay Shim for NewAPI

This is an EPay-protocol adapter for NewAPI. NewAPI talks to this service using the EPay protocol; this service places real orders through the official Alipay SDK and the WeChat Pay v2 API, then forwards the payment result back to NewAPI in EPay's callback format.

## Current Support

- ✅ Alipay (PC redirect via `submit.php`, QR code via `mapi.php`)
- ✅ WeChat Pay v2 (NATIVE QR payment; `submit.php` redirects to a built-in QR page, `mapi.php` returns the QR code URL)
- Orders are stored in memory only and are lost on restart (does not affect already-completed orders, only the order-query API)

⚠️ Do not expose this service publicly until you have configured HTTPS, a real domain, and valid payment merchant credentials.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
PORT=3000
# Public URL of this service, used for Alipay/WeChat callbacks. No trailing slash.
PUBLIC_BASE=https://your-domain.example.com

# EPay protocol side (NewAPI uses these two)
EPAY_PID=1000
EPAY_KEY=replace-with-a-long-random-secret

# Alipay Face-to-Face Payment (Open Platform -> App -> Keys)
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=

# WeChat Pay v2 (Merchant Platform -> Account Center -> API Security)
WX_APP_ID=
WX_MCH_ID=
WX_API_KEY=
```

Field descriptions:

- `PORT`: Port the service listens on.
- `PUBLIC_BASE`: Public URL of this service, used to build Alipay/WeChat async notify URLs. **No trailing `/`**.
- `EPAY_PID` / `EPAY_KEY`: EPay merchant ID / merchant key. Use the same values in NewAPI's payment settings.
- `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY`: AppID, application private key, and Alipay public key from your Alipay Open Platform app.
- `WX_APP_ID`: The Official Account/App AppID bound to your WeChat Pay merchant account.
- `WX_MCH_ID`: WeChat Pay merchant ID.
- `WX_API_KEY`: The APIv2 key set under Merchant Platform -> Account Center -> API Security (a 32-character string, **not** the APIv3 public key `PUB_KEY_ID_xxx`).

## Run Locally

```bash
npm install
npm start
```

Health check:

```text
GET /
```

Returns:

```text
epay shim ok
```

## Run with Docker

The project ships with a `Dockerfile` and `docker-compose.yml`. By default it joins the same Docker network as NewAPI so the containers can reach each other.

```bash
docker compose up -d --build
```

If this service is not part of the same compose project as NewAPI, update the external network name in `docker-compose.yml` accordingly (use `docker network ls` to check).

## NewAPI Configuration

In the NewAPI admin console, go to System Settings -> Payment Settings, enable "EPay" and fill in:

```text
API address: https://your-domain.example.com   (i.e. PUBLIC_BASE)
Merchant ID (PID): same as EPAY_PID
Merchant key (KEY): same as EPAY_KEY
```

Payment methods list (supports both Alipay and WeChat Pay):

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

NewAPI will create an order and submit it to:

```text
https://your-domain.example.com/submit.php
```

or call the QR code API:

```text
https://your-domain.example.com/mapi.php
```

## Payment Flow

- **Alipay**: `submit.php` redirects directly to the Alipay cashier page; `mapi.php` calls `alipay.trade.precreate` and returns a QR code URL.
- **WeChat Pay**: `submit.php` calls WeChat's unified order API (`trade_type=NATIVE`) and, on success, redirects to the built-in QR code page `/wxpay/qrcode`. That page polls the order status every 2 seconds and automatically redirects to `return_url` once payment succeeds. `mapi.php` also calls the unified order API and returns the QR code URL directly.

## Async Notifications

- Alipay: `POST /alipay/notify` — once the signature is verified and the trade status is `TRADE_SUCCESS`/`TRADE_FINISHED`, the order is marked as paid and forwarded to NewAPI's `notify_url`.
- WeChat Pay: `POST /wxpay/notify` — once the signature is verified and `result_code=SUCCESS`, the order is marked as paid and forwarded to NewAPI's `notify_url`.

If forwarding to NewAPI fails, it is retried automatically up to 5 times with increasing intervals (30s, 60s, 90s, ...).

## Troubleshooting

- **WeChat error "ISV权限不足" (insufficient ISV permissions)**: Check whether the WeChat Pay merchant account has signed up for the "Native Payment" product, and that `WX_APP_ID` is correctly bound to the merchant ID.
- **"微信支付失败: undefined"**: Usually caused by a wrong `WX_API_KEY` (must be the APIv2 key, not the APIv3 `PUB_KEY_ID_xxx` public key), or the server cannot reach `api.mch.weixin.qq.com`.
- **Mixed Content warning**: If NewAPI is served over HTTPS but this service is HTTP, browser redirects/form submissions may be blocked. Configure HTTPS for this service too (nginx + certbot is recommended).
