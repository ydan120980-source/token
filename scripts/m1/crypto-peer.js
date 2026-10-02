'use strict';
const { seal, Receiver } = require('../../src/m1/crypto');
let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', part => { text += part; });
process.stdin.on('end', () => {
  const input = JSON.parse(text), key = Buffer.from(input.key, 'base64');
  if (input.mode === 'seal') process.stdout.write(JSON.stringify(seal(input.snapshot, key)));
  else { const receiver = new Receiver(key, input.deviceId); const results = input.envelopes.map(envelope => { try { return { accepted: true, sequence: receiver.open(envelope).sequence }; } catch { return { accepted: false }; } }); process.stdout.write(JSON.stringify(results)); }
});
