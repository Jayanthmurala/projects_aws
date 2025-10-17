// E2EE Cryptographic Utilities
// Uses @noble/curves and @noble/ciphers for secure, audited crypto

import { x25519 } from '@noble/curves/ed25519';
import { randomBytes } from '@noble/hashes/utils';
import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

// Key generation and management
export class CryptoManager {
  
  // Generate X25519 key pair for ECDH
  static generateKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
    const privateKey = randomBytes(32); // Generate 32 random bytes for private key
    const publicKey = x25519.getPublicKey(privateKey);
    
    return { privateKey, publicKey };
  }

  // Convert keys to/from base64 for storage/transport
  static keyToBase64(key: Uint8Array): string {
    return Buffer.from(key).toString('base64');
  }

  static keyFromBase64(keyBase64: string): Uint8Array {
    return new Uint8Array(Buffer.from(keyBase64, 'base64'));
  }

  // Generate shared secret using ECDH
  static generateSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    return x25519.getSharedSecret(privateKey, publicKey);
  }

  // Derive symmetric key from shared secret using HKDF
  static deriveSymmetricKey(sharedSecret: Uint8Array, salt: Uint8Array, info: string = 'nexus-e2ee'): Uint8Array {
    const infoBytes = new TextEncoder().encode(info);
    return hkdf(sha256, sharedSecret, salt, infoBytes, 32); // 256-bit key
  }

  // Generate random symmetric key for conversation
  static generateSymmetricKey(): Uint8Array {
    return randomBytes(32); // 256-bit AES key
  }

  // Encrypt symmetric key for a user using their public key
  static encryptKeyForUser(symmetricKey: Uint8Array, userPublicKey: Uint8Array, ephemeralPrivateKey?: Uint8Array): {
    encryptedKey: string;
    ephemeralPublicKey: string;
    nonce: string;
  } {
    // Generate ephemeral key pair if not provided
    const ephemeralPrivate = ephemeralPrivateKey || randomBytes(32);
    const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
    
    // Generate shared secret
    const sharedSecret = this.generateSharedSecret(ephemeralPrivate, userPublicKey);
    
    // Generate salt and derive encryption key
    const salt = randomBytes(16);
    const encryptionKey = this.deriveSymmetricKey(sharedSecret, salt);
    
    // Encrypt the symmetric key
    const nonce = randomBytes(12); // GCM nonce
    const cipher = gcm(encryptionKey, nonce);
    const ciphertext = cipher.encrypt(symmetricKey);
    
    // Combine salt + ciphertext for storage
    const combined = new Uint8Array(salt.length + ciphertext.length);
    combined.set(salt, 0);
    combined.set(ciphertext, salt.length);
    
    return {
      encryptedKey: this.keyToBase64(combined),
      ephemeralPublicKey: this.keyToBase64(ephemeralPublic),
      nonce: this.keyToBase64(nonce)
    };
  }

  // Decrypt symmetric key using user's private key
  static decryptKeyForUser(
    encryptedKeyData: string, 
    ephemeralPublicKey: string, 
    nonce: string, 
    userPrivateKey: Uint8Array
  ): Uint8Array {
    const combined = this.keyFromBase64(encryptedKeyData);
    const ephemeralPub = this.keyFromBase64(ephemeralPublicKey);
    const nonceBytes = this.keyFromBase64(nonce);
    
    // Extract salt and ciphertext
    const salt = combined.slice(0, 16);
    const ciphertext = combined.slice(16);
    
    // Generate shared secret and derive decryption key
    const sharedSecret = this.generateSharedSecret(userPrivateKey, ephemeralPub);
    const decryptionKey = this.deriveSymmetricKey(sharedSecret, salt);
    
    // Decrypt
    const cipher = gcm(decryptionKey, nonceBytes);
    return cipher.decrypt(ciphertext);
  }

  // Encrypt message content
  static encryptMessage(content: string, symmetricKey: Uint8Array): {
    ciphertext: string;
    nonce: string;
  } {
    const nonce = randomBytes(12); // GCM nonce
    const contentBytes = new TextEncoder().encode(content);
    
    const cipher = gcm(symmetricKey, nonce);
    const ciphertext = cipher.encrypt(contentBytes);
    
    return {
      ciphertext: this.keyToBase64(ciphertext),
      nonce: this.keyToBase64(nonce)
    };
  }

  // Decrypt message content
  static decryptMessage(ciphertext: string, nonce: string, symmetricKey: Uint8Array): string {
    const ciphertextBytes = this.keyFromBase64(ciphertext);
    const nonceBytes = this.keyFromBase64(nonce);
    
    const cipher = gcm(symmetricKey, nonceBytes);
    const decrypted = cipher.decrypt(ciphertextBytes);
    
    return new TextDecoder().decode(decrypted);
  }

  // Encrypt file data
  static encryptFile(fileData: Uint8Array, fileKey?: Uint8Array): {
    encryptedData: Uint8Array;
    fileKey: Uint8Array;
    nonce: string;
  } {
    const key = fileKey || this.generateSymmetricKey();
    const nonce = randomBytes(12);
    
    const cipher = gcm(key, nonce);
    const encryptedData = cipher.encrypt(fileData);
    
    return {
      encryptedData,
      fileKey: key,
      nonce: this.keyToBase64(nonce)
    };
  }

  // Decrypt file data
  static decryptFile(encryptedData: Uint8Array, fileKey: Uint8Array, nonce: string): Uint8Array {
    const nonceBytes = this.keyFromBase64(nonce);
    
    const cipher = gcm(fileKey, nonceBytes);
    return cipher.decrypt(encryptedData);
  }

  // Validate key formats
  static isValidPublicKey(keyBase64: string): boolean {
    try {
      const key = this.keyFromBase64(keyBase64);
      return key.length === 32; // X25519 public key is 32 bytes
    } catch {
      return false;
    }
  }

  static isValidPrivateKey(keyBase64: string): boolean {
    try {
      const key = this.keyFromBase64(keyBase64);
      return key.length === 32; // X25519 private key is 32 bytes
    } catch {
      return false;
    }
  }

  // Generate conversation ID from project ID (deterministic)
  static generateConversationId(projectId: string): string {
    const hash = sha256(new TextEncoder().encode(`conversation:${projectId}`));
    return Buffer.from(hash.slice(0, 16)).toString('hex'); // 128-bit conversation ID
  }
}

// Feature flag utilities
export class FeatureFlags {
  private static cache = new Map<string, boolean>();
  private static cacheExpiry = new Map<string, number>();
  
  static async isEnabled(flagName: string): Promise<boolean> {
    // Check cache first
    const cached = this.cache.get(flagName);
    const expiry = this.cacheExpiry.get(flagName);
    
    if (cached !== undefined && expiry && Date.now() < expiry) {
      return cached;
    }

    // In a real implementation, this would check the database
    // For now, return false (disabled by default)
    const isEnabled = process.env.NODE_ENV === 'development' ? 
      process.env[`FEATURE_${flagName.toUpperCase()}`] === 'true' : false;
    
    // Cache for 5 minutes
    this.cache.set(flagName, isEnabled);
    this.cacheExpiry.set(flagName, Date.now() + 5 * 60 * 1000);
    
    return isEnabled;
  }

  static async isE2EEEnabled(): Promise<boolean> {
    return this.isEnabled('e2ee_messaging');
  }

  static async isFileEncryptionEnabled(): Promise<boolean> {
    return this.isEnabled('e2ee_file_upload');
  }
}

// Message validation utilities
export class MessageValidator {
  
  // Validate encrypted message structure
  static validateEncryptedMessage(message: any): boolean {
    return (
      typeof message.ciphertext === 'string' &&
      typeof message.nonce === 'string' &&
      typeof message.senderId === 'string' &&
      typeof message.timestamp === 'string' &&
      message.ciphertext.length > 0 &&
      message.nonce.length > 0
    );
  }

  // Validate key exchange data
  static validateKeyExchange(keyData: any): boolean {
    return (
      typeof keyData.encryptedKey === 'string' &&
      typeof keyData.ephemeralPublicKey === 'string' &&
      typeof keyData.nonce === 'string' &&
      keyData.encryptedKey.length > 0 &&
      keyData.ephemeralPublicKey.length > 0 &&
      keyData.nonce.length > 0
    );
  }

  // Sanitize message metadata (non-encrypted fields)
  static sanitizeMetadata(metadata: any): any {
    return {
      senderId: typeof metadata.senderId === 'string' ? metadata.senderId : '',
      timestamp: typeof metadata.timestamp === 'string' ? metadata.timestamp : new Date().toISOString(),
      messageType: ['text', 'file', 'system'].includes(metadata.messageType) ? metadata.messageType : 'text',
      projectId: typeof metadata.projectId === 'string' ? metadata.projectId : '',
      taskId: typeof metadata.taskId === 'string' ? metadata.taskId : undefined
    };
  }
}

// Error classes for crypto operations
export class CryptoError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

export class KeyNotFoundError extends CryptoError {
  constructor(userId: string) {
    super(`Public key not found for user: ${userId}`, 'KEY_NOT_FOUND');
  }
}

export class DecryptionError extends CryptoError {
  constructor(reason: string) {
    super(`Decryption failed: ${reason}`, 'DECRYPTION_FAILED');
  }
}

export class InvalidKeyError extends CryptoError {
  constructor(keyType: string) {
    super(`Invalid ${keyType} key format`, 'INVALID_KEY');
  }
}
