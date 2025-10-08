/**
 * Load a remote attachment without verifying the contentDigest
 * This is a workaround for XMTP clients that calculate the digest incorrectly
 * or when there's a mismatch between the expected and actual digest
 *
 * Based on RemoteAttachmentCodec.load() but skips the digest verification step
 */

import type { CodecRegistry } from '@xmtp/content-type-primitives';
import { ContentTypeId } from '@xmtp/content-type-primitives';
import type { RemoteAttachment } from '@xmtp/content-type-remote-attachment';

// We need to replicate the XMTP decryption logic without the digest check
// This uses Web Crypto API which is available in Node.js via webcrypto

export async function loadAttachmentWithoutDigestCheck<T = unknown>(
  remoteAttachment: RemoteAttachment,
  codecRegistry: CodecRegistry,
): Promise<T> {
  // 1. Download the encrypted payload from IPFS
  const response = await fetch(remoteAttachment.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch attachment: ${response.status} ${response.statusText}`);
  }

  const payload = new Uint8Array(await response.arrayBuffer());

  if (payload.length === 0) {
    throw new Error(`no payload for remote attachment at ${remoteAttachment.url}`);
  }

  // 2. SKIP DIGEST VERIFICATION
  // The official SDK does this but we skip it:
  // const digestBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  // const digest = secp.etc.bytesToHex(digestBytes);
  // if (digest !== remoteAttachment.contentDigest) {
  //   throw new Error("content digest does not match");
  // }

  // 3. Decrypt the payload using HKDF + AES-256-GCM
  const { webcrypto } = await import('crypto');
  const { subtle } = webcrypto;

  // Import the secret key for HKDF
  const secretKey = await subtle.importKey(
    'raw',
    remoteAttachment.secret,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );

  // Derive AES key using HKDF-SHA256
  const aesKeyMaterial = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: remoteAttachment.salt,
      info: new Uint8Array(0),
    },
    secretKey,
    256 // 32 bytes for AES-256
  );

  // Import the derived key for AES-GCM
  const aesKey = await subtle.importKey(
    'raw',
    aesKeyMaterial,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt with AES-GCM
  const decrypted = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: remoteAttachment.nonce,
    },
    aesKey,
    payload
  );

  // 4. Decode the protobuf EncodedContent
  const { content: proto } = await import('@xmtp/proto');
  const encodedContent = proto.EncodedContent.decode(new Uint8Array(decrypted));

  if (!encodedContent.type) {
    throw new Error("no content type");
  }

  // 5. Find the appropriate codec and decode
  const codec = codecRegistry.codecFor(
    new ContentTypeId(encodedContent.type),
  );

  if (!codec) {
    throw new Error(`no codec found for ${encodedContent.type.typeId}`);
  }

  return codec.decode(encodedContent as any, codecRegistry) as T;
}
