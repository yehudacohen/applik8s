import { AdoptPolicy } from "alchemy/AdoptPolicy";
import {
  AlchemyContext,
  AlchemyContextLive,
} from "alchemy/AlchemyContext";
import { provideFreshArtifactStore } from "alchemy/Artifacts";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import {
  ProfileLive,
  withProfileOverride,
} from "alchemy/Auth/Profile";
import { LoggingCli } from "alchemy/Cli/LoggingCli";
import type { State } from "alchemy/State/State";
import { loadConfigProvider } from "alchemy/Util/ConfigProvider";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import { ConfigProvider } from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

export interface ApplicationAlchemyRuntimeOptions {
  readonly state: Layer.Layer<State, never, never>;
  readonly profile?: string;
  readonly adopt?: boolean;
  readonly dev?: boolean;
}

const platformLayer = Layer.mergeAll(
  PlatformServices,
  FetchHttpClient.layer,
  Layer.provide(ProfileLive, PlatformServices),
  Layer.provide(CredentialsStoreLive, PlatformServices),
);

const alchemyLayer = Layer.mergeAll(LoggingCli, AlchemyContextLive);

/**
 * Executes an Alchemy effect in the exact runtime cohort pinned by TypeKro
 * 0.33.6. This is the single intentionally isolated Alchemy host boundary.
 */
export function applicationAlchemyRuntimeEffect<A>(
  effect: Effect.Effect<A, unknown, unknown>,
  options: ApplicationAlchemyRuntimeOptions,
): Effect.Effect<A, unknown, never> {
  const overrideAlchemyContext = Layer.effect(
    AlchemyContext,
    AlchemyContext.pipe(
      Effect.map((context) => ({
        ...context,
        dev: options.dev ?? false,
        adopt: options.adopt ?? false,
      })),
    ),
  );
  // typecast: Alchemy's effect carries its full service union, all of
  // typecast: the pinned runtime below supplies the full service union.
  const executable = effect as Effect.Effect<A, unknown, never>;
  const base = Effect.gen(function* () {
    const config = yield* loadConfigProvider(Option.none());
    return yield* executable.pipe(
      provideFreshArtifactStore,
      Effect.provide(
        Layer.succeed(
          ConfigProvider,
          withProfileOverride(config, options.profile),
        ),
      ),
    );
  }).pipe(
    Effect.provideService(AdoptPolicy, options.adopt ?? false),
    Effect.provide(overrideAlchemyContext),
    Effect.provide(options.state),
    Effect.provideService(AuthProviders, {}),
    Effect.provide(Layer.provideMerge(alchemyLayer, platformLayer)),
  );
  // typecast: all requirements are closed by the runtime layers.
  return Effect.scoped(base) as Effect.Effect<A, unknown, never>;
}

export function runApplicationAlchemyEffect<A>(
  effect: Effect.Effect<A, unknown, unknown>,
  options: ApplicationAlchemyRuntimeOptions,
): Promise<A> {
  return Effect.runPromise(applicationAlchemyRuntimeEffect(effect, options));
}
