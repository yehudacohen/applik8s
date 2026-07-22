ALTER TABLE media_attachments
  ADD COLUMN IF NOT EXISTS processing_reason text NOT NULL DEFAULT '';
