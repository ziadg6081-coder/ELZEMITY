'use strict';
/**
 * Optional Telegram notifications for the store owner.
 * Enabled only when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set in .env.
 * Fire-and-forget: a Telegram failure NEVER affects order creation (errors are only logged).
 */
const logger = require('./logger');

const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
const chatIds = () => (process.env.TELEGRAM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean); // several owners: comma-separated
const enabled = () => process.env.NODE_ENV !== 'test' && !!token() && chatIds().length > 0;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const egp = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`;

async function send(text) {
  if (!enabled()) return;
  for (const chat_id of chatIds()) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token()}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) logger.warn('telegram send failed', { status: res.status, body: (await res.text()).slice(0, 200) });
    } catch (e) {
      logger.warn('telegram send error', { message: e.message }); // never log the URL: it contains the bot token
    }
  }
}

/** `order` is the customer-facing order view returned by createOrder (items, amounts, customer...). */
function notifyNewOrder(order, input = {}) {
  if (!enabled()) return;
  const items = (order.items || []).map((i) => `• ${esc(i.name)}${i.size ? ` (${esc(i.size)})` : ''} × ${i.quantity} — ${egp(i.lineTotal)}`).join('\n');
  const a = order.amounts || {};
  const text = [
    '🛍 <b>طلب جديد</b>',
    `رقم الطلب: <code>${esc(order.orderNumber)}</code>`,
    '',
    `👤 ${esc(input.name)}`,
    `📞 ${esc(input.phone)}`,
    `📍 ${esc(input.governorate)} - ${esc(input.city)}`,
    `🏠 ${esc(input.address)}`,
    '',
    items,
    '',
    a.discount ? `الخصم: -${egp(a.discount)}${order.couponCode ? ` (${esc(order.couponCode)})` : ''}` : null,
    `المنتجات (دفع عند الاستلام): ${egp(a.productsTotal)}`,
    `الشحن (InstaPay): ${egp(a.shippingFee)}`,
    `<b>الإجمالي: ${egp(a.grandTotal)}</b>`,
  ].filter((l) => l !== null).join('\n');
  send(text).catch(() => {});
}

module.exports = { notifyNewOrder, send, enabled };
