/**
 * ZOD SCHEMAS USED BY THE VALIDATION STAGE  (Block 5 Person 7, Block 4 Person 4)
 *
 * The server must validate all client-provided data and must NOT trust role,
 * ownership, status or organisation values sent by the browser. Nothing here
 * accepts a role, an organisation or a requester id from input.
 *
 * Ported from emergency-response/src/lib/validation.ts.
 * CHANGED FOR LIVE, to match the deployed schema:
 *   - severity is REQUIRED (emergency_requests.severity is not null).
 *   - callbackNumber is REQUIRED (emergency_requests.callback_number is not null).
 *   - locationSource -> locationMethod, and 'map_pin' is accepted
 *     (location_method enum is 'gps' | 'manual' | 'map_pin').
 *   - manualAddress -> addressText, plus optional landmark.
 *   - idempotencyKey is REQUIRED (the column is not null unique).
 */

import { z } from 'zod';
import { REQUEST_STATUSES } from '@/lib/middleware/status';

const trimmed = (max: number) => z.string().trim().max(max);

export const emailSchema = trimmed(255).email('Enter a valid email address.').toLowerCase();

/** E.164-ish. Deliberately permissive so international test numbers work. */
export const phoneSchema = trimmed(32).regex(
  /^\+?[0-9][0-9\s-]{6,18}$/,
  'Enter a phone number with 7 to 19 digits, optionally starting with +.',
);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use at most 128 characters.')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Include an uppercase letter, a lowercase letter and a number.',
  });

export const uuidSchema = z.string().uuid('That identifier is not valid.');

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The existing register page posts { name, email, phone, emergencyContactName,
 * emergencyContactPhone, password }. That shape is preserved so the frontend
 * does not have to change; `name` is split into first/last in the service.
 */
export const registerSchema = z
  .object({
    name: trimmed(160).min(2, 'Enter your full name.'),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    emergencyContactName: trimmed(160).optional(),
    emergencyContactPhone: phoneSchema.optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'Enter an email address or a phone number.',
    path: ['email'],
  });

/** Matches what components/auth/auth-provider.tsx already sends. */
export const loginSchema = z.object({
  identifier: trimmed(255).min(3, 'Enter your email address or phone number.'),
  password: z.string().min(1, 'Enter your password.').max(128),
});

/* -------------------------------------------------------------------------- */
/* Location (Block 4)                                                          */
/* -------------------------------------------------------------------------- */

export const LOCATION_METHODS = ['gps', 'manual', 'map_pin'] as const;

export const latitudeSchema = z
  .number()
  .min(-90, 'Latitude must be between -90 and 90.')
  .max(90, 'Latitude must be between -90 and 90.');

export const longitudeSchema = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.');

export const coordinateSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracyMeters: z.number().min(0).max(100_000).nullable().optional(),
  capturedAt: z.string().datetime().optional(),
});

/** PUT /api/requests/[id]/location - GPS capture and manual fallback. */
export const locationUpdateSchema = z
  .object({
    locationMethod: z.enum(LOCATION_METHODS),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    accuracyMeters: z.number().min(0).max(100_000).nullable().optional(),
    addressText: trimmed(300).optional(),
    landmark: trimmed(200).optional(),
    capturedAt: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.locationMethod === 'manual') {
      if (!value.addressText || value.addressText.length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['addressText'],
          message: 'Describe the address or landmark in at least 5 characters.',
        });
      }
      return;
    }
    if (value.latitude === undefined || value.longitude === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latitude'],
        message: 'GPS coordinates are missing. Switch to a manual location instead.',
      });
    }
  });

/* -------------------------------------------------------------------------- */
/* Requests (Block 5)                                                          */
/* -------------------------------------------------------------------------- */

export const EMERGENCY_CATEGORIES = [
  'medical',
  'accident',
  'fire',
  'crime',
  'rescue',
  'other',
] as const;

export const SEVERITIES = ['critical', 'high', 'moderate'] as const;

export const createRequestSchema = z
  .object({
    category: z.enum(EMERGENCY_CATEGORIES),
    severity: z.enum(SEVERITIES),
    note: trimmed(500).optional(),
    callbackNumber: phoneSchema,
    /** Client-generated key so a retry cannot create a second request. */
    idempotencyKey: trimmed(120).min(8, 'The idempotency key is too short.'),
    clientRequestId: trimmed(120).optional(),

    locationMethod: z.enum(LOCATION_METHODS),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    accuracyMeters: z.number().min(0).max(100_000).nullable().optional(),
    addressText: trimmed(300).optional(),
    landmark: trimmed(200).optional(),
    capturedAt: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.locationMethod === 'manual') {
      if (!value.addressText || value.addressText.length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['addressText'],
          message: 'Describe the address or landmark in at least 5 characters.',
        });
      }
      return;
    }
    if (value.latitude === undefined || value.longitude === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latitude'],
        message: 'GPS coordinates are missing. Switch to a manual location instead.',
      });
    }
  });

export const statusChangeSchema = z.object({
  status: z.enum(REQUEST_STATUSES as [string, ...string[]]),
  /** Optimistic concurrency: the status the operator actually saw on screen. */
  expectedStatus: z.enum(REQUEST_STATUSES as [string, ...string[]]).optional(),
  reason: trimmed(220).optional(),
  note: trimmed(500).optional(),
  etaMinutes: z.number().int().min(0).max(600).optional(),
});

export const assignmentSchema = z.object({
  responderUserId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  vehicleId: uuidSchema.optional(),
  organisationId: uuidSchema.optional(),
  assignmentNote: trimmed(500).optional(),
  etaMinutes: z.number().int().min(0).max(600).optional(),
});

export const assignmentActionSchema = z.object({
  action: z.enum(['acknowledge', 'start_route', 'arrive', 'complete', 'reject', 'cancel']),
  reason: trimmed(300).optional(),
});

export const noteSchema = z.object({
  note: trimmed(2000).min(1, 'Write the note before saving it.'),
  requesterVisible: z.boolean().default(false),
});

export const cancelSchema = z.object({
  reason: trimmed(300).optional(),
});

/* -------------------------------------------------------------------------- */
/* Query strings                                                               */
/* -------------------------------------------------------------------------- */

export const listQuerySchema = z.object({
  status: z.string().optional(),
  scope: z.enum(['new', 'active', 'completed', 'mine', 'all']).default('all'),
  search: trimmed(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const auditQuerySchema = z.object({
  action: trimmed(180).optional(),
  targetType: trimmed(120).optional(),
  result: z.enum(['success', 'denied', 'warning', 'failure']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const idParamSchema = z.object({ id: uuidSchema });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type StatusChangeInput = z.infer<typeof statusChangeSchema>;
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
export type NoteInput = z.infer<typeof noteSchema>;
