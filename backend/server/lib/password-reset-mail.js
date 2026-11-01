'use strict';
const config = require('../config');
let transporter;
async function sendResetEmail(to, token) {
  const c = config.passwordReset;
  if (!c.smtpHost || !c.smtpUser || !c.smtpPassword || !c.from) throw new Error('SMTP is not configured');
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpSecure,
      auth: { user: c.smtpUser, pass: c.smtpPassword } });
  }
  const url = `${c.origin.replace(/\/$/, '')}/reset-password.html#token=${encodeURIComponent(token)}`;
  await transporter.sendMail({ from: c.from, to, subject: 'Elzemity - Reset your password',
    text: `We received a request to reset your Elzemity password.\n\nOpen this link within 15 minutes:\n${url}\n\nIf you did not request this, ignore this email.`,
    html: `<p>We received a request to reset your Elzemity password.</p><p><a href="${url}">Reset password (valid for 15 minutes)</a></p><p>If you did not request this, ignore this email.</p>` });
}
module.exports = { sendResetEmail };
