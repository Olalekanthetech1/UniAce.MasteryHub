import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptAcademicCredential,
  encryptAcademicCredential
} from '../server/academic/credentialVault';

const originalEncryptionKey = process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY;
const testEncryptionKey = Buffer.from('uniace-research-key-2026-32-byte').toString('base64');

test.before(() => {
  process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY = testEncryptionKey;
});

test.after(() => {
  if (originalEncryptionKey === undefined) {
    delete process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY;
  } else {
    process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY = originalEncryptionKey;
  }
});

test('encrypts credentials without persisting plaintext and decrypts them exactly', () => {
  const plaintext = 'provider-secret-value';
  const encrypted = encryptAcademicCredential(plaintext);

  assert.equal(encrypted.version, 1);
  assert.equal(encrypted.algorithm, 'aes-256-gcm');
  assert.notEqual(encrypted.ciphertext, plaintext);
  assert.equal(decryptAcademicCredential(encrypted), plaintext);
});

test('uses a fresh initialization vector for each encryption', () => {
  const first = encryptAcademicCredential('same-secret');
  const second = encryptAcademicCredential('same-secret');

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test('rejects credentials encrypted with a different key or altered authentication tag', () => {
  const encrypted = encryptAcademicCredential('integrity-protected-secret');
  const originalKey = process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY;

  process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY = Buffer.from('different-32-byte-academic-key!!').toString('base64');
  assert.throws(() => decryptAcademicCredential(encrypted), /could not be decrypted/);

  process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY = originalKey;
  const tampered = { ...encrypted, authTag: Buffer.alloc(16, 0).toString('base64') };
  assert.throws(() => decryptAcademicCredential(tampered), /could not be decrypted/);
});

test('rejects missing or incorrectly sized encryption keys', () => {
  const originalKey = process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY;
  delete process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY;
  assert.throws(() => encryptAcademicCredential('secret'), /must be configured/);

  process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY = 'too-short';
  assert.throws(() => encryptAcademicCredential('secret'), /32-byte key/);

  process.env.ACADEMIC_RESEARCH_ENCRYPTION_KEY = originalKey;
});
