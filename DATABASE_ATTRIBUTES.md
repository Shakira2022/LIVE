# LIVE Database Attributes

This document gives the recommended production database structure for the LIVE emergency-response platform. The current web project uses browser-local mock data so that every role can be demonstrated without a backend. The matching PostgreSQL/Supabase SQL is in `supabase/schema.sql`.

## Design rules

- Use UUID primary keys for records that may be referenced outside the database.
- Keep searchable and operational data in relational columns.
- Use JSONB only for provider settings, flexible equipment lists and safe metadata.
- Store every request status change in a history table. Do not overwrite the only evidence of previous states.
- Create a request and its first `submitted` history row in one transaction.
- Keep raw passwords, JWTs and provider secrets out of tables and logs. Store only hashes or secure secret references.
- Use UTC timestamps in the database and convert them for display.
- Access production tables through protected Next.js server routes when using the planned custom JWT flow.

## 1. `users`

Stores requester, dispatcher, responder, administrator, auditor and support accounts.

- `id`: UUID primary key.
- `email`: Unique email address; nullable when phone-only sign-in is allowed.
- `phone`: Unique phone number; nullable when email-only sign-in is allowed.
- `password_hash`: Secure password hash. Never store the plain password.
- `role`: `requester`, `dispatcher`, `responder`, `admin`, `auditor` or `support`.
- `status`: `pending`, `active`, `suspended`, `locked` or `deactivated`.
- `first_name`, `last_name`, `display_name`: User identity fields.
- `preferred_contact_method`: Preferred phone or email contact method.
- `locale`, `timezone`: Display settings.
- `email_verified_at`, `phone_verified_at`: Verification timestamps.
- `last_login_at`: Last successful sign-in.
- `failed_login_attempts`, `locked_until`: Account protection fields.
- `created_at`, `updated_at`, `deleted_at`: Lifecycle timestamps.

## 2. `emergency_contacts`

Stores a requester’s optional emergency contacts.

- `id`: UUID primary key.
- `user_id`: Owner of the contact.
- `full_name`, `relationship`, `phone`, `email`: Contact details.
- `is_primary`: Identifies the default contact.
- `notes`: Optional safe note.
- `created_at`, `updated_at`.

## 3. `organisations`

Stores hospitals, response organisations, administration and support organisations.

- `id`: UUID primary key.
- `name`: Organisation name.
- `organisation_type`: Hospital, emergency response, administration or support.
- `registration_number`: Optional official identifier.
- `contact_email`, `contact_phone`: Operational contact details.
- `address_line_1`, `address_line_2`, `suburb`, `city`, `province`, `postal_code`, `country_code`: Address.
- `latitude`, `longitude`: Organisation or dispatch-centre coordinates.
- `service_area_description`: Human-readable coverage area.
- `status`: Pending, active, paused, suspended or closed.
- `integration_status`: Not configured, sandbox, active, degraded or disabled.
- `integration_settings`: Safe flexible provider settings; never store raw secrets here.
- `created_at`, `updated_at`.

## 4. `organisation_members`

Connects authorised staff to an organisation.

- `id`: UUID primary key.
- `organisation_id`, `user_id`: Foreign keys.
- `operational_role`: Dispatcher, supervisor, responder coordinator, auditor and similar organisation-specific role.
- `permissions`: Fine-grained permission names as JSONB.
- `status`: Invited, active, suspended or removed.
- `joined_at`, `created_at`, `updated_at`.
- Unique organisation-and-user combination.

## 5. `responder_teams`

Stores response teams or units.

- `id`, `organisation_id`.
- `name`, `code`, `description`.
- `status`: Availability or operational state.
- `base_latitude`, `base_longitude`: Staging or base location.
- `created_at`, `updated_at`.

## 6. `responder_profiles`

Adds operational responder information to a user account.

- `user_id`: Primary key and foreign key to `users`.
- `organisation_id`.
- `employee_number`, `qualification`, `licence_number`.
- `availability`: Available, assigned, en route, on scene, offline or maintenance.
- `current_latitude`, `current_longitude`, `location_accuracy_meters`, `last_location_at`.
- `shift_started_at`, `shift_ends_at`.
- `created_at`, `updated_at`.

## 7. `team_members`

Connects responder profiles to response teams.

- `id`, `team_id`, `responder_user_id`.
- `team_role`: Team leader, driver, medic or member.
- `is_active`, `joined_at`, `left_at`.
- Unique team-and-responder combination.

## 8. `vehicles`

Stores ambulances and response vehicles.

- `id`, `organisation_id`.
- `registration_number`, `call_sign`, `vehicle_type`.
- `status`: Available, assigned, en route, on scene, offline or maintenance.
- `capacity`.
- `equipment`: Flexible equipment list as JSONB.
- `current_latitude`, `current_longitude`, `last_location_at`.
- `created_at`, `updated_at`.

## 9. `emergency_requests`

The main emergency-request record.

- `id`: Internal UUID.
- `reference_code`: User-visible reference such as `LIVE-20260806-1234`.
- `requester_id`: Requesting user.
- `routed_organisation_id`: Hospital or organisation that received the request.
- `emergency_contact_id`: Optional selected emergency contact.
- `category`: Medical emergency, road incident, fire/smoke, personal safety or another approved category.
- `severity`: Critical, high or moderate.
- `note`: Short requester description.
- `callback_number`: Number response staff may call.
- `current_status`: Submitted, received, assigned, en route, arrived, closed, cancelled or rejected.
- `is_active`, `is_cancelled`: Fast operational flags.
- `source`: Responsive web, staff-created or future integration source.
- `idempotency_key`: Prevents duplicate retries.
- `duplicate_fingerprint`: Helps detect rapid duplicate requests.
- `device_identifier_hash`, `client_request_id`: Safe request/device tracing fields.
- `estimated_arrival_at`, `eta_minutes`: Trusted ETA only.
- `submitted_at`, `received_at`, `assigned_at`, `en_route_at`, `arrived_at`, `closed_at`: Lifecycle timestamps.
- `cancellation_requested_at`, `cancelled_at`, `cancellation_reason`.
- `rejected_at`, `rejection_reason`.
- `created_at`, `updated_at`.

## 10. `request_locations`

Stores the confirmed request location separately from the request record.

- `id`, `request_id`.
- `latitude`, `longitude`.
- `accuracy_meters`.
- `address_text`, `landmark`.
- `location_method`: GPS, manual or map pin.
- `captured_at`, `confirmed_at`.
- `reverse_geocode_provider`, `route_provider`.
- `provider_metadata`: Safe provider information as JSONB.
- `created_at`, `updated_at`.

## 11. `request_status_history`

Provides the complete ordered status timeline.

- `id`, `request_id`.
- `previous_status`, `new_status`.
- `changed_by_user_id`.
- `actor_role`.
- `changed_by_system`: True for automatic routing or system events.
- `reason`, `note`.
- `correlation_id`: Connects the change to logs and API activity.
- `created_at`.

## 12. `request_assignments`

Stores each responder, team or vehicle assignment. Reassignment creates a new record or updates the current assignment according to policy.

- `id`, `request_id`, `organisation_id`.
- `team_id`, `responder_user_id`, `vehicle_id`.
- `assigned_by_user_id`.
- `status`: Assigned, acknowledged, en route, arrived, completed, cancelled or rejected.
- `eta_minutes`, `assignment_note`.
- `assigned_at`, `acknowledged_at`, `route_started_at`, `arrived_at`, `completed_at`.
- `cancelled_at`, `rejected_at`, `rejection_reason`.
- `created_at`, `updated_at`.

## 13. `operational_notes`

Stores dispatcher and responder notes without mixing them into the public request description.

- `id`, `request_id`, `author_user_id`.
- `note`.
- `requester_visible`: Controls whether the requester may see the note.
- `created_at`, `updated_at`, `deleted_at`.

## 14. `request_attachments`

Optional table for approved request evidence or organisation files.

- `id`, `request_id`, `uploaded_by_user_id`.
- `storage_bucket`, `storage_path`.
- `original_file_name`, `mime_type`, `file_size_bytes`, `checksum_sha256`.
- `requester_visible`.
- `created_at`.

## 15. `notifications`

Stores the authoritative in-app notification content.

- `id`, `recipient_user_id`, `request_id`.
- `notification_type`.
- `title`, `message`.
- `sensitivity`: Used to avoid exposing unnecessary details on a locked screen.
- `created_at`, `read_at`, `expires_at`.

## 16. `notification_deliveries`

Tracks each delivery channel independently so a failed push, SMS or email never deletes the stored request.

- `id`, `notification_id`.
- `channel`: In-app, web push, SMS or email.
- `destination_masked`.
- `status`: Queued, sending, sent, delivered, failed or cancelled.
- `provider_name`, `provider_message_id`.
- `attempt_count`, `next_retry_at`.
- `sent_at`, `delivered_at`, `failed_at`, `failure_reason`.
- `provider_metadata`.
- `created_at`, `updated_at`.

## 17. `device_sessions`

Supports signed JWT sessions, logout, expiry and revocation.

- `id`, `user_id`.
- `device_identifier_hash`, `device_name`, `platform`, `browser`.
- `user_agent`, `ip_address`.
- `jwt_id_hash`: Hash of the JWT identifier, not the raw token.
- `refresh_token_hash`: Optional future refresh-token hash.
- `issued_at`, `expires_at`, `last_activity_at`.
- `revoked_at`, `revocation_reason`.
- `created_at`.

## 18. `password_recovery_tokens`

Stores only hashed recovery tokens.

- `id`, `user_id`.
- `token_hash`.
- `expires_at`, `used_at`.
- `requested_ip`, `created_at`.

## 19. `audit_logs`

Records important security and emergency lifecycle actions.

- `id`.
- `actor_user_id`, `actor_role`, `organisation_id`.
- `action`.
- `target_type`, `target_id`.
- `request_id`.
- `correlation_id`.
- `result`: Success, denied, warning or failure.
- `ip_address`, `user_agent`.
- `safe_metadata`: Masked, non-secret context only.
- `created_at`.

## 20. `security_logs`

Stores sign-in failures, token rejection, permission denial, suspicious repeated actions and rate-limit events.

- `id`, `user_id`.
- `event_type`, `result`.
- `correlation_id`.
- `ip_address`, `user_agent`.
- `safe_metadata`.
- `created_at`.

## 21. `application_logs`

Stores operational application failures and diagnostics.

- `id`, `level`, `service_name`, `event_name`, `message`.
- `request_id`, `correlation_id`, `error_code`.
- `safe_context`.
- `created_at`.

## 22. `external_integrations`

Defines hospital, map, geocoding, notification or responder integrations.

- `id`, `organisation_id`.
- `provider_type`, `provider_name`, `status`.
- `base_url`.
- `credential_secret_reference`: Reference to a secure secret, never the secret itself.
- `settings`.
- `last_health_check_at`, `last_success_at`.
- `created_at`, `updated_at`.

## 23. `integration_logs`

Records provider calls, responses, timeouts and retry results without exposing credentials.

- `id`, `integration_id`, `organisation_id`, `request_id`.
- `provider_name`, `operation`, `endpoint_name`.
- `http_status`, `result`, `duration_ms`, `attempt_number`.
- `error_message`, `correlation_id`.
- `safe_request_metadata`, `safe_response_metadata`.
- `created_at`.

## 24. `system_settings`

Stores controlled application configuration.

- `setting_key`: Primary key.
- `setting_value`: JSONB value.
- `description`.
- `is_public`: Whether the setting may safely be exposed to the browser.
- `updated_by_user_id`, `updated_at`.

## Essential relationships

- One user can have many emergency contacts, requests, sessions and notifications.
- One organisation can have many members, responders, teams, vehicles and requests.
- One emergency request has one confirmed location and many status-history rows, assignments, notes, attachments and notifications.
- One notification may have several channel-delivery records.
- Audit and integration logs may point to a request through `request_id` and to the same server operation through `correlation_id`.

## Required request status order

The normal lifecycle is:

`submitted → received → assigned → en_route → arrived → closed`

`cancelled` may occur before assignment or after an approved cancellation process. `rejected` must include a reason and should remain visible to authorised operations staff.

## Important indexes

At minimum, index:

- Active requests by `is_active`, `current_status` and `submitted_at`.
- Requests by requester, organisation and creation time.
- Status history by request and time.
- Assignments by responder and status.
- Notifications by recipient, read state and creation time.
- Audit logs by actor, request, result and creation time.
- Sessions by user, revocation and expiry.

## Data that must never be logged

Do not place plain passwords, raw JWTs, signing keys, database service keys, provider credentials, full secret tokens or unnecessary medical and personal details in any log table. Mask phone numbers, email addresses and identifiers where the complete value is not required for investigation.
