// typecast-file-boundary: Durable journal records are parsed from JSON and validated by schema version and entry kind.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClient, type Client, type Row } from '@libsql/client';
import type { DevelopmentJournalEvent } from './contracts.js';

export interface DevelopmentJournal {
  append<T extends Readonly<Record<string, unknown>>>(kind: string, payload: T): Promise<DevelopmentJournalEvent<T>>;
  events(afterSequence?: number): Promise<readonly DevelopmentJournalEvent[]>;
  verify(): Promise<{ readonly valid: boolean; readonly verifiedThrough: number; readonly error?: string }>;
  close(): void;
}

export async function openDevelopmentJournal(path: string): Promise<DevelopmentJournal> {
  await mkdir(dirname(path), { recursive: true });
  const database = createClient({ url: `file:${path}` });
  await database.executeMultiple('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  await database.executeMultiple(`
    CREATE TABLE IF NOT EXISTS journal_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO journal_metadata(key, value) VALUES ('schema_version', '1');
    CREATE TABLE IF NOT EXISTS journal_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      previous_hash TEXT,
      hash TEXT NOT NULL UNIQUE
    );
  `);
  return {
    async append(kind, payload) {
      if (!/^[a-z][a-z0-9.-]{1,127}$/u.test(kind)) throw new Error(`Development journal event kind ${kind} is invalid.`);
      const transaction = await database.transaction('write');
      try {
        const previousResult = await transaction.execute('SELECT sequence, hash FROM journal_events ORDER BY sequence DESC LIMIT 1');
        const previous = previousResult.rows[0];
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        const canonicalPayload = stableJson(payload);
        const previousValue = previous?.hash;
        const previousHash = typeof previousValue === 'string' ? previousValue as `sha256:${string}` : undefined;
        const hash = digest(stableJson({ id, kind, createdAt, payload: parsePayload(canonicalPayload), previousHash: previousHash ?? null }));
        const inserted = await transaction.execute({ sql: 'INSERT INTO journal_events(id, kind, created_at, payload, previous_hash, hash) VALUES (?, ?, ?, ?, ?, ?)', args: [id, kind, createdAt, canonicalPayload, previousHash ?? null, hash] });
        await transaction.commit();
        return { sequence: Number(inserted.lastInsertRowid), id, kind, createdAt, payload, previousHash: previousHash ?? null, hash };
      } catch (cause) { transaction.rollback(); throw cause; }
    },
    async events(afterSequence = 0) {
      const result = await database.execute({ sql: 'SELECT sequence, id, kind, created_at, payload, previous_hash, hash FROM journal_events WHERE sequence > ? ORDER BY sequence ASC', args: [afterSequence] });
      return result.rows.map(decodeRow);
    },
    async verify() {
      let previousHash: `sha256:${string}` | null = null;
      let verifiedThrough = 0;
      const result = await database.execute('SELECT sequence, id, kind, created_at, payload, previous_hash, hash FROM journal_events ORDER BY sequence ASC');
      for (const event of result.rows.map(decodeRow)) {
        const expected = digest(stableJson({ id: event.id, kind: event.kind, createdAt: event.createdAt, payload: event.payload, previousHash }));
        if (event.previousHash !== previousHash || event.hash !== expected) return { valid: false, verifiedThrough, error: `Journal hash chain failed at sequence ${event.sequence}.` };
        previousHash = event.hash;
        verifiedThrough = event.sequence;
      }
      return { valid: true, verifiedThrough };
    },
    close: () => database.close(),
  };
}

function decodeRow(row: Row): DevelopmentJournalEvent {
  const sequence = row.sequence;
  const id = row.id;
  const kind = row.kind;
  const createdAt = row.created_at;
  const payload = row.payload;
  const previousHash = row.previous_hash;
  const hash = row.hash;
  if (typeof sequence !== 'number' || typeof id !== 'string' || typeof kind !== 'string' || typeof createdAt !== 'string' || typeof payload !== 'string' || previousHash !== null && typeof previousHash !== 'string' || typeof hash !== 'string') throw new Error('Development journal contains an invalid persisted event row.');
  return { sequence, id, kind, createdAt, payload: parsePayload(payload), previousHash: previousHash as `sha256:${string}` | null, hash: hash as `sha256:${string}` };
}
function parsePayload(value: string): Readonly<Record<string, unknown>> { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Development journal event payload is invalid.'); return parsed as Readonly<Record<string, unknown>>; }
function digest(value: string): `sha256:${string}` { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function stableJson(value: unknown): string { if (value === undefined) return 'null'; if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`; }
