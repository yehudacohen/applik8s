import * as Effect from "effect/Effect";
import { applicationAlchemyStateService } from "./state.js";

export interface ApplicationAlchemyDestroyState {
  readonly stateRoot: string;
  readonly stack: string;
  readonly stage: string;
}

/**
 * Alchemy destroy is resumable, so leaving state behind is evidence that the
 * transaction has not actually reached its terminal boundary. Never allow the
 * CLI to turn that state into a false-success message: the same destroy command
 * can safely resume every listed resource on its next invocation.
 */
export async function assertApplicationAlchemyDestroyCompleted(
  options: ApplicationAlchemyDestroyState,
): Promise<void> {
  const remaining = await Effect.runPromise(
    applicationAlchemyStateService({
      root: options.stateRoot,
    }).list({
      stack: options.stack,
      stage: options.stage,
    }),
  );
  assertApplicationAlchemyDestroyState(remaining);
}

export function assertApplicationAlchemyDestroyState(
  remaining: readonly string[],
): void {
  if (remaining.length === 0) return;
  const visible = remaining.slice(0, 12);
  const omitted = remaining.length - visible.length;
  throw new Error(
    `Alchemy destroy returned before ${remaining.length} persisted resource${
      remaining.length === 1 ? "" : "s"
    } reached a terminal state: ${visible.join(", ")}${
      omitted > 0 ? `, and ${omitted} more` : ""
    }. Resume the same destroy command; Applik8s will continue from this state.`,
  );
}
