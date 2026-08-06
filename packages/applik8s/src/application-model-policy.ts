/**
 * Internal marker for an authored transaction policy that rejected a
 * conventional model mutation. The command runtime converts this marker into
 * a durable terminal result; infrastructure failures retain their normal
 * retry behavior.
 */
export class ApplicationModelPolicyRejectedError extends Error {
  readonly code = 'applik8s-model-policy-rejected';

  constructor(
    readonly rejection: {
      readonly name: 'policyRejected';
      readonly payload: { readonly message: string };
    },
    readonly policyCause: unknown,
  ) {
    super(`applik8s-model-policy-rejected: ${rejection.payload.message}`, {
      cause: policyCause,
    });
    this.name = 'ApplicationModelPolicyRejectedError';
  }
}

/**
 * Executes a conventional model's beforeCommit policy while preserving the
 * distinction between an expected application decision and a runtime failure.
 *
 * This helper is compiler-facing. Application authors keep using ordinary
 * throws inside beforeCommit callbacks.
 */
export async function runApplicationModelBeforeCommit(
  callback: () => void | Promise<void>,
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    if (isApplicationModelPolicyRejectedError(error)) throw error;
    throw new ApplicationModelPolicyRejectedError(
      {
        name: 'policyRejected',
        payload: { message: applicationModelPolicyErrorMessage(error) },
      },
      error,
    );
  }
}

export function isApplicationModelPolicyRejectedError(
  error: unknown,
): error is ApplicationModelPolicyRejectedError {
  return error instanceof ApplicationModelPolicyRejectedError
    || Boolean(
      error
      && typeof error === 'object'
      && Reflect.get(error, 'code') === 'applik8s-model-policy-rejected'
      && Reflect.get(error, 'rejection'),
    );
}

function applicationModelPolicyErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    error
    && typeof error === 'object'
    && typeof Reflect.get(error, 'message') === 'string'
    && String(Reflect.get(error, 'message')).trim()
  ) {
    return String(Reflect.get(error, 'message'));
  }
  return 'The model mutation was rejected by its transaction policy.';
}
