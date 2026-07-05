import nacl from "tweetnacl";

/**
 * Verify a Discord interaction request signature (Ed25519).
 *
 * Discord signs `timestamp + rawBody` with its private key; we verify with the
 * application's Public Key. This is the "price of admission" for the endpoint —
 * Discord won't register it unless PING verification passes, and it's what
 * stops forged/replayed junk from being processed.
 *
 * IMPORTANT: `rawBody` must be the exact bytes Discord sent. Do NOT re-serialize
 * a parsed JSON object — key ordering/whitespace would change and verification
 * would fail. The route reads `await req.text()` and passes it verbatim.
 */
export function verifyDiscordSignature(params: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  publicKey: string;
}): boolean {
  const { rawBody, signature, timestamp, publicKey } = params;

  if (!signature || !timestamp) return false;

  // Signatures/keys are hex. Reject anything malformed rather than throwing.
  if (!isHex(signature) || !isHex(publicKey)) return false;

  try {
    const message = new TextEncoder().encode(timestamp + rawBody);
    const sig = hexToUint8(signature);
    const key = hexToUint8(publicKey);

    // Ed25519 signatures are 64 bytes, keys 32. Guard before nacl to avoid throws.
    if (sig.length !== 64 || key.length !== 32) return false;

    return nacl.sign.detached.verify(message, sig, key);
  } catch {
    return false;
  }
}

function isHex(s: string): boolean {
  return s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

function hexToUint8(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
