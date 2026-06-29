/** Shared x402 paid fetch builder for EVM + Solana payers. */

export interface PaidFetchOptions {
  evmPrivateKey?: string;
  solanaPrivateKey?: string;
}

export class PaidFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaidFetchError';
  }
}

async function decodeSolanaSecret(raw: string): Promise<Uint8Array> {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }
  const { base58 } = await import('@scure/base');
  return base58.decode(trimmed);
}

export async function createPaidFetch(options: PaidFetchOptions = {}): Promise<typeof fetch> {
  const evmPrivateKey = options.evmPrivateKey ?? process.env.EVM_PRIVATE_KEY;
  const solanaPrivateKey = options.solanaPrivateKey ?? process.env.SOLANA_PRIVATE_KEY;

  if (!evmPrivateKey && !solanaPrivateKey) {
    throw new PaidFetchError(
      'EVM_PRIVATE_KEY or SOLANA_PRIVATE_KEY is required for paid API calls.'
    );
  }

  const { wrapFetchWithPayment } = await import('@x402/fetch');
  const { x402Client } = await import('@x402/core/client');
  const client = new x402Client();

  if (evmPrivateKey) {
    const { registerExactEvmScheme } = await import('@x402/evm/exact/client');
    const { privateKeyToAccount } = await import('viem/accounts');
    registerExactEvmScheme(client, {
      signer: privateKeyToAccount(evmPrivateKey as `0x${string}`)
    });
  }

  if (solanaPrivateKey) {
    const { ExactSvmScheme } = await import('@x402/svm/exact/client');
    const { createKeyPairSignerFromBytes } = await import('@solana/kit');
    const secret = await decodeSolanaSecret(solanaPrivateKey);
    const signer = await createKeyPairSignerFromBytes(secret);
    client.register('solana:*', new ExactSvmScheme(signer));
  }

  return wrapFetchWithPayment(fetch, client);
}
