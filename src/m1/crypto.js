'use strict';
const crypto = require('node:crypto');
function seal(snapshot, key) {
  if (key.length !== 32 || snapshot.schemaVersion !== 'UsageSnapshotV1' || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1) throw new Error('INVALID_CRYPTO_INPUT');
  const header = { protocol: 'M1-CRYPTO-EXPERIMENT/1', deviceId: snapshot.deviceId, sequence: snapshot.sequence };
  const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot), 'utf8'), cipher.final()]);
  return { header, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
class Receiver {
  constructor(key, deviceId) { this.key = key; this.deviceId = deviceId; this.highest = 0; }
  open(envelope) {
    const { header } = envelope;
    if (header.protocol !== 'M1-CRYPTO-EXPERIMENT/1' || header.deviceId !== this.deviceId || !Number.isSafeInteger(header.sequence) || header.sequence <= this.highest) throw new Error('REPLAY_OR_HEADER_REJECTED');
    const nonce = Buffer.from(envelope.nonce, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
    if (nonce.length !== 12 || tag.length !== 16) throw new Error('INVALID_ENVELOPE');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, nonce, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(JSON.stringify(header))); decipher.setAuthTag(tag);
    const snapshot = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    if (snapshot.schemaVersion !== 'UsageSnapshotV1' || snapshot.sequence !== header.sequence || snapshot.deviceId !== header.deviceId) throw new Error('SNAPSHOT_REJECTED');
    this.highest = header.sequence; return snapshot;
  }
}
module.exports = { seal, Receiver };
