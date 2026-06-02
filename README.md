# EPay Shim for NewAPI

This is a small EPay-compatible gateway for NewAPI. NewAPI talks to this service with the EPay protocol, and this service creates the real Alipay order through the official Alipay SDK.

## Current Support

- Supported: `alipay`
- Not supported yet: `wxpay`
- Order storage: in memory only, so orders are lost after restart

Do not expose this publicly until you have configured HTTPS, a real domain, and valid payment credentials.

## Environment

Create `.env` from `.env.example` and set:

```env
PORT=3000
PUBLIC_BASE=https://pay.example.com

EPAY_PID=1000
EPAY_KEY=replace-with-a-long-random-secret

ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=
```

- `PUBLIC_BASE`: the public URL of this shim, without a trailing slash.
- `EPAY_PID`: the merchant ID you will enter in NewAPI.
- `EPAY_KEY`: the merchant key you will enter in NewAPI.
- `ALIPAY_APP_ID`: your Alipay Open Platform app ID.
- `ALIPAY_PRIVATE_KEY`: your application private key.
- `ALIPAY_PUBLIC_KEY`: the Alipay public key.

## Run

```bash
npm install
npm start
```

Health check:

```text
https://pay.example.com/
```

It should return:

```text
epay shim ok
```

## NewAPI Settings

In NewAPI admin console, open system settings/payment settings and enable EPay.

Set:

```text
API address: https://pay.example.com
Merchant ID (PID): same as EPAY_PID
Merchant key (KEY): same as EPAY_KEY
```

For payment methods, only keep Alipay for this shim:

```json
[
  {
    "color": "rgba(var(--semi-blue-5), 1)",
    "name": "支付宝",
    "type": "alipay"
  }
]
```

NewAPI will generate an order and submit it to:

```text
https://pay.example.com/submit.php
```

After Alipay confirms payment, this service forwards an EPay-style callback to NewAPI's `notify_url`.
