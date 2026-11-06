const EMAIL_TEXT = '#102b3f';
const EMAIL_MUTED = '#667b89';
const EMAIL_TEAL = '#0f6872';
const EMAIL_LINE = '#dfe6ea';
const EMAIL_PAGE = '#f5f7f9';

export function escapeEmailHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

export function liveEmailButton(url: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0"><tr><td style="border-radius:9px;background:${EMAIL_TEAL}"><a href="${escapeEmailHtml(url)}" style="display:inline-block;padding:14px 24px;border-radius:9px;color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:1.2;text-decoration:none">${escapeEmailHtml(label)}</a></td></tr></table>`;
}

export function liveEmailLayout(contentHtml: string, preheader = '') {
  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeEmailHtml(preheader)}</div>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LIVE</title></head><body style="margin:0;padding:0;background:${EMAIL_PAGE};font-family:Arial,Helvetica,sans-serif;color:${EMAIL_TEXT}">${hiddenPreheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${EMAIL_PAGE};padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;background:#fff;border-left:1px solid ${EMAIL_LINE};border-right:1px solid ${EMAIL_LINE}"><tr><td style="padding:26px 32px;border-bottom:1px solid ${EMAIL_LINE}"><div style="font-size:23px;font-weight:800;letter-spacing:-.4px;color:${EMAIL_TEXT}">LIVE</div><div style="margin-top:5px;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${EMAIL_TEAL}">Emergency response</div></td></tr><tr><td style="padding:38px 32px 42px">${contentHtml}</td></tr><tr><td style="padding:22px 32px 24px;border-top:1px solid ${EMAIL_LINE};background:${EMAIL_PAGE}"><div style="font-size:12px;font-weight:700;color:${EMAIL_TEXT}">LIVE</div><div style="margin-top:5px;font-size:11px;line-height:1.6;color:${EMAIL_MUTED}">Location-aware emergency coordination</div><div style="margin-top:14px;padding-top:12px;border-top:1px solid ${EMAIL_LINE};font-size:10px;line-height:1.6;color:#87959e">This is an automated message from the LIVE team. Please do not reply.</div></td></tr></table><div style="max-width:620px;padding:14px 10px 0;text-align:center;font-size:10px;color:#87959e">&copy; ${new Date().getFullYear()} LIVE. All rights reserved.</div></td></tr></table></body></html>`;
}

export function liveEmailPlainText(body: string) {
  return `${body.trim()}\n\nLIVE\nLocation-aware emergency coordination\nThis is an automated message from the LIVE team. Please do not reply.`;
}
