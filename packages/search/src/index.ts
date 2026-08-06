// typecast-file-boundary: PostgreSQL rows are validated and normalized before
// they cross the provider-neutral search source contracts.
import type { ApplicationSearchIndexPlan } from "@applik8s/core";
import type {
  ApplicationSearchChangeSource,
  ApplicationSearchCommittedChange,
  ApplicationSearchHydratedDocument,
  ApplicationSearchHydration,
  ApplicationSearchSnapshotSource,
} from "@applik8s/applik8s";

export interface ApplicationRelationalSearchColumn {
  readonly property: string;
  readonly column: string;
}

export interface ApplicationRelationalSearchRelationship {
  readonly source: string;
  readonly name: string;
  readonly target: string;
  readonly cardinality: "one" | "many";
  readonly integrity:
    | "foreign-key"
    | "relation-only"
    | "soft"
    | "reconcile-checked";
  readonly fields: readonly string[];
  readonly references: readonly string[];
}

export interface ApplicationRelationalSearchModel {
  readonly nodeId: string;
  readonly name: string;
  readonly tableName: string;
  readonly schema?: string;
  readonly identity: ApplicationRelationalSearchColumn;
  readonly columns: readonly ApplicationRelationalSearchColumn[];
  readonly relationships: readonly ApplicationRelationalSearchRelationship[];
}

interface RelationalSearchRows
  extends ReadonlyArray<Readonly<Record<string, unknown>>> {}

interface ApplicationRelationalSearchConnection {
  unsafe(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<RelationalSearchRows>;
  release(): void | Promise<void>;
}

export interface ApplicationRelationalSearchSql {
  unsafe(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<RelationalSearchRows>;
  reserve(): Promise<ApplicationRelationalSearchConnection>;
}

export interface ApplicationRelationalSearchSources<
  TDocument extends object,
> {
  readonly changes: ApplicationSearchChangeSource;
  readonly hydration: ApplicationSearchHydration<TDocument>;
  readonly snapshot: ApplicationSearchSnapshotSource<TDocument>;
  close(): Promise<void>;
}

export interface ApplicationRelationalSearchSourceOptions {
  readonly sql: ApplicationRelationalSearchSql;
  readonly plan: ApplicationSearchIndexPlan;
  readonly models: readonly ApplicationRelationalSearchModel[];
  readonly maximumSnapshotSessions?: number;
}

interface SnapshotSession {
  readonly connection: ApplicationRelationalSearchConnection;
  readonly frontier: number;
  closed: boolean;
}

interface CompiledRelationship {
  readonly source: ApplicationRelationalSearchModel;
  readonly target: ApplicationRelationalSearchModel;
  readonly relationship: ApplicationRelationalSearchRelationship;
}

/**
 * PostgreSQL source authority for provider-neutral search projections.
 *
 * Committed changes, authoritative snapshots, inverse invalidation, and
 * document hydration all use the relational model metadata emitted by the
 * application compiler. Search providers therefore never need to understand
 * Drizzle objects or application-specific joins.
 */
export function createApplicationRelationalSearchSources<
  TDocument extends object = Record<string, unknown>,
>(
  options: ApplicationRelationalSearchSourceOptions,
): ApplicationRelationalSearchSources<TDocument> {
  const maximumSnapshotSessions = boundedInteger(
    options.maximumSnapshotSessions ?? 4,
    1,
    128,
    "maximumSnapshotSessions",
  );
  const models = validateModels(options.plan, options.models);
  const root = requiredModel(models, options.plan.root.model.nodeId);
  const modelNamesSql = options.plan.sourceFrontiers
    .map(({ model }) => sqlLiteral(model))
    .join(", ");
  const sessions = new Map<string, SnapshotSession>();
  let nextSnapshot = 1;
  let closed = false;

  const documentQuery = (
    identities: readonly string[] | undefined,
    cursor: string | undefined,
    limit: number | undefined,
  ): { readonly sql: string; readonly parameters: readonly unknown[] } => {
    const parameters: unknown[] = [];
    const conditions: string[] = [];
    if (identities) {
      parameters.push(identities);
      conditions.push(
        `${columnExpression("root", root.identity.column)}::text = ANY($${parameters.length}::text[])`,
      );
    }
    if (cursor !== undefined) {
      parameters.push(cursor);
      conditions.push(
        `${columnExpression("root", root.identity.column)}::text > $${parameters.length}`,
      );
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const boundedLimit =
      limit === undefined ? "" : `LIMIT ${boundedInteger(limit, 1, 2_000, "limit")}`;
    const fields = options.plan.fields
      .map(
        (field) =>
          `${sqlLiteral(field.alias)}, ${fieldExpression(field, root, models)}`,
      )
      .join(", ");
    return {
      sql: `SELECT ${columnExpression("root", root.identity.column)}::text AS identity,
        jsonb_build_object(${fields}) AS document
      FROM ${qualifiedTable(root)} AS "root"
      ${where}
      ORDER BY ${columnExpression("root", root.identity.column)}::text
      ${boundedLimit}`,
      parameters,
    };
  };

  const hydrate = async (
    identities: readonly string[],
    frontier: number,
  ): Promise<readonly ApplicationSearchHydratedDocument<TDocument>[]> => {
    if (identities.length === 0) return [];
    const unique = [...new Set(identities.map(requiredIdentity))].sort();
    const query = documentQuery(unique, undefined, undefined);
    const rows = await options.sql.unsafe(query.sql, query.parameters);
    const found = new Map<string, TDocument>();
    for (const row of rows) {
      const identity = requiredRowString(row.identity, "identity");
      found.set(identity, requiredDocument<TDocument>(row.document, identity));
    }
    return unique.map((id) => ({
      id,
      document: found.get(id) ?? null,
      sourceProjectionRevision: `${options.plan.revision.digest}:${frontier}`,
    }));
  };

  const changes: ApplicationSearchChangeSource = {
    async read(afterCommitPosition, limit) {
      const after = boundedInteger(
        afterCommitPosition,
        0,
        Number.MAX_SAFE_INTEGER,
        "afterCommitPosition",
      );
      const boundedLimit = boundedInteger(limit, 1, 2_000, "limit");
      // One statement observes the retained floor, committed frontier, and
      // bounded page under one PostgreSQL statement snapshot.
      const rows = await options.sql.unsafe(
        `SELECT
          "frontier"."position" AS high_watermark,
          COALESCE("retention"."floor", "frontier"."position" + 1) AS retention_floor,
          "changes"."sequence",
          "changes"."commit_position",
          "changes"."model",
          "changes"."operation",
          "changes"."identity",
          "changes"."revision",
          "changes"."recorded_at"
        FROM "applik8s_model_change_commit_frontier" AS "frontier"
        LEFT JOIN LATERAL (
          SELECT MIN("retained"."commit_position") AS floor
          FROM "applik8s_model_changes" AS "retained"
          WHERE "retained"."model" IN (${modelNamesSql})
        ) AS "retention" ON true
        LEFT JOIN LATERAL (
          SELECT "candidate".*
          FROM "applik8s_model_changes" AS "candidate"
          WHERE "candidate"."commit_position" > $1
            AND "candidate"."model" IN (${modelNamesSql})
          ORDER BY "candidate"."commit_position", "candidate"."sequence"
          LIMIT $2
        ) AS "changes" ON true
        WHERE "frontier"."singleton" = true
        ORDER BY "changes"."commit_position", "changes"."sequence"`,
        [after, boundedLimit],
      );
      const first = rows[0];
      const highWatermark = first
        ? rowInteger(first.high_watermark, "high_watermark")
        : after;
      const retentionFloor = first
        ? rowInteger(first.retention_floor, "retention_floor")
        : highWatermark + 1;
      const items = rows
        .filter((row) => row.sequence !== null && row.sequence !== undefined)
        .map((row) => committedChange(row, options.plan));
      return {
        items,
        retentionFloor,
        highWatermark,
        exhausted:
          items.length < boundedLimit ||
          (items.at(-1)?.commitPosition ?? after) >= highWatermark,
      };
    },
  };

  const hydration: ApplicationSearchHydration<TDocument> = {
    async affectedRoots(change, affectedOptions) {
      const maximum = boundedInteger(
        affectedOptions.maximum,
        1,
        1_000_001,
        "maximum",
      );
      if (change.sourceModel === root.name) {
        return { identities: [change.sourceIdentity], complete: true };
      }
      const path = relationshipPathToModel(
        options.plan,
        root,
        change.sourceModel,
        models,
      );
      const query = affectedRootQuery(root, path, maximum);
      const rows = await options.sql.unsafe(query, [change.sourceIdentity]);
      const identities = rows.map((row) =>
        requiredRowString(row.identity, "identity"),
      );
      return {
        identities: identities.slice(0, maximum),
        complete: identities.length < maximum,
      };
    },
    hydrate(identities, hydrateOptions) {
      const frontier = boundedInteger(
        hydrateOptions.frontier,
        0,
        Number.MAX_SAFE_INTEGER,
        "frontier",
      );
      hydrateOptions.signal?.throwIfAborted();
      return hydrate(identities, frontier);
    },
  };

  const snapshot: ApplicationSearchSnapshotSource<TDocument> = {
    async open() {
      assertOpen(closed);
      if (sessions.size >= maximumSnapshotSessions) {
        throw new Error(
          `Application relational search snapshot session ceiling ${maximumSnapshotSessions} exceeded.`,
        );
      }
      const connection = await options.sql.reserve();
      let begun = false;
      try {
        await connection.unsafe(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        begun = true;
        const rows = await connection.unsafe(
          `SELECT position
          FROM applik8s_model_change_commit_frontier
          WHERE singleton = true`,
        );
        const frontier = rowInteger(rows[0]?.position ?? 0, "position");
        const snapshotId = `snapshot-${nextSnapshot++}`;
        sessions.set(snapshotId, { connection, frontier, closed: false });
        return { frontier, snapshotId };
      } catch (error) {
        if (begun) {
          await connection.unsafe("ROLLBACK").catch(() => undefined);
        }
        await connection.release();
        throw error;
      }
    },
    async read(snapshotId, cursor, limit) {
      const session = requiredSession(sessions, snapshotId);
      const query = documentQuery(
        undefined,
        cursor,
        boundedInteger(limit, 1, 2_000, "limit"),
      );
      const rows = await session.connection.unsafe(query.sql, query.parameters);
      const items = rows.map((row) => {
        const id = requiredRowString(row.identity, "identity");
        return {
          id,
          document: requiredDocument<TDocument>(row.document, id),
          sourceProjectionRevision: `${options.plan.revision.digest}:${session.frontier}`,
        };
      });
      const nextCursor =
        items.length === limit ? items.at(-1)?.id : undefined;
      return {
        items,
        ...(nextCursor ? { cursor: nextCursor } : {}),
        exhausted: items.length < limit,
      };
    },
    async close(snapshotId) {
      const session = requiredSession(sessions, snapshotId);
      session.closed = true;
      sessions.delete(snapshotId);
      try {
        await session.connection.unsafe("COMMIT");
      } finally {
        await session.connection.release();
      }
    },
  };

  return {
    changes,
    hydration,
    snapshot,
    async close() {
      if (closed) return;
      closed = true;
      const open = [...sessions.entries()];
      sessions.clear();
      await Promise.all(
        open.map(async ([, session]) => {
          if (session.closed) return;
          session.closed = true;
          try {
            await session.connection.unsafe("ROLLBACK");
          } finally {
            await session.connection.release();
          }
        }),
      );
    },
  };
}

function committedChange(
  row: Readonly<Record<string, unknown>>,
  plan: ApplicationSearchIndexPlan,
): ApplicationSearchCommittedChange {
  const commitPosition = rowInteger(row.commit_position, "commit_position");
  const operation = requiredRowString(row.operation, "operation");
  return {
    id: `${commitPosition}:${rowInteger(row.sequence, "sequence")}`,
    sourceModel: requiredRowString(row.model, "model"),
    sourceIdentity: scalarIdentity(row.identity),
    operation:
      operation === "insert"
        ? "create"
        : operation === "delete"
          ? "delete"
          : operation === "update"
            ? "update"
            : "reparent",
    commitPosition,
    transactionId: `model-change:${commitPosition}`,
    schemaRevision:
      typeof row.revision === "string" && row.revision
        ? row.revision
        : plan.revision.rootModelRevision,
    recordedAt: normalizedTimestamp(row.recorded_at),
  };
}

function fieldExpression(
  field: ApplicationSearchIndexPlan["fields"][number],
  root: ApplicationRelationalSearchModel,
  models: ReadonlyMap<string, ApplicationRelationalSearchModel>,
): string {
  const relationshipSegments = field.path.filter(
    (segment) => segment.relationship,
  );
  const terminal = field.path.at(-1);
  if (!terminal) throw new Error(`Search field ${field.alias} has no path.`);
  if (relationshipSegments.length === 0) {
    if (terminal.model !== root.name) {
      throw new Error(
        `Search field ${field.alias} targets ${terminal.model} without a relationship path from ${root.name}.`,
      );
    }
    return columnExpression(
      "root",
      requiredColumn(root, terminal.field).column,
    );
  }
  const path = compiledRelationshipPath(
    relationshipSegments,
    root,
    models,
  );
  const terminalModel = requiredModelByName(models, terminal.model);
  const terminalAlias = `search_rel_${path.length}`;
  const terminalColumn = columnExpression(
    terminalAlias,
    requiredColumn(terminalModel, terminal.field).column,
  );
  const from = relationshipFromSql(path);
  const aggregate =
    field.kind === "values"
      ? `COALESCE(jsonb_agg(DISTINCT ${terminalColumn}) FILTER (WHERE ${terminalColumn} IS NOT NULL), '[]'::jsonb)`
      : field.kind === "minimum"
        ? `MIN(${terminalColumn})`
        : field.kind === "maximum"
          ? `MAX(${terminalColumn})`
          : field.kind === "count"
            ? `COUNT(${terminalColumn})`
            : terminalColumn;
  const limit =
    field.kind === "values" ||
    field.kind === "minimum" ||
    field.kind === "maximum" ||
    field.kind === "count"
      ? ""
      : "LIMIT 1";
  return `(SELECT ${aggregate} ${from} ${limit})`;
}

function compiledRelationshipPath(
  segments: readonly ApplicationSearchIndexPlan["fields"][number]["path"][number][],
  root: ApplicationRelationalSearchModel,
  models: ReadonlyMap<string, ApplicationRelationalSearchModel>,
): readonly CompiledRelationship[] {
  const path: CompiledRelationship[] = [];
  let source = root;
  for (const segment of segments) {
    if (segment.model !== source.name || !segment.relationship) {
      throw new Error(
        `Search relationship path expected ${source.name}, received ${segment.model}.`,
      );
    }
    const relationship = source.relationships.find(
      ({ name }) => name === segment.relationship,
    );
    if (!relationship || relationship.target !== segment.target) {
      throw new Error(
        `Search relationship ${source.name}.${segment.relationship} is not present in the relational model contract.`,
      );
    }
    const target = requiredModelByName(models, relationship.target);
    assertRelationshipColumns(source, target, relationship);
    path.push({ source, target, relationship });
    source = target;
  }
  return path;
}

function relationshipFromSql(path: readonly CompiledRelationship[]): string {
  const first = path[0];
  if (!first) throw new Error("A relational search path cannot be empty.");
  const firstAlias = "search_rel_1";
  const clauses = [
    `FROM ${qualifiedTable(first.target)} AS ${quoteIdentifier(firstAlias)}`,
  ];
  for (let index = 1; index < path.length; index += 1) {
    const edge = path[index] as CompiledRelationship;
    const previousAlias = `search_rel_${index}`;
    const alias = `search_rel_${index + 1}`;
    clauses.push(
      `JOIN ${qualifiedTable(edge.target)} AS ${quoteIdentifier(alias)}
       ON ${relationshipPredicate(edge, previousAlias, alias)}`,
    );
  }
  clauses.push(
    `WHERE ${relationshipPredicate(first, "root", firstAlias)}`,
  );
  return clauses.join("\n");
}

function relationshipPredicate(
  edge: CompiledRelationship,
  sourceAlias: string,
  targetAlias: string,
): string {
  return edge.relationship.fields
    .map((field, index) => {
      const reference = edge.relationship.references[index];
      if (!reference) {
        throw new Error(
          `Search relationship ${edge.source.name}.${edge.relationship.name} has mismatched fields and references.`,
        );
      }
      return `${columnExpression(sourceAlias, requiredColumn(edge.source, field).column)}
        = ${columnExpression(targetAlias, requiredColumn(edge.target, reference).column)}`;
    })
    .join(" AND ");
}

function relationshipPathToModel(
  plan: ApplicationSearchIndexPlan,
  root: ApplicationRelationalSearchModel,
  targetName: string,
  models: ReadonlyMap<string, ApplicationRelationalSearchModel>,
): readonly CompiledRelationship[] {
  for (const field of plan.fields) {
    const terminalIndex = field.path.findIndex(
      ({ model }) => model === targetName,
    );
    if (terminalIndex < 0) continue;
    const relationships = field.path
      .slice(0, terminalIndex + 1)
      .filter((segment) => segment.relationship);
    if (relationships.length > 0) {
      return compiledRelationshipPath(relationships, root, models);
    }
  }
  throw new Error(
    `Search source model ${targetName} has no bounded relationship path from ${root.name}.`,
  );
}

function affectedRootQuery(
  root: ApplicationRelationalSearchModel,
  path: readonly CompiledRelationship[],
  maximum: number,
): string {
  const last = path.at(-1);
  if (!last) throw new Error("Affected-root lookup requires a relationship path.");
  const lastAlias = `search_rel_${path.length}`;
  return `SELECT DISTINCT ${columnExpression("root", root.identity.column)}::text AS identity
    FROM ${qualifiedTable(root)} AS "root"
    ${path
      .map((edge, index) => {
        const sourceAlias = index === 0 ? "root" : `search_rel_${index}`;
        const targetAlias = `search_rel_${index + 1}`;
        return `JOIN ${qualifiedTable(edge.target)} AS ${quoteIdentifier(targetAlias)}
          ON ${relationshipPredicate(edge, sourceAlias, targetAlias)}`;
      })
      .join("\n")}
    WHERE ${columnExpression(lastAlias, last.target.identity.column)}::text = $1
    ORDER BY identity
    LIMIT ${maximum}`;
}

function validateModels(
  plan: ApplicationSearchIndexPlan,
  modelList: readonly ApplicationRelationalSearchModel[],
): ReadonlyMap<string, ApplicationRelationalSearchModel> {
  if (modelList.length === 0) {
    throw new Error(`Search index ${plan.logicalIdentity.name} has no relational models.`);
  }
  const byName = new Map<string, ApplicationRelationalSearchModel>();
  const byNode = new Map<string, ApplicationRelationalSearchModel>();
  for (const model of modelList) {
    if (!model.name || !model.nodeId || !model.tableName) {
      throw new Error("Relational search models require nodeId, name, and tableName.");
    }
    if (byName.has(model.name) || byNode.has(model.nodeId)) {
      throw new Error(`Relational search model ${model.name} is duplicated.`);
    }
    requiredColumn(model, model.identity.property);
    byName.set(model.name, model);
    byNode.set(model.nodeId, model);
  }
  if (!byNode.has(plan.root.model.nodeId)) {
    throw new Error(
      `Search index ${plan.logicalIdentity.name} root ${plan.root.model.nodeId} has no relational model.`,
    );
  }
  for (const source of plan.sourceFrontiers) {
    if (!byName.has(source.model)) {
      throw new Error(
        `Search index ${plan.logicalIdentity.name} source ${source.model} has no relational model.`,
      );
    }
  }
  return new Map([...byName, ...byNode]);
}

function requiredModel(
  models: ReadonlyMap<string, ApplicationRelationalSearchModel>,
  nodeId: string,
): ApplicationRelationalSearchModel {
  const model = models.get(nodeId);
  if (!model) throw new Error(`Relational search model ${nodeId} is missing.`);
  return model;
}

function requiredModelByName(
  models: ReadonlyMap<string, ApplicationRelationalSearchModel>,
  name: string,
): ApplicationRelationalSearchModel {
  const model = models.get(name);
  if (!model) throw new Error(`Relational search model ${name} is missing.`);
  return model;
}

function requiredColumn(
  model: ApplicationRelationalSearchModel,
  property: string,
): ApplicationRelationalSearchColumn {
  const column = model.columns.find((candidate) => candidate.property === property);
  if (!column) {
    throw new Error(
      `Relational search model ${model.name} has no column for property ${property}.`,
    );
  }
  return column;
}

function assertRelationshipColumns(
  source: ApplicationRelationalSearchModel,
  target: ApplicationRelationalSearchModel,
  relationship: ApplicationRelationalSearchRelationship,
): void {
  if (
    relationship.fields.length === 0 ||
    relationship.fields.length !== relationship.references.length
  ) {
    throw new Error(
      `Relational search relationship ${source.name}.${relationship.name} has no complete bounded key mapping.`,
    );
  }
  for (const field of relationship.fields) requiredColumn(source, field);
  for (const reference of relationship.references) requiredColumn(target, reference);
}

function qualifiedTable(model: ApplicationRelationalSearchModel): string {
  return model.schema
    ? `${quoteIdentifier(model.schema)}.${quoteIdentifier(model.tableName)}`
    : quoteIdentifier(model.tableName);
}

function columnExpression(alias: string, column: string): string {
  return `${quoteIdentifier(alias)}.${quoteIdentifier(column)}`;
}

function quoteIdentifier(value: string): string {
  if (!value || value.includes("\0")) {
    throw new Error(`Invalid PostgreSQL identifier ${JSON.stringify(value)}.`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function rowInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "string"
        ? Number(value)
        : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    throw new Error(`Relational search row ${field} must be a non-negative integer.`);
  }
  return parsed;
}

function requiredRowString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Relational search row ${field} must be a non-empty string.`);
  }
  return value;
}

function requiredIdentity(value: string): string {
  if (!value) throw new Error("Relational search identities must not be empty.");
  return value;
}

function scalarIdentity(value: unknown): string {
  if (typeof value === "string") return requiredIdentity(value);
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value && typeof value === "object") {
    const entries = Object.values(value);
    if (entries.length === 1) return requiredIdentity(String(entries[0]));
  }
  throw new Error("Relational search change identity must use scalar encoding.");
}

function normalizedTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(requiredRowString(value, "recorded_at"));
  if (!Number.isFinite(date.valueOf())) {
    throw new Error("Relational search row recorded_at must be a timestamp.");
  }
  return date.toISOString();
}

function requiredDocument<TDocument extends object>(
  value: unknown,
  identity: string,
): TDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Relational search document ${identity} must be a JSON object.`,
    );
  }
  return value as TDocument;
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function requiredSession(
  sessions: ReadonlyMap<string, SnapshotSession>,
  snapshotId: string,
): SnapshotSession {
  const session = sessions.get(snapshotId);
  if (!session || session.closed) {
    throw new Error(`Relational search snapshot ${snapshotId} is not active.`);
  }
  return session;
}

function assertOpen(closed: boolean): void {
  if (closed) throw new Error("Application relational search sources are closed.");
}
