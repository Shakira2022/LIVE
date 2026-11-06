import "server-only";
import nodemailer from "nodemailer";
import { escapeEmailHtml, liveEmailLayout, liveEmailPlainText } from "@/lib/email-template";

export async function sendSupportEmail(to: string, subject: string, body: string, htmlBody?: string) {
  const sender = process.env.GMAIL_USER;
  const password = process.env.GMAIL_APP_PASSWORD;
  if (!sender || !password) throw new Error("Email service is not configured.");
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: sender, pass: password } });
  await transporter.sendMail({
    from: `"LIVE Support" <${sender}>`,
    to,
    subject,
    text: liveEmailPlainText(body),
    html: liveEmailLayout(htmlBody ?? `<div style="font-size:14px;line-height:1.7;color:#526a78;white-space:pre-wrap">${escapeEmailHtml(body)}</div>`, subject),
  });
}

export function supportMailbox() {
  return process.env.SUPPORT_EMAIL || process.env.GMAIL_USER || "";
}
