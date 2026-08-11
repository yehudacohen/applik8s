import {
  field,
  index,
  model,
  pgEnum,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';

export const applicationNotificationDeliveryState = pgEnum(
  'applik8s_notification_delivery_state',
  ['pending', 'delivering', 'queued', 'delivered', 'failed', 'unknown'],
);

export const applicationNotificationRequests = model(
  'applik8s_notification_requests',
  {
    id: field.text('id').primaryKey(),
    idempotencyKey: field.text('idempotency_key').notNull(),
    recipientEmail: field.text('recipient_email').notNull(),
    recipientName: field.text('recipient_name'),
    senderEmail: field.text('sender_email'),
    senderName: field.text('sender_name'),
    replyToEmail: field.text('reply_to_email'),
    replyToName: field.text('reply_to_name'),
    subject: field.text('subject').notNull(),
    text: field.text('text').notNull(),
    html: field.text('html'),
    templateId: field.text('template_id'),
    templateVersion: field.text('template_version'),
    tags: field.jsonb('tags').notNull().default({}),
    state: applicationNotificationDeliveryState('state')
      .notNull()
      .default('pending'),
    attempts: field.integer('attempts').notNull().default(0),
    provider: field.text('provider'),
    providerMessageId: field.text('provider_message_id'),
    acceptedAt: field.timestamp('accepted_at', {
      withTimezone: true,
      mode: 'string',
    }),
    lastError: field.text('last_error'),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('applik8s_notification_requests_idempotency_uidx').on(
      table.idempotencyKey,
    ),
    index('applik8s_notification_requests_state_created_idx').on(
      table.state,
      table.createdAt,
    ),
  ],
  { name: 'NotificationRequest', revision: false },
);

export const applicationNotificationSchema = Object.freeze({
  applicationNotificationRequests,
});
