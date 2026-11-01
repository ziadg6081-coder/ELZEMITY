"use strict";
const form = document.querySelector('#resetForm');
const message = document.querySelector('#message');
const token = new URLSearchParams(location.hash.slice(1)).get('token');
// Token is in URL fragment so it is not sent in HTTP requests or referrer headers.
if (!token || !/^[a-f0-9]{64}$/.test(token)) { form.hidden = true; message.textContent = 'رابط الاستعادة غير صالح. اطلب رابطًا جديدًا.'; }
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = form.querySelector("#pw").value;
  if (password !== form.querySelector("#confirm").value) { message.textContent = 'كلمتا المرور غير متطابقتين.'; return; }
  const button = form.querySelector('button'); button.disabled = true;
  message.textContent = 'جاري التحديث...';
  try {
    const response = await fetch('api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error?.message || 'تعذر تغيير كلمة المرور.'); }
    history.replaceState(null, '', location.pathname);
    form.hidden = true; message.textContent = 'تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.';
  } catch (err) { message.textContent = err.message; button.disabled = false; }
});
