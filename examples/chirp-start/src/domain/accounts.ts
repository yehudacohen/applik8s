// typecast-file-boundary: validated Drizzle lifecycle snapshots are re-exposed as their declared row shapes for domain invariants and events.
import type { ApplicationModelCreateEvent } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { eq } from 'drizzle-orm';
import { Database } from '../providers/database';
import { accounts, credentialLinks, installationSettings } from '../schema/accounts';
import { AccountChanged } from './events';

const AccountBase = accounts;
export const CredentialLink = credentialLinks;
export const InstallationSetting = installationSettings;
const CreateCredentialLink = CredentialLink.create;

CredentialLink.create.beforeCommit({ history: true }, async (_link, _input, context) => {
  const selfRegistration =
    context.principal &&
    _input.accountId === context.principal.id &&
    _input.issuer === context.trustedContext.issuer &&
    _input.subject === context.trustedContext.subject;
  if (!selfRegistration && !context.principal?.roles?.includes('identity-administrator'))
    throw new Error('Credential links require the admitted identity or an identity administrator.');
});
CredentialLink.update.beforeCommit({ history: true }, async (_link, _input, context) => {
  if (!context.principal?.roles?.includes('identity-administrator'))
    throw new Error('Credential links require an identity administrator.');
});
CredentialLink.delete.beforeCommit({ history: true }, async (_link, _input, context) => {
  if (!context.principal?.roles?.includes('identity-administrator'))
    throw new Error('Credential links require an identity administrator.');
});

InstallationSetting.create.beforeCommit({ history: true }, async (_setting, _input, context) => {
  if (!context.principal?.roles?.includes('installation-administrator'))
    throw new Error('Installation settings require an installation administrator.');
});
InstallationSetting.update.beforeCommit({ history: true }, async (_setting, _input, context) => {
  if (!context.principal?.roles?.includes('installation-administrator'))
    throw new Error('Installation settings require an installation administrator.');
});
InstallationSetting.delete.beforeCommit({ history: true }, async (_setting, _input, context) => {
  if (!context.principal?.roles?.includes('installation-administrator'))
    throw new Error('Installation settings require an installation administrator.');
});

AccountBase.create.beforeCommit(
  {
    history: true,
  },
  async (account, input, context) => {
    if (!context.principal || context.principal.id !== account.value.id)
      throw new Error('An account may only be registered for the authenticated principal.');
    if (
      input.id !== undefined ||
      input.kind !== undefined ||
      input.state !== undefined ||
      input.joinedAt !== undefined ||
      input.revision !== undefined
    )
      throw new Error('Account identity, kind, state, timestamps, and revisions are server-owned.');
    account.patch({ spec: { joinedAt: context.now } });
    if (!/^[a-z0-9_]{2,32}$/i.test(input.handle))
      throw new Error('An account handle must contain 2–32 letters, numbers, or underscores.');
    if (input.displayName.trim().length < 1 || input.displayName.length > 80)
      throw new Error('Display name must contain between 1 and 80 characters.');
    if (account.value.bio.length > 240 || account.value.state !== 'active')
      throw new Error('New accounts must be active and use a bio no longer than 240 characters.');
    AccountChanged.emit({
      accountId: account.id,
      handle: account.value.handle,
      kind: account.value.kind as 'human' | 'automation',
      state: 'active',
      changedAt: context.now,
    });
    const issuer = context.trustedContext.issuer;
    const subject = context.trustedContext.subject;
    if (typeof issuer !== 'string' || !issuer || typeof subject !== 'string' || subject !== context.principal.id) {
      throw new Error('Account registration requires an admitted issuer and subject.');
    }
    void CreateCredentialLink({
      id: context.id('credential-link'),
      accountId: account.id,
      issuer,
      subject,
      linkedAt: context.now,
      revision: context.id('credential-link-revision'),
    });
  },
);

AccountBase.update.beforeCommit(
  {
    history: true,
  },
  async (account, input, context) => {
    const principal = context.principal;
    const changesState = input.patch.state !== undefined;
    if (
      input.patch.id !== undefined ||
      input.patch.kind !== undefined ||
      input.patch.joinedAt !== undefined ||
      input.patch.revision !== undefined
    ) {
      throw new Error('Account identity, kind, timestamps, and revisions are server-owned.');
    }
    if (!principal || (principal.id !== account.id && !principal.roles?.includes('moderator')))
      throw new Error('Only the account owner or a moderator can update this account.');
    if (changesState && !principal.roles?.includes('moderator'))
      throw new Error('Only a moderator can suspend or reactivate an account.');
    if (account.value.displayName.trim().length < 1 || account.value.displayName.length > 80)
      throw new Error('Display name must contain between 1 and 80 characters.');
    if (account.value.bio.length > 240) throw new Error('Profile bio may contain at most 240 characters.');
    if (
      !['public', 'followers'].includes(account.value.visibility) ||
      !['active', 'suspended'].includes(account.value.state)
    )
      throw new Error('Account visibility or state is invalid.');
    AccountChanged.emit({
      accountId: account.id,
      handle: account.value.handle,
      kind: account.value.kind as 'human' | 'automation',
      state: account.value.state as 'active' | 'suspended',
      changedAt: context.now,
    });
  },
);

AccountBase.delete.beforeCommit({ history: true }, async (account, _input, context) => {
  const principal = context.principal;
  if (!principal || (principal.id !== account.id && !principal.roles?.includes('moderator')))
    throw new Error('Only the account owner or a moderator can delete this account.');
});

export const Account = AccountBase;

const RegisteredAccount = type({
  registered: type.unit(true),
  id: 'string',
  handle: 'string',
  displayName: 'string',
  bio: 'string',
  avatarObjectKey: 'string | null',
  visibility: 'string',
  kind: 'string',
  state: 'string',
  roles: 'string[]',
  suggestedHandle: 'string',
});

const UnregisteredAccount = type({
  registered: type.unit(false),
  id: 'string',
  suggestedHandle: 'string',
  roles: 'string[]',
});

export const AccountMe = Account.view(
  {
    input: type({}),
    output: RegisteredAccount.or(UnregisteredAccount),
    database: Database,
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 1, maxResultBytes: 32_000, timeoutMs: 2_000 },
  },
  async function me(_input, context) {
    const rows = await Database
      .select({
        id: AccountBase.id,
        handle: AccountBase.handle,
        displayName: AccountBase.displayName,
        bio: AccountBase.bio,
        avatarObjectKey: AccountBase.avatarObjectKey,
        visibility: AccountBase.visibility,
        kind: AccountBase.kind,
        state: AccountBase.state,
      })
      .from(AccountBase)
      .where(eq(AccountBase.id, context.principal.id))
      .limit(1);
    const account = rows[0];
    const claimedHandle = typeof context.principal.attributes?.handle === 'string'
      ? context.principal.attributes.handle
      : typeof context.principal.attributes?.preferred_username === 'string'
        ? context.principal.attributes.preferred_username
        : '';
    const suggestedHandle = normalizedHandle(claimedHandle || context.principal.id);
    const roles = [...(context.principal.roles ?? [])];
    return account
      ? { registered: true, ...account, suggestedHandle: account.handle, roles }
      : { registered: false, id: context.principal.id, suggestedHandle, roles };
  },
);

export const AccountByHandle = Account.view(
  {
    input: type({ handle: 'string' }),
    output: type({
      id: 'string',
      handle: 'string',
      displayName: 'string',
      bio: 'string',
      avatarObjectKey: 'string | null',
      visibility: 'string',
      kind: 'string',
      state: 'string',
    }),
    database: Database,
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 1, maxResultBytes: 32_000, timeoutMs: 2_000 },
  },
  async function byHandle(input, _context) {
    const rows = await Database
      .select({
        id: AccountBase.id,
        handle: AccountBase.handle,
        displayName: AccountBase.displayName,
        bio: AccountBase.bio,
        avatarObjectKey: AccountBase.avatarObjectKey,
        visibility: AccountBase.visibility,
        kind: AccountBase.kind,
        state: AccountBase.state,
      })
      .from(AccountBase)
      .where(eq(AccountBase.handle, input.handle))
      .limit(1);
    const account = rows[0];
    if (!account) throw new Error(`Account @${input.handle} was not found.`);
    return account;
  },
);

export const AccountDiscover = Account.view(
  {
    input: type({ 'query?': 'string', 'limit?': 'number.integer >= 1' }),
    output: type({ id: 'string', handle: 'string', displayName: 'string', bio: 'string', kind: 'string' }).array(),
    database: Database,
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 50, maxResultBytes: 128_000, timeoutMs: 2_000 },
  },
  async function discover(input, _context) {
    const query = input.query?.trim().toLowerCase();
    const rows = await Database
      .select({
        id: AccountBase.id,
        handle: AccountBase.handle,
        displayName: AccountBase.displayName,
        bio: AccountBase.bio,
        kind: AccountBase.kind,
      })
      .from(AccountBase)
      .where(eq(AccountBase.state, 'active'))
      .limit(Math.min(input.limit ?? 20, 50));
    return query
      ? rows.filter(
          (account) =>
            account.handle.toLowerCase().includes(query) || account.displayName.toLowerCase().includes(query),
        )
      : rows;
  },
);

function normalizedHandle(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return normalized.length >= 2 ? normalized : `user_${normalized || 'new'}`.slice(0, 32);
}

/**
 * Canonical committed-model handler. Account creation needs no parallel
 * model declaration and database binding derive both Account.create(...)
 * and this typed lifecycle stream from the Drizzle table.
 */
async function validateCreatedAccount(created: ApplicationModelCreateEvent<typeof Account.$inferSelect>) {
  if (created.identity !== created.value.id || !created.value.handle || created.value.state !== 'active') {
    throw new Error('Committed Account creation violates the authoritative account contract.');
  }
}

export const AccountCreationGuard = Account.on.create(
  {
    processor: { replicas: 1, concurrency: 8 },
    retry: { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 2_000, deadLetter: true },
    budgets: { timeoutMs: 2_000, maxInputBytes: 16_000 },
  },
  validateCreatedAccount,
);
