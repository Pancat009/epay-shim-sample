require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const AlipaySdk = require('alipay-sdk').default;
const AlipayFormData = require('alipay-sdk/lib/form').default;

const {
  PORT = 3400,
  PUBLIC_BASE,
  EPAY_PID,
  EPAY_KEY,
  ALIPAY_APP_ID,
  ALIPAY_PRIVATE_KEY,
  ALIPAY_PUBLIC_KEY,
  WX_APP_ID,
  WX_MCH_ID,
  WX_API_KEY,
} = process.env;

// ─── 支付宝 ────────────────────────────────────────────────────────────────────
const alipay = new AlipaySdk({
  appId: ALIPAY_APP_ID,
  privateKey: ALIPAY_PRIVATE_KEY,
  alipayPublicKey: ALIPAY_PUBLIC_KEY,
  signType: 'RSA2',
  timeout: 10000,
});

// ─── 微信支付 v2 工具函数 ─────────────────────────────────────────────────────
function wxSign(params) {
  const str =
    Object.keys(params)
      .filter(k => k !== 'sign' && params[k] !== '' && params[k] != null)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&') +
    '&key=' +
    WX_API_KEY;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

function toXml(obj) {
  return (
    '<xml>' +
    Object.entries(obj)
      .map(([k, v]) => `<${k}><![CDATA[${v}]]></${k}>`)
      .join('') +
    '</xml>'
  );
}

function parseXml(xml) {
  const result = {};
  // 去掉外层 <xml>...</xml> 包装，避免它吞掉所有内容
  const inner = xml.replace(/^\s*<xml>([\s\S]*)<\/xml>\s*$/, '$1');
  const re = /<(\w+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g;
  let m;
  while ((m = re.exec(inner)) !== null) result[m[1]] = m[2];
  return result;
}

function randomStr(len = 32) {
  return crypto.randomBytes(len).toString('hex').slice(0, len);
}

async function wxUnifiedOrder(o) {
  const params = {
    appid: WX_APP_ID,
    mch_id: WX_MCH_ID,
    nonce_str: randomStr(32),
    body: o.name,
    out_trade_no: o.out_trade_no,
    total_fee: String(Math.round(parseFloat(o.money) * 100)), // 元 → 分
    spbill_create_ip: '127.0.0.1',
    notify_url: `${PUBLIC_BASE}/wxpay/notify`,
    trade_type: 'NATIVE',
  };
  params.sign = wxSign(params);
  const xml = toXml(params);
  console.log('[wxpay] request xml:', xml);
  const resp = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xml,
  });
  const text = await resp.text();
  console.log('[wxpay] response:', text);
  return parseXml(text);
}

// ─── 订单内存存储 ──────────────────────────────────────────────────────────────
const orders = new Map();

function recordOrder(p) {
  const o = {
    pid: p.pid,
    out_trade_no: p.out_trade_no,
    name: p.name,
    money: p.money,
    type: p.type,
    notify_url: p.notify_url,
    return_url: p.return_url || '',
    status: 0,
    trade_no: '',
    addtime: new Date().toISOString().replace('T', ' ').slice(0, 19),
    endtime: '',
  };
  orders.set(o.out_trade_no, o);
  return o;
}

// ─── 易支付签名 ───────────────────────────────────────────────────────────────
function epaySign(params) {
  const keys = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] != null)
    .sort();
  const str = keys.map(k => `${k}=${params[k]}`).join('&') + EPAY_KEY;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

function verifyEpaySign(params) {
  return params.sign && params.sign === epaySign(params);
}

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.text({ type: 'text/xml' }));

// 页面跳转支付
app.all('/submit.php', async (req, res) => {
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    console.log('[submit] type=%s trade_no=%s', params.type, params.out_trade_no);
    if (String(params.pid) !== String(EPAY_PID)) return res.status(400).send('pid mismatch');
    if (!verifyEpaySign(params)) return res.status(400).send('sign error');
    const o = recordOrder(params);

    if (o.type === 'alipay') {
      const formData = new AlipayFormData();
      formData.setMethod('get');
      formData.addField('returnUrl', o.return_url);
      formData.addField('notifyUrl', `${PUBLIC_BASE}/alipay/notify`);
      formData.addField('bizContent', {
        out_trade_no: o.out_trade_no,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        total_amount: o.money,
        subject: o.name,
      });
      const url = await alipay.exec('alipay.trade.page.pay', {}, { formData });
      return res.redirect(url);
    }

    if (o.type === 'wxpay') {
      const result = await wxUnifiedOrder(o);
      console.log('[submit] wxpay result return_code=%s result_code=%s err=%s', result.return_code, result.result_code, result.err_code_des || result.return_msg);
      if (result.return_code === 'SUCCESS' && result.result_code === 'SUCCESS') {
        const qs = `url=${encodeURIComponent(result.code_url)}&order=${o.out_trade_no}&return_url=${encodeURIComponent(o.return_url || '/')}`;
        return res.redirect(`/wxpay/qrcode?${qs}`);
      }
      const errMsg = result.err_code_des || result.return_msg || result.return_code || 'wxpay failed';
      return res.status(500).send(`微信支付失败: ${errMsg}`);
    }

    res.status(400).send('unsupported type: ' + o.type);
  } catch (e) {
    console.error('[submit] exception:', e.message);
    res.status(500).send(`微信支付失败: ${e.message}`);
  }
});

// API 接口支付（返回二维码 URL）
app.post('/mapi.php', async (req, res) => {
  try {
    const p = req.body;
    console.log('[mapi] type=%s trade_no=%s', p.type, p.out_trade_no);
    if (String(p.pid) !== String(EPAY_PID)) return res.json({ code: -1, msg: 'pid mismatch' });
    if (!verifyEpaySign(p)) return res.json({ code: -1, msg: 'sign error' });
    const o = recordOrder(p);

    if (o.type === 'alipay') {
      const result = await alipay.exec('alipay.trade.precreate', {
        notify_url: `${PUBLIC_BASE}/alipay/notify`,
        bizContent: {
          out_trade_no: o.out_trade_no,
          total_amount: o.money,
          subject: o.name,
        },
      });
      if (result && result.qrCode) {
        return res.json({ code: 1, msg: 'ok', trade_no: '', order: o.out_trade_no, payurl: '', qrcode: result.qrCode, urlscheme: '' });
      }
      return res.json({ code: -1, msg: result.msg || 'alipay create failed' });
    }

    if (o.type === 'wxpay') {
      const result = await wxUnifiedOrder(o);
      console.log('[mapi] wxpay result return_code=%s result_code=%s err=%s', result.return_code, result.result_code, result.err_code_des || result.return_msg);
      if (result.return_code === 'SUCCESS' && result.result_code === 'SUCCESS') {
        return res.json({ code: 1, msg: 'ok', trade_no: '', order: o.out_trade_no, payurl: '', qrcode: result.code_url, urlscheme: result.code_url });
      }
      return res.json({ code: -1, msg: result.err_code_des || result.return_msg || 'wxpay create failed' });
    }

    res.json({ code: -1, msg: 'unsupported type' });
  } catch (e) {
    console.error('[mapi] exception:', e.message);
    res.json({ code: -1, msg: e.message });
  }
});

// 查单
app.get('/api.php', (req, res) => {
  if (req.query.act !== 'order') return res.json({ code: -1, msg: 'act error' });
  const o = orders.get(req.query.out_trade_no);
  if (!o) return res.json({ code: -1, msg: 'not found' });
  res.json({
    code: 1, msg: 'ok',
    trade_no: o.trade_no, out_trade_no: o.out_trade_no,
    type: o.type, pid: Number(o.pid),
    addtime: o.addtime, endtime: o.endtime,
    name: o.name, money: o.money, status: o.status,
  });
});

// ─── 支付宝异步通知 ────────────────────────────────────────────────────────────
app.post('/alipay/notify', async (req, res) => {
  let ok = false;
  try { ok = await alipay.checkNotifySign(req.body); } catch (_) {}
  if (!ok) return res.send('fail');
  if (req.body.trade_status === 'TRADE_SUCCESS' || req.body.trade_status === 'TRADE_FINISHED') {
    const o = orders.get(req.body.out_trade_no);
    if (o && o.status !== 1) {
      o.status = 1;
      o.trade_no = req.body.trade_no;
      o.endtime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      forwardNotify(o).catch(() => {});
    }
  }
  res.send('success');
});

// ─── 微信支付异步通知 ──────────────────────────────────────────────────────────
app.post('/wxpay/notify', (req, res) => {
  const xml = typeof req.body === 'string' ? req.body : '';
  const data = parseXml(xml);

  // 验签
  const sign = data.sign;
  delete data.sign;
  if (wxSign(data) !== sign) {
    return res.send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[sign error]]></return_msg></xml>');
  }

  if (data.result_code === 'SUCCESS') {
    const o = orders.get(data.out_trade_no);
    if (o && o.status !== 1) {
      o.status = 1;
      o.trade_no = data.transaction_id;
      o.endtime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      forwardNotify(o).catch(() => {});
    }
  }
  res.send('<xml><return_code><![CDATA[OK]]></return_code></xml>');
});

// 微信支付二维码展示页（带轮询，付款后自动跳转）
app.get('/wxpay/qrcode', (req, res) => {
  const { url, order, return_url } = req.query;
  const safeReturn = return_url ? encodeURIComponent(return_url) : '';
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>微信扫码支付</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
<style>body{text-align:center;padding:40px;font-family:sans-serif;background:#f5f5f5}
.box{display:inline-block;background:#fff;padding:30px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1)}
h2{margin:0 0 16px;color:#333}#status{color:#888;margin-top:12px;font-size:14px}</style>
</head><body>
<div class="box">
<h2>微信扫码支付</h2>
<canvas id="qr"></canvas>
<p id="status">请使用微信扫描二维码完成支付</p>
</div>
<script>
QRCode.toCanvas(document.getElementById('qr'),'${url}',{width:256});
const order='${order}';
const returnUrl='${safeReturn}' ? decodeURIComponent('${safeReturn}') : '';
let timer=setInterval(async()=>{
  try{
    const r=await fetch('/api.php?act=order&out_trade_no='+order);
    const d=await r.json();
    if(d.status===1){
      clearInterval(timer);
      document.getElementById('status').textContent='✅ 支付成功！正在跳转...';
      setTimeout(()=>{ location.href=returnUrl||'/'; },1500);
    }
  }catch(e){}
},2000);
</script>
</body></html>`);
});

// ─── 回调转发（带重试） ────────────────────────────────────────────────────────
async function forwardNotify(o, retry = 0) {
  const params = {
    pid: o.pid, name: o.name, money: o.money,
    out_trade_no: o.out_trade_no, trade_no: o.trade_no,
    param: '', trade_status: 'TRADE_SUCCESS', type: o.type, sign_type: 'MD5',
  };
  params.sign = epaySign(params);
  const url = `${o.notify_url}?${new URLSearchParams(params).toString()}`;
  try {
    const r = await fetch(url, { method: 'GET' });
    if ((await r.text()).trim() === 'success') return;
  } catch (_) {}
  if (retry < 5) setTimeout(() => forwardNotify(o, retry + 1), (retry + 1) * 30_000);
}

app.get('/', (_, res) => res.send('epay shim ok'));

app.listen(PORT, () => console.log(`epay shim listening on :${PORT}`));
