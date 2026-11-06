import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { createHandler } from '@/lib/middleware/api/handler';
import { ApiError } from '@/lib/middleware/errors';
import { southAfricanPhoneSchema, emailSchema, uuidSchema } from '@/lib/middleware/validation';
import { db, isUniqueViolation } from '@/lib/middleware/server/db';
import { hashPassword } from '@/lib/middleware/password';
import { sendSupportEmail } from '@/lib/support-email';
import { notifyAdminsOfUserEvent } from '@/lib/notifications/admin-user-events';
import { generateResetToken } from '@/lib/reset-token';
import { liveEmailButton } from '@/lib/email-template';

export const runtime = 'nodejs';

const createUserSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter the user’s first name.').max(100),
  lastName: z.string().trim().min(1, 'Enter the user’s last name.').max(100),
  email: emailSchema,
  phone: southAfricanPhoneSchema,
  role: z.enum(['requester', 'dispatcher', 'responder', 'auditor', 'manager']),
  organisationId: uuidSchema.nullable().optional(),
}).superRefine((value, context) => {
  if (['dispatcher', 'responder', 'manager'].includes(value.role) && !value.organisationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['organisationId'], message: 'Select an organisation for this role.' });
  }
  if (value.role === 'requester' && value.organisationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['organisationId'], message: 'Requester accounts cannot belong to an organisation.' });
  }
});

function getApplicationOrigin(request: Request) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');
  return host ? `${protocol}://${host}` : new URL(request.url).origin;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function temporaryPassword() {
  // The prefix and suffix guarantee uppercase, lowercase, and numeric
  // characters required by the existing password policy.
  return `Live-${randomBytes(20).toString('base64url')}9a`;
}

export const POST = createHandler(
  {
    name: 'admin.users.create',
    auth: 'required',
    roles: ['admin'],
    body: createUserSchema,
    rateLimit: { limit: 20, windowMs: 60_000, by: 'user' },
    successStatus: 201,
    audit: { action: 'admin_user_created', targetType: 'user' },
  },
  async (ctx) => {
    const client = db();
    const organisationId = ctx.body.role === 'requester' ? null : ctx.body.organisationId ?? null;

    let organisationName: string | null = null;
    if (organisationId) {
      const { data: organisation, error: organisationError } = await client
        .from('organisations')
        .select('id,name,status')
        .eq('id', organisationId)
        .maybeSingle();
      if (organisationError || !organisation || organisation.status !== 'active') {
        throw new ApiError('BAD_REQUEST', 'Choose an active organisation.');
      }
      organisationName = organisation.name;
    }

    const fullName = `${ctx.body.firstName} ${ctx.body.lastName}`.trim();
    const initialPassword = temporaryPassword();
    const passwordHash = await hashPassword(initialPassword);
    const { data: createdUser, error: createError } = await client
      .from('users')
      .insert({
        first_name: ctx.body.firstName,
        last_name: ctx.body.lastName,
        display_name: fullName,
        email: ctx.body.email,
        phone: ctx.body.phone,
        password_hash: passwordHash,
        role: ctx.body.role,
        status: 'pending',
        email_verified_at: null,
        preferred_contact_method: 'email',
      })
      .select('id,email,phone,role,status,first_name,last_name,display_name,created_at')
      .single();

    if (createError) {
      if (isUniqueViolation(createError)) {
        throw new ApiError('CONFLICT', 'An account with this email address or phone number already exists.');
      }
      throw ApiError.internal('Unable to create the user account.', createError.message);
    }

    const rollbackUser = async () => {
      const { error: tokenDeleteError } = await client.from('email_verification_tokens').delete().eq('user_id', createdUser.id);
      if (tokenDeleteError) ctx.log.error('admin_user_verification_rollback_failed', { userId: createdUser.id, dbError: tokenDeleteError.message });
      const { error } = await client.from('users').delete().eq('id', createdUser.id);
      if (error) ctx.log.error('admin_user_creation_rollback_failed', { userId: createdUser.id, dbError: error.message });
    };

    if (ctx.body.role === 'responder' && organisationId) {
      const { error } = await client.from('responder_profiles').insert({
        user_id: createdUser.id,
        organisation_id: organisationId,
        availability: 'offline',
      });
      if (error) {
        await rollbackUser();
        throw ApiError.internal('Unable to create the responder profile.', error.message);
      }
    }

    if (organisationId) {
      const { error } = await client.from('organisation_members').insert({
        organisation_id: organisationId,
        user_id: createdUser.id,
        operational_role: ctx.body.role,
        status: 'active',
      });
      if (error) {
        await rollbackUser();
        throw ApiError.internal('Unable to add the user to the organisation.', error.message);
      }
    }

    const origin = getApplicationOrigin(ctx.req);
    const loginUrl = `${origin}/login`;
    const { rawToken, tokenHash } = generateResetToken();
    const verificationExpiryMinutes = Number(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES ?? 60);
    const verificationExpiresAt = new Date(Date.now() + verificationExpiryMinutes * 60_000);
    const { error: verificationTokenError } = await client.from('email_verification_tokens').insert({
      user_id: createdUser.id,
      token_hash: tokenHash,
      expires_at: verificationExpiresAt.toISOString(),
    });
    if (verificationTokenError) {
      await rollbackUser();
      throw ApiError.internal('Unable to prepare the email verification link.', verificationTokenError.message);
    }
    const verificationUrl = `${origin}/verify-email?token=${encodeURIComponent(rawToken)}`;
    const escapedName = escapeHtml(fullName);
    const escapedEmail = escapeHtml(createdUser.email);
    const escapedPassword = escapeHtml(initialPassword);
    const escapedLoginUrl = escapeHtml(loginUrl);
    const escapedVerificationUrl = escapeHtml(verificationUrl);
    const subject = 'Verify your LIVE account';
    const text = `Hello ${fullName},\n\nAn administrator created a LIVE ${ctx.body.role} account for you${organisationName ? ` with ${organisationName}` : ''}.\n\nVerify your email before signing in: ${verificationUrl}\nThis verification link expires in ${verificationExpiryMinutes} minutes.\n\nSign in after verification: ${loginUrl}\nEmail: ${createdUser.email}\nTemporary password: ${initialPassword}\n\nAfter signing in, change your temporary password from your profile settings. Keep this email private.\n\nThe LIVE Team`;
    const html = `<div style="margin-bottom:20px;border-left:3px solid #0f6872;padding-left:12px;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#0f6872">Email verification</div><h1 style="margin:0;font-size:30px;line-height:1.15;color:#102b3f">Verify your email</h1><p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:#607482">Hello ${escapedName},<br><br>An administrator created a LIVE ${escapeHtml(ctx.body.role)} account for you${organisationName ? ` with ${escapeHtml(organisationName)}` : ''}. Verify this email address before signing in. The link expires in ${verificationExpiryMinutes} minutes.</p>${liveEmailButton(verificationUrl, 'Verify email')}<div style="margin-top:30px;padding:18px 20px;background:#f5f7f9;color:#526a78;font-size:13px;line-height:1.8"><p style="margin:0"><strong style="color:#102b3f">Email:</strong> ${escapedEmail}</p><p style="margin:4px 0 0"><strong style="color:#102b3f">Temporary password:</strong> ${escapedPassword}</p></div><p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#667b89">After verifying, sign in at <a href="${escapedLoginUrl}" style="color:#0f6872;font-weight:700">LIVE sign in</a>. Change your temporary password after you sign in, and keep it private.</p><p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:#71838e">If the button does not work, copy this link into your browser:<br><a href="${escapedVerificationUrl}" style="color:#0f6872;word-break:break-all">${escapedVerificationUrl}</a></p><div style="margin-top:24px;padding-top:16px;border-top:1px solid #dfe6ea;font-size:12px;line-height:1.7;color:#71838e">If you did not expect this account, contact LIVE Support.</div>`;

    try {
      await sendSupportEmail(createdUser.email, subject, text, html);
    } catch (emailError) {
      await rollbackUser();
      ctx.log.error('admin_user_credentials_email_failed', {
        userId: createdUser.id,
        cause: emailError instanceof Error ? emailError.message : String(emailError),
      });
      throw new ApiError('UPSTREAM_FAILED', 'The user was not created because the sign-in email could not be sent. Check the email service and try again.');
    }

    ctx.audit({
      targetId: createdUser.id,
      createdRole: createdUser.role,
      organisationId,
      credentialsEmailSent: true,
    });

    await notifyAdminsOfUserEvent({
      notificationType: 'admin_user_created',
      title: 'User account created',
      message: `${fullName} was added as ${ctx.body.role}${organisationName ? ` for ${organisationName}` : ''}; email verification is pending.`,
    });

    return {
      user: {
        ...createdUser,
        organisation_id: organisationId,
        organisation_name: organisationName,
      },
      credentialsEmailStatus: 'sent',
    };
  },
);
