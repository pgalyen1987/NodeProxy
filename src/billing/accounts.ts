import { createHash, randomBytes } from 'node:crypto';
import { counterIncr, kvDel, kvGet, kvSet, setAdd, setMembers } from './store.js';

/**
 * API-key accounts for the non-crypto payment rail.
 *
 * - prepaid:  caller buys USDC-denominated credit (Stripe Checkout) and each
 *             paid request draws the price down from `balanceUsdc`.
 * - postpaid: caller is billed monthly; usage accrues in `accruedUsdc` up to
 *             `creditLimitUsdc`, then requests are refused until invoiced.
 *
 * Keys are shown to the caller once at mint time; only a SHA-256 hash is stored.
 */

export type BillingMode = 'prepaid' | 'postpaid';

export interface Account {
  id: string;
  keyHash: string;
  label: string;
  mode: BillingMode;
  status: 'active' | 'suspended';
  balanceUsdc: number;
  accruedUsdc: number;
  creditLimitUsdc: number;
  stripeCustomerId?: string;
  createdAt: number;
  lastUsedAt?: number;
}

const KEY_PREFIX = 'x402kit:acct';
const INDEX_KEY = 'x402kit:acct:index';
const HASH_INDEX = 'x402kit:acct:byhash';

function acctKey(id: string): string {
  return `${KEY_PREFIX}:${id}`;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function generateApiKey(prefix = 'sk'): { rawKey: string; keyHash: string } {
  const rawKey = `${prefix}_live_${randomBytes(24).toString('base64url')}`;
  return { rawKey, keyHash: hashKey(rawKey) };
}

async function persist(account: Account): Promise<void> {
  await kvSet(acctKey(account.id), JSON.stringify(account));
  await kvSet(`${HASH_INDEX}:${account.keyHash}`, account.id);
  await setAdd(INDEX_KEY, account.id);
}

export interface CreateAccountInput {
  label: string;
  mode: BillingMode;
  initialBalanceUsdc?: number;
  creditLimitUsdc?: number;
  stripeCustomerId?: string;
  keyPrefix?: string;
}

export async function createAccount(
  input: CreateAccountInput
): Promise<{ account: Account; rawKey: string }> {
  const { rawKey, keyHash } = generateApiKey(input.keyPrefix);
  const account: Account = {
    id: `acct_${randomBytes(8).toString('hex')}`,
    keyHash,
    label: input.label,
    mode: input.mode,
    status: 'active',
    balanceUsdc: input.mode === 'prepaid' ? input.initialBalanceUsdc ?? 0 : 0,
    accruedUsdc: 0,
    creditLimitUsdc: input.mode === 'postpaid' ? input.creditLimitUsdc ?? 50 : 0,
    stripeCustomerId: input.stripeCustomerId,
    createdAt: Date.now()
  };
  await persist(account);
  return { account, rawKey };
}

export async function getAccount(id: string): Promise<Account | null> {
  const raw = await kvGet(acctKey(id));
  return raw ? (JSON.parse(raw) as Account) : null;
}

export async function getAccountByKey(rawKey: string): Promise<Account | null> {
  const id = await kvGet(`${HASH_INDEX}:${hashKey(rawKey)}`);
  if (!id) return null;
  return getAccount(id);
}

export async function listAccounts(): Promise<Account[]> {
  const ids = await setMembers(INDEX_KEY);
  const out: Account[] = [];
  for (const id of ids) {
    const a = await getAccount(id);
    if (a) out.push(a);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export interface AuthorizeResult {
  ok: boolean;
  reason?: string;
  account?: Account;
  /** Commit the charge once the work has succeeded (draw down / accrue). */
  commit?: () => Promise<void>;
}

/**
 * Authorize a charge of `priceUsdc` against an API key. Does NOT mutate balance
 * until `commit()` is called, so a failed request never bills the caller.
 */
export async function authorizeCharge(rawKey: string, priceUsdc: number): Promise<AuthorizeResult> {
  const account = await getAccountByKey(rawKey);
  if (!account) return { ok: false, reason: 'Unknown API key' };
  if (account.status !== 'active') return { ok: false, reason: 'API key suspended' };

  if (account.mode === 'prepaid') {
    if (account.balanceUsdc < priceUsdc) {
      return { ok: false, reason: 'Insufficient prepaid credit', account };
    }
  } else if (account.accruedUsdc + priceUsdc > account.creditLimitUsdc) {
    return { ok: false, reason: 'Postpaid credit limit reached — settle outstanding balance', account };
  }

  return {
    ok: true,
    account,
    commit: async () => {
      const field = account.mode === 'prepaid' ? 'balanceUsdc' : 'accruedUsdc';
      const delta = account.mode === 'prepaid' ? -priceUsdc : priceUsdc;
      // Re-read to avoid clobbering concurrent updates, then round to micro-USDC.
      const fresh = (await getAccount(account.id)) || account;
      fresh[field] = Math.round((fresh[field] + delta) * 1_000_000) / 1_000_000;
      fresh.lastUsedAt = Date.now();
      await persist(fresh);
      await counterIncr('x402kit:revenue:byaccount', account.id, priceUsdc);
    }
  };
}

export async function creditBalance(id: string, amountUsdc: number): Promise<Account | null> {
  const account = await getAccount(id);
  if (!account) return null;
  account.balanceUsdc = Math.round((account.balanceUsdc + amountUsdc) * 1_000_000) / 1_000_000;
  await persist(account);
  return account;
}

export async function creditBalanceByStripeCustomer(
  stripeCustomerId: string,
  amountUsdc: number
): Promise<Account | null> {
  const all = await listAccounts();
  const account = all.find((a) => a.stripeCustomerId === stripeCustomerId);
  if (!account) return null;
  return creditBalance(account.id, amountUsdc);
}

export async function attachStripeCustomer(id: string, stripeCustomerId: string): Promise<Account | null> {
  const account = await getAccount(id);
  if (!account) return null;
  account.stripeCustomerId = stripeCustomerId;
  await persist(account);
  return account;
}

export async function setStatus(id: string, status: Account['status']): Promise<Account | null> {
  const account = await getAccount(id);
  if (!account) return null;
  account.status = status;
  await persist(account);
  return account;
}

/** Reset postpaid accrual after an invoice is issued; returns the amount invoiced. */
export async function settlePostpaid(id: string): Promise<{ account: Account; invoicedUsdc: number } | null> {
  const account = await getAccount(id);
  if (!account || account.mode !== 'postpaid') return null;
  const invoicedUsdc = account.accruedUsdc;
  account.accruedUsdc = 0;
  await persist(account);
  return { account, invoicedUsdc };
}

export async function deleteAccount(id: string): Promise<void> {
  const account = await getAccount(id);
  if (account) await kvDel(`${HASH_INDEX}:${account.keyHash}`);
  await kvDel(acctKey(id));
}

/** Public view safe to return over the wire (no key hash). */
export function publicAccount(account: Account) {
  const { keyHash, ...rest } = account;
  void keyHash;
  return rest;
}
