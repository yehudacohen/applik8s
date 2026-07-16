import type { ApplicationCommandGatewayOptions } from './command-gateway.js';
import { createApplicationCommandGateway } from './command-gateway.js';
import type { ApplicationRequestIdentityProvider } from './application-providers.js';
import type { ApplicationQueryGatewayOptions } from './query-gateway.js';
import { createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler, createApplicationSubscriptionLimiter } from './query-gateway.js';
import { applicationAdmittedContextDigest } from './relational-runtime.js';
import type { ApplicationStreamSubscriptionGatewayOptions } from './stream-subscription-gateway.js';
import { createApplicationStreamSubscriptionGateway } from './stream-subscription-gateway.js';

export interface ApplicationFetchGatewayOptions {
  readonly identity: ApplicationRequestIdentityProvider;
  readonly cursorSecret: string;
  readonly basePath?: string;
  readonly query?: Omit<ApplicationQueryGatewayOptions<Request>, 'authenticate' | 'cursorSecret' | 'subscriptionLimiter'>;
  readonly command?: Omit<ApplicationCommandGatewayOptions, 'authenticate' | 'cursorSecret'>;
  readonly streams?: Omit<ApplicationStreamSubscriptionGatewayOptions, 'authenticate' | 'cursorSecret' | 'subscriptionLimiter'>;
  readonly subscriptionLimits?: { readonly perPrincipal?: number; readonly total?: number };
  readonly ready?: readonly (() => void | Promise<void>)[];
}

export interface ApplicationFetchGateway {
  handle(request: Request): Promise<Response>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Framework-neutral public application boundary.
 *
 * Framework adapters mount this Fetch-compatible handler; authentication,
 * trusted-context admission, cursor integrity, and provider dispatch remain
 * independent of any HTTP or UI framework.
 */
export function createApplicationFetchGateway(options: ApplicationFetchGatewayOptions): ApplicationFetchGateway {
  if (options.cursorSecret.length < 32) throw new Error('Application Fetch gateway cursorSecret must contain at least 32 characters.');
  const basePath = normalizeBasePath(options.basePath ?? '/__applik8s/v1');
  const limits = {
    perPrincipal: options.subscriptionLimits?.perPrincipal ?? 20,
    total: options.subscriptionLimits?.total ?? 1_000,
  };
  const limiter = createApplicationSubscriptionLimiter(limits);
  const queryGateway = options.query
    ? createApplicationQueryGateway({
        ...options.query,
        cursorSecret: options.cursorSecret,
        subscriptionLimiter: limiter,
        subscriptionLimits: limits,
        authenticate: async (request: Request) => {
          const admission = await admitted(options.identity, request);
          return {
            principal: admission.principal,
            admittedContext: { values: admission.trustedContext, digestSecret: options.cursorSecret },
            authorizationVersion: admission.authorizationVersion,
          };
        },
      })
    : undefined;
  const queryHandler = queryGateway
    ? createApplicationQueryGatewayHttpHandler(queryGateway, { basePath: 'queries' })
    : undefined;
  const commandGateway = options.command
    ? createApplicationCommandGateway({
        ...options.command,
        cursorSecret: options.cursorSecret,
        authenticate: (request) => admitted(options.identity, request),
      })
    : undefined;
  const streamGateway = options.streams
    ? createApplicationStreamSubscriptionGateway({
        ...options.streams,
        cursorSecret: options.cursorSecret,
        subscriptionLimiter: limiter,
        authenticate: async (request) => {
          const admission = await admitted(options.identity, request);
          return {
            principal: admission.principal,
            authorizationVersion: admission.authorizationVersion,
            contextDigest: applicationAdmittedContextDigest({
              values: admission.trustedContext,
              digestSecret: options.cursorSecret,
            }),
          };
        },
      })
    : undefined;
  let stopping = false;

  return {
    async handle(request) {
      const url = new URL(request.url);
      if (url.pathname === `${basePath}/healthz`) {
        return json({ live: !stopping }, stopping ? 503 : 200);
      }
      if (url.pathname === `${basePath}/readyz`) {
        try {
          await ready();
          return json({ ready: true }, 200);
        } catch (error) {
          return json({ ready: false, error: error instanceof Error ? error.message : String(error) }, 503);
        }
      }
      if (!url.pathname.startsWith(`${basePath}/`)) return json({ error: 'not_found' }, 404);
      const internal = withInternalPath(request, url.pathname.slice(basePath.length));
      const commandResponse = await commandGateway?.handle(internal.clone());
      if (commandResponse) return commandResponse;
      const streamResponse = await streamGateway?.handle(internal.clone());
      if (streamResponse) return streamResponse;
      if (queryHandler) return queryHandler(internal);
      return json({ error: 'not_found' }, 404);
    },
    ready,
    async close() {
      if (stopping) return;
      stopping = true;
      await commandGateway?.close();
    },
  };

  async function ready(): Promise<void> {
    if (stopping) throw new Error('Application gateway is stopping.');
    await commandGateway?.ready();
    await Promise.all((options.ready ?? []).map((check) => check()));
  }
}

async function admitted(identity: ApplicationRequestIdentityProvider, request: Request) {
  const admission = await identity.authenticate(request);
  if (!admission?.principal?.id || !admission.authorizationVersion || !admission.trustedContext || typeof admission.trustedContext !== 'object') {
    throw new Error('Application RequestIdentity provider returned an incomplete admission.');
  }
  return admission;
}

function normalizeBasePath(value: string): string {
  const normalized = `/${value.split('/').filter(Boolean).join('/')}`;
  if (normalized === '/') throw new Error('Application Fetch gateway basePath must not be the root path.');
  return normalized;
}

function withInternalPath(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname || '/';
  return new Request(url, request);
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
