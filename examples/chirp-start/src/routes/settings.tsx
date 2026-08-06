import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Account } from '../application';
import { ChirpShell, PageIntro } from '../components/chirp-shell';
import { currentAccount } from '../session';

export const Route = createFileRoute('/settings')({ component: Settings });

function Settings() {
  const account = currentAccount.useQuery();
  const create = Account.create.useMutation();
  const update = Account.update.useMutation();
  const registeredAccount = account.data?.registered ? account.data : undefined;
  const [handle, setHandle] = useState(registeredAccount?.handle ?? account.data?.suggestedHandle ?? '');
  const [displayName, setDisplayName] = useState(registeredAccount?.displayName ?? '');
  const [bio, setBio] = useState(registeredAccount?.bio ?? 'Building a real social application from one typed graph.');
  const [visibility, setVisibility] = useState<'public' | 'followers'>(
    registeredAccount?.visibility === 'followers' ? 'followers' : 'public',
  );
  const registered = account.data?.registered === true;
  const pending = create.pending || update.pending;
  const error = create.error ?? update.error;
  return <ChirpShell title="Settings"><PageIntro eyebrow="Authoritative profile" title={registered ? 'Edit your account' : 'Complete registration'}>Your identity provider authenticates the session. Chirp owns the account profile, while the gateway derives its identity from the admitted principal.</PageIntro><form className="panelForm" onSubmit={async (event) => {
    event.preventDefault();
    if (registered && account.data) {
      await update({ identity: account.data.id, patch: { displayName, bio, visibility } });
      return;
    }
    await create({ handle, displayName, bio, visibility });
  }}>{registered ? null : <label>Handle<input aria-label="Handle" value={handle} minLength={2} maxLength={32} pattern="[A-Za-z0-9_]+" onChange={(event) => setHandle(event.target.value)} /></label>}<label>Display name<input value={displayName} minLength={1} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Bio<textarea value={bio} maxLength={240} onChange={(event) => setBio(event.target.value)} /></label><label>Default visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'followers')}><option value="public">Public</option><option value="followers">Followers</option></select></label><button className="primary" disabled={pending || !displayName.trim() || (!registered && !handle.trim())}>{pending ? 'Saving…' : registered ? 'Save profile' : 'Create account'}</button>{error ? <p role="alert">{error.message}</p> : null}</form></ChirpShell>;
}
