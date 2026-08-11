export const application = {
  workflow: Object.assign(
    (..._args: readonly unknown[]) => async (input: unknown) => input,
    {
      signal: (..._args: readonly unknown[]) => undefined,
      async emitSignal(..._args: readonly unknown[]) {
        return async () => undefined;
      },
    },
  ),
};
