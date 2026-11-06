import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCloudinaryConfig,
  normalizeCloudinaryFolderPrefix
} from '../server/services/cloudinaryCredentials';

test('normalizes Cloudinary cloud names and preserves configured folder hierarchy', () => {
  assert.deepEqual(
    normalizeCloudinaryConfig({
      cloudName: ' MyCloud_01 ',
      apiKey: ' 123456 ',
      apiSecret: ' secret-value ',
      folderPrefix: ' marketing-demo-studio / exports '
    }),
    {
      cloudName: 'mycloud_01',
      apiKey: '123456',
      apiSecret: 'secret-value',
      folderPrefix: 'marketing-demo-studio/exports'
    }
  );
});

test('rejects unsafe or ambiguous Cloudinary folder paths', () => {
  assert.throws(() => normalizeCloudinaryFolderPrefix('../private'), /valid Cloudinary folder path/i);
  assert.throws(() => normalizeCloudinaryFolderPrefix('media//videos'), /valid Cloudinary folder path/i);
  assert.throws(() => normalizeCloudinaryFolderPrefix('v123/assets'), /valid Cloudinary folder path/i);
  assert.throws(() => normalizeCloudinaryFolderPrefix(''), /valid Cloudinary folder path/i);
});

test('rejects invalid Cloudinary cloud names and missing credentials', () => {
  assert.throws(() => normalizeCloudinaryConfig({
    cloudName: 'https://res.cloudinary.com/example',
    apiKey: '123',
    apiSecret: 'secret',
    folderPrefix: 'marketing-demo-studio'
  }), /Cloud name|configuration/i);

  assert.throws(() => normalizeCloudinaryConfig({
    cloudName: 'validcloud',
    apiKey: '',
    apiSecret: 'secret',
    folderPrefix: 'marketing-demo-studio'
  }), /configuration/i);
});
