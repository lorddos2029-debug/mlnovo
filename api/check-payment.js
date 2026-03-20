function normalizeString(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) s = s.slice(1, -1).trim();
  }
  if (s.length >= 4 && s.startsWith('__') && s.endsWith('__')) s = s.slice(2, -2).trim();
  return s;
}

const fs = require('fs');
const path = require('path');

function dig(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object' || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function nowGmtYmdHms() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function cleanDigits(v) {
  const s = normalizeString(v);
  if (!s) return null;
  const d = s.replace(/\D+/g, '');
  return d ? d : null;
}

function toProducts(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const id = normalizeString(it.id ?? '');
    const name = normalizeString(it.name ?? '');
    let quantity = Number.isFinite(it.quantity) ? Math.trunc(it.quantity) : parseInt(it.quantity, 10);
    if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
    let priceInCents = 0;
    if (Number.isFinite(it.priceInCents)) priceInCents = Math.trunc(it.priceInCents);
    else if (Number.isFinite(it.price)) priceInCents = Math.trunc(it.price);
    else if (typeof it.priceInCents === 'string') priceInCents = parseInt(it.priceInCents, 10) || 0;
    else if (typeof it.price === 'string') priceInCents = parseInt(it.price, 10) || 0;
    if (priceInCents < 0) priceInCents = 0;
    if (!id && !name) continue;
    out.push({
      id: id || name,
      name: name || id,
      planId: null,
      planName: null,
      quantity,
      priceInCents
    });
  }
  return out;
}

function toTrackingParameters(tp) {
  const inTp = tp && typeof tp === 'object' ? tp : {};
  const pick = (k) => {
    const v = normalizeString(inTp[k] ?? '');
    return v ? v : null;
  };
  return {
    src: pick('src'),
    sck: pick('sck'),
    utm_source: pick('utm_source'),
    utm_campaign: pick('utm_campaign'),
    utm_medium: pick('utm_medium'),
    utm_content: pick('utm_content'),
    utm_term: pick('utm_term')
  };
}

async function notifyUtmifyPaid({ orderId, createdAt, approvedDate, amount, customer, items, trackingParameters, clientIp }) {
  const token = normalizeString(process.env.UTMIFY_API_TOKEN || process.env.UTMIFY_TOKEN || '');
  if (!token) return { sent: false, error: 'missing_utmify_token' };

  const platform = normalizeString(process.env.UTMIFY_PLATFORM || 'ShopPegou') || 'ShopPegou';
  const totalPriceInCents = Number.isFinite(amount) ? Math.trunc(amount) : parseInt(amount, 10) || 0;
  const payload = {
    orderId,
    platform,
    paymentMethod: 'pix',
    status: 'paid',
    createdAt: createdAt || nowGmtYmdHms(),
    approvedDate: approvedDate || nowGmtYmdHms(),
    refundedAt: null,
    customer: {
      name: normalizeString(customer?.name ?? ''),
      email: normalizeString(customer?.email ?? ''),
      phone: cleanDigits(customer?.phone ?? null),
      document: cleanDigits(customer?.document ?? null)
    },
    products: toProducts(items),
    trackingParameters: toTrackingParameters(trackingParameters),
    commission: {
      totalPriceInCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: totalPriceInCents
    }
  };

  const country = normalizeString(customer?.country ?? '');
  if (country) payload.customer.country = country;
  const ip = normalizeString(customer?.ip ?? clientIp ?? '');
  if (ip) payload.customer.ip = ip;

  const r = await fetch('https://api.utmify.com.br/api-credentials/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-token': token
    },
    body: JSON.stringify(payload)
  });

  const text = await r.text();
  if (!r.ok) return { sent: false, http_code: r.status, response: text.slice(0, 800) };
  return { sent: true, http_code: r.status };
}

function pickStatus(data) {
  const candidates = [
    dig(data, ['status']),
    dig(data, ['payment', 'status']),
    dig(data, ['transaction', 'status']),
    dig(data, ['pix', 'status'])
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function readFirstSecretFile(candidates) {
  for (const file of candidates) {
    const fp = normalizeString(file || '');
    if (!fp) continue;
    try {
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        const raw = fs.readFileSync(fp, 'utf8');
        const k = normalizeString(raw);
        if (k) return k;
      }
    } catch (e) {}
  }
  return '';
}

function getPayevoSecretKey() {
  const direct = normalizeString(process.env.PAYEVO_SECRET_KEY || '');
  if (direct) return direct;

  const fileFromEnv = normalizeString(process.env.PAYEVO_SECRET_FILE || '');
  const cwd = process.cwd ? process.cwd() : '';
  const localCandidates = [
    fileFromEnv || null,
    cwd ? path.join(cwd, '.payevo_secret_key') : null,
    cwd ? path.join(cwd, 'payevo_secret_key.txt') : null,
    cwd ? path.join(cwd, 'payevo_secret_key') : null
  ];
  return readFirstSecretFile(localCandidates);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ status: 'failed', error: 'Method not allowed' });
    return;
  }

  const secretKey = getPayevoSecretKey();
  if (!secretKey) {
    res.status(500).json({ status: 'failed', error: 'Configure PAYEVO_SECRET_KEY (env)' });
    return;
  }

  const code = normalizeString(req.query?.code ? String(req.query.code) : '');
  if (!code) {
    res.status(400).json({ status: 'failed', error: 'Missing code' });
    return;
  }

  const r = await fetch('https://apiv2.payevo.com.br/functions/v1/transactions/' + encodeURIComponent(code), {
    method: 'GET',
    headers: {
      Authorization: 'Basic ' + Buffer.from(secretKey).toString('base64'),
      Accept: 'application/json'
    }
  });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  if (!r.ok || !data || typeof data !== 'object') {
    res.status(502).json({ status: 'pending', error: 'Gateway connection failed', http_code: r.status, details: data ?? text });
    return;
  }

  const rawStatus = pickStatus(data).toLowerCase();
  let status = 'pending';
  if (!rawStatus) status = 'pending';
  else if (rawStatus.includes('paid') || rawStatus.includes('approved') || rawStatus.includes('confirm') || rawStatus.includes('complete') || rawStatus === 'success') status = 'paid';
  else if (rawStatus.includes('fail') || rawStatus.includes('cancel') || rawStatus.includes('expired') || rawStatus.includes('refus') || rawStatus.includes('error')) status = 'failed';

  let notifyApproved = null;
  if (status === 'paid') {
    const amount = dig(data, ['amount']) ?? dig(data, ['transaction', 'amount']) ?? dig(data, ['payment', 'amount']);
    const customer = dig(data, ['customer']) ?? dig(data, ['payment', 'customer']) ?? {};
    const items = dig(data, ['items']) ?? dig(data, ['payment', 'items']) ?? dig(data, ['transaction', 'items']) ?? [];
    const trackingParameters =
      dig(data, ['metadata', 'trackingParameters']) ??
      dig(data, ['payment', 'metadata', 'trackingParameters']) ??
      dig(data, ['transaction', 'metadata', 'trackingParameters']) ??
      {};
    const createdAt =
      normalizeString(String(dig(data, ['createdAt']) ?? dig(data, ['created_at']) ?? dig(data, ['transaction', 'created_at']) ?? '')) || nowGmtYmdHms();
    const approvedDate =
      normalizeString(String(dig(data, ['approvedDate']) ?? dig(data, ['approved_date']) ?? dig(data, ['transaction', 'approved_date']) ?? '')) || nowGmtYmdHms();

    const clientIp = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : undefined;
    try {
      notifyApproved = await notifyUtmifyPaid({
        orderId: code,
        createdAt,
        approvedDate,
        amount,
        customer,
        items,
        trackingParameters,
        clientIp
      });
    } catch {
      notifyApproved = { sent: false, error: 'utmify_exception' };
    }
  }

  res.status(200).json({ status, notify: { pix_approved: notifyApproved } });
};
