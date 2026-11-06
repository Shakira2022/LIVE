import 'server-only';

import { db } from '@/lib/middleware/server/db';

export async function notifyAdminsOfUserEvent(input: {
  notificationType: 'admin_user_created' | 'admin_user_updated';
  title: string;
  message: string;
}) {
  try {
    const client = db();
    const { data: admins, error: adminsError } = await client
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .eq('status', 'active')
      .is('deleted_at', null);

    if (adminsError) {
      console.warn('admin_user_event_recipients_lookup_failed', adminsError.message);
      return;
    }

    const recipients = [...new Set((admins ?? []).map((admin) => admin.id).filter(Boolean))];
    if (!recipients.length) return;

    const { error } = await client.from('notifications').insert(recipients.map((recipientUserId) => ({
      recipient_user_id: recipientUserId,
      request_id: null,
      notification_type: input.notificationType,
      title: input.title,
      message: input.message,
      sensitivity: 'normal',
    })));

    if (error) console.warn('admin_user_event_notification_failed', error.message);
  } catch (error) {
    console.warn('admin_user_event_notification_failed', error instanceof Error ? error.message : String(error));
  }
}
