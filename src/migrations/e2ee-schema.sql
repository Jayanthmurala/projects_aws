-- E2EE Database Schema Migration
-- Phase 2: Add encryption support while maintaining backward compatibility

-- User public keys table
CREATE TABLE IF NOT EXISTS user_public_keys (
  user_id VARCHAR(255) NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  public_key TEXT NOT NULL,
  key_type VARCHAR(20) DEFAULT 'x25519',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, device_id)
);

-- Conversation encryption keys
CREATE TABLE IF NOT EXISTS conversation_keys (
  id VARCHAR(30) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id VARCHAR(30) NOT NULL UNIQUE,
  encrypted_key_blobs JSONB NOT NULL, -- {userId: encryptedKeyBase64}
  is_encrypted BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  rotated_at TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES "Project"(id) ON DELETE CASCADE
);

-- Add encryption fields to existing Comment table
ALTER TABLE "Comment" 
ADD COLUMN IF NOT EXISTS ciphertext TEXT,
ADD COLUMN IF NOT EXISTS nonce VARCHAR(32),
ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS message_signature TEXT;

-- Add encryption fields to AppliedProject table  
ALTER TABLE "AppliedProject"
ADD COLUMN IF NOT EXISTS message_ciphertext TEXT,
ADD COLUMN IF NOT EXISTS message_nonce VARCHAR(32),
ADD COLUMN IF NOT EXISTS message_encrypted BOOLEAN DEFAULT false;

-- Add encryption fields to ProjectAttachment table
ALTER TABLE "ProjectAttachment"
ADD COLUMN IF NOT EXISTS file_key_encrypted TEXT, -- Encrypted file symmetric key
ADD COLUMN IF NOT EXISTS file_nonce VARCHAR(32),
ADD COLUMN IF NOT EXISTS is_file_encrypted BOOLEAN DEFAULT false;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_public_keys_user_id ON user_public_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_keys_project_id ON conversation_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_comments_encrypted ON "Comment"(is_encrypted);
CREATE INDEX IF NOT EXISTS idx_attachments_encrypted ON "ProjectAttachment"(is_file_encrypted);

-- Feature flags table for gradual rollout
CREATE TABLE IF NOT EXISTS feature_flags (
  id SERIAL PRIMARY KEY,
  flag_name VARCHAR(100) UNIQUE NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert E2EE feature flags
INSERT INTO feature_flags (flag_name, is_enabled, description) VALUES
('e2ee_messaging', false, 'Enable end-to-end encryption for project messages'),
('e2ee_file_upload', false, 'Enable end-to-end encryption for file attachments'),
('e2ee_comments', false, 'Enable end-to-end encryption for project comments')
ON CONFLICT (flag_name) DO NOTHING;
