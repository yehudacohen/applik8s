import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { currentAccount } from '../session';

export function ChirpShell({ title, status, children, rail }: { readonly title: string; readonly status?: ReactNode; readonly children: ReactNode; readonly rail?: ReactNode }) {
  const session = currentAccount.useQuery();
  const account = session.data;
  const profileHandle = account?.registered ? account.handle : undefined;
  const profileLabel = account?.registered ? account.displayName : 'Complete registration';
  const profileSublabel = account?.registered ? `@${account.handle}` : 'Choose your Chirp handle';
  return <div className="shell">
    <aside>
      <Link to="/" className="brand" aria-label="Chirp home">chirp<span>•</span></Link>
      <nav>
        <Link aria-label="Home" to="/">⌂ <span>Home</span></Link>
        <Link aria-label="Explore" to="/explore">⌕ <span>Explore</span></Link>
        <Link aria-label="Notifications" to="/notifications">♢ <span>Notifications</span></Link>
        <Link aria-label="Bookmarks" to="/bookmarks">⌑ <span>Bookmarks</span></Link>
        <Link aria-label="Automation" to="/automation">✦ <span>Automation</span></Link>
        <Link aria-label="Analytics" to="/analytics">⌁ <span>Analytics</span></Link>
        {account?.roles.includes('moderator') ? <Link aria-label="Moderation" to="/moderation">⚑ <span>Moderation</span></Link> : null}
        <Link aria-label="Settings" to="/settings">⚙ <span>Settings</span></Link>
      </nav>
      {profileHandle ? <Link className="profile" to="/profile/$handle" params={{ handle: profileHandle }}>
        <div className="avatar">{profileHandle.at(0)?.toUpperCase()}</div><div><strong>{profileLabel}</strong><small>{profileSublabel}</small></div>
      </Link> : <Link className="profile" to="/settings">
        <div className="avatar">+</div><div><strong>{profileLabel}</strong><small>{profileSublabel}</small></div>
      </Link>}
    </aside>
    <main>
      <header><p>{title}</p>{status}</header>
      {children}
    </main>
    <section className="rail">{rail ?? <ArchitectureRail />}</section>
  </div>;
}

export function ArchitectureRail() {
  return <div className="inspector">
    <p className="eyebrow">Runtime topology</p><h2>One application graph</h2>
    <ul><li><b>Postgres</b><span>product authority</span></li><li><b>JetStream / Kinesis</b><span>durable replay</span></li><li><b>Valkey</b><span>online projection target</span></li><li><b>ClickHouse</b><span>rebuildable analytics</span></li><li><b>DuckDB / Athena</b><span>immutable history</span></li><li><b>S3</b><span>media + lakehouse bytes</span></li><li><b>Hatchet</b><span>durable workflows</span></li><li><b>TypeKro / Alchemy</b><span>selected implementation plan</span></li></ul>
  </div>;
}

export function PageIntro({ eyebrow, title, children }: { readonly eyebrow: string; readonly title: string; readonly children: ReactNode }) {
  return <section className="pageIntro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{children}</p></section>;
}
