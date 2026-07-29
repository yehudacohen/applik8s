ALTER TABLE media_attachments
  ADD COLUMN IF NOT EXISTS upload_receipt text NOT NULL DEFAULT '';
