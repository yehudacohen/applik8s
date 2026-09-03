// typecast-file-boundary: AWS CLI process-format credentials and STS identity
// are external JSON validated before being confined to the child process.
export {};

interface ProcessCredentials {
  readonly AccessKeyId?: unknown;
  readonly SecretAccessKey?: unknown;
  readonly SessionToken?: unknown;
  readonly Expiration?: unknown;
}

interface CallerIdentity {
  readonly Account?: unknown;
  readonly Arn?: unknown;
}

// Bun consumes the conventional `--` separator before exposing Bun.argv.
const command = Bun.argv.slice(2);
const profile = requiredEnvironment("APPLIK8S_AWS_PROFILE");
const accountId = requiredEnvironment("APPLIK8S_E2E_AWS_ACCOUNT_ID");
const expectedArn = requiredEnvironment("APPLIK8S_E2E_AWS_EXPECTED_ARN");
const region = requiredEnvironment("APPLIK8S_E2E_AWS_REGION");

if (command.length === 0) {
  throw new Error("Expected a child command after --.");
}

const caller = await awsJson<CallerIdentity>([
  "sts", "get-caller-identity", "--profile", profile, "--region", region,
]);
if (caller.Account !== accountId || caller.Arn !== expectedArn) {
  throw new Error(
    `AWS profile ${profile} resolved to ${String(caller.Account)}/${String(caller.Arn)}, not the explicitly authorized ${accountId}/${expectedArn}.`,
  );
}

const credentials = await awsJson<ProcessCredentials>([
  "configure", "export-credentials", "--profile", profile, "--format", "process",
]);
if (
  typeof credentials.AccessKeyId !== "string"
  || typeof credentials.SecretAccessKey !== "string"
  || (credentials.SessionToken !== undefined && typeof credentials.SessionToken !== "string")
) {
  throw new Error(`AWS profile ${profile} did not export a complete temporary credential process response.`);
}
const expiration = typeof credentials.Expiration === "string"
  ? Date.parse(credentials.Expiration)
  : Number.NaN;
if (!Number.isFinite(expiration) || expiration <= Date.now()) {
  throw new Error(`AWS profile ${profile} must export unexpired temporary credentials.`);
}

const childEnvironment = { ...process.env };
delete childEnvironment.AWS_PROFILE;
delete childEnvironment.AWS_DEFAULT_PROFILE;
Object.assign(childEnvironment, {
  AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
  AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
  AWS_SESSION_TOKEN: credentials.SessionToken ?? "",
  AWS_REGION: region,
  AWS_DEFAULT_REGION: region,
  AWS_ACCOUNT_ID: accountId,
  AWS_EC2_METADATA_DISABLED: "true",
});

const child = Bun.spawn(command, {
  cwd: process.cwd(),
  env: childEnvironment,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exitCode = await child.exited;

async function awsJson<T>(args: readonly string[]): Promise<T> {
  const child = Bun.spawn(["aws", ...args, "--output", "json"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) {
    throw new Error(`AWS CLI command ${args[0]} ${args[1]} failed. Run aws login --profile ${profile} and retry.`);
  }
  const value: unknown = JSON.parse(output);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`AWS CLI command ${args[0]} ${args[1]} returned an invalid JSON object.`);
  }
  return value as T;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
