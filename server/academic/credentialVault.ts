import crypto from 'node:crypto';

export interface EncryptedAcademicCredential {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
}

function getEncryptionKey(): Buffer {
  const configuredKey = process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY?.trim();
  if (!configuredKey) {
    throw new Error(
      'ACADEMIC_RESEARCH_ENCRYPTION_KEY must be configured on the server before academic provider credentials can be stored or used.'
    );
  }

  const key = /^[0-9a-f]{64}$/i.test(configuredKey)
    ? Buffer.from(configuredKey, 'hex')
    : Buffer.from(configuredKey, 'base64');

  if (key.length !== 32) {
    throw new Error(
      'ACADEMIC_RESEARCH_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hexadecimal characters or Base64.'
    );
  }

  return key;
}

export function encryptAcademicCredential(
  plaintext: string
): EncryptedAcademicCredential {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('An empty academic provider credential cannot be encrypted.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

export function decryptAcademicCredential(
  encrypted: EncryptedAcademicCredential
): string {
  if (
    !encrypted ||
    encrypted.version !== 1 ||
    encrypted.algorithm !== 'aes-256-gcm' ||
    typeof encrypted.iv !== 'string' ||
    typeof encrypted.authTag !== 'string' ||
    typeof encrypted.ciphertext !== 'string'
  ) {
    throw new Error('Stored academic provider credential has an unsupported encrypted format.');
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(encrypted.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final()
    ]);
    return plaintext.toString('utf8');
  } catch {
    throw new Error(
      'Stored academic provider credential could not be decrypted. Verify the server encryption key and stored credential integrity.'
    );
  }
}
