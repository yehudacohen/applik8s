// typecast-file-boundary: this release fixture validates its bounded command
// and context before constructing disposable TypeKro resources.
import { KubeConfig } from '@kubernetes/client-node';
import { type } from 'arktype';
import { kubernetesComposition } from 'typekro';
import {
  deployment,
  namespace,
  secret,
  service,
} from 'typekro/kubernetes';

const command = process.argv[2];
if (
  command !== 'prepare'
  && command !== 'cleanup'
  && command !== 'prepare-external'
  && command !== 'cleanup-external'
) {
  throw new Error(
    'Usage: bun run scripts/identity-start-dedicated-fixture.ts <prepare|cleanup|prepare-external|cleanup-external>',
  );
}
const externalLifecycle = command.endsWith('-external');
const preparing = command.startsWith('prepare');
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
if (context !== 'orbstack') {
  throw new Error(
    `The Dedicated Identity fixture is restricted to context "orbstack"; received ${JSON.stringify(context)}.`,
  );
}

const fixtureNamespace = 'applik8s-v07-identity-fixture';
const applicationNamespace = 'identity-start-system';
const controlPlaneNamespace = 'identity-start-control';
const serverName = 'identity-start-inference';
const serverPort = 8080;
const inferenceSecretName = 'identity-start-inference';
const webSearchSecretName = 'identity-start-web-search';
const paymentsSecretName = externalLifecycle
  ? 'identity-external-payments'
  : 'identity-start-payments';
const notificationsSecretName = externalLifecycle
  ? 'identity-external-notifications'
  : 'identity-start-notifications';
const labels = {
  'app.kubernetes.io/name': serverName,
  'app.kubernetes.io/managed-by': 'typekro',
  'applik8s.dev/release-fixture': 'identity-start-dedicated',
};

function createDedicatedFixture() {
  return kubernetesComposition(
    {
      name: externalLifecycle
        ? 'identity-start-external-inference-fixture'
        : 'identity-start-dedicated-fixture',
      apiVersion: 'testing.applik8s.dev/v1alpha1',
      kind: 'IdentityStartDedicatedFixture',
      spec: type({ name: 'string' }),
      status: type({
        ready: 'boolean',
        endpoint: 'string',
      }),
    },
    () => {
      const fixtureNs = namespace({
        id: 'fixtureNamespace',
        metadata: { name: fixtureNamespace, labels },
      });
      const controlNs = namespace({
        id: 'controlNamespace',
        metadata: { name: controlPlaneNamespace, labels },
      });
      const applicationNs = externalLifecycle
        ? undefined
        : namespace({
            id: 'applicationNamespace',
            metadata: { name: applicationNamespace, labels },
          });
      const credentials = secret({
        id: 'inferenceCredentials',
        metadata: {
          name: inferenceSecretName,
          namespace: applicationNamespace,
          labels,
        },
        stringData: { apiKey: 'v07-dedicated-fixture-key' },
      });
      if (applicationNs) {
        credentials.dependsOn(applicationNs);
      }
      const paymentCredentials = secret({
        id: 'paymentCredentials',
        metadata: {
          name: paymentsSecretName,
          namespace: applicationNamespace,
          labels,
        },
        stringData: {
          apiKey: 'sk_test_v07_dedicated_fixture',
          webhookSecret: 'whsec_v07_dedicated_fixture',
        },
      });
      if (applicationNs) {
        paymentCredentials.dependsOn(applicationNs);
      }
      const notificationCredentials = secret({
        id: 'notificationCredentials',
        metadata: {
          name: notificationsSecretName,
          namespace: applicationNamespace,
          labels,
        },
        stringData: {
          username: 'v07-identity-fixture',
          password: 'v07-identity-fixture-password',
        },
      });
      if (applicationNs) {
        notificationCredentials.dependsOn(applicationNs);
      }
      if (!externalLifecycle) {
        const webSearchCredentials = secret({
          id: 'webSearchCredentials',
          metadata: {
            name: webSearchSecretName,
            namespace: applicationNamespace,
            labels,
          },
          stringData: { secret_key: 'identity-start-web-search-fixture-key' },
        });
        if (applicationNs) webSearchCredentials.dependsOn(applicationNs);
      }

      const server = deployment({
        id: 'inferenceServer',
        metadata: {
          name: serverName,
          namespace: fixtureNamespace,
          labels,
        },
        spec: {
          replicas: 1,
          selector: { matchLabels: labels },
          template: {
            metadata: { labels },
            spec: {
              containers: [
                {
                  name: 'server',
                  image:
                    'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
                  command: ['node', '-e', inferenceServerSource],
                  ports: [{ name: 'http', containerPort: serverPort }],
                  readinessProbe: {
                    httpGet: { path: '/healthz', port: 'http' },
                    initialDelaySeconds: 1,
                    periodSeconds: 1,
                  },
                  resources: {
                    requests: { cpu: '20m', memory: '32Mi' },
                    limits: { memory: '128Mi' },
                  },
                },
              ],
            },
          },
        },
      });
      server.dependsOn(fixtureNs);

      const endpoint = service({
        id: 'inferenceService',
        metadata: {
          name: serverName,
          namespace: fixtureNamespace,
          labels,
        },
        spec: {
          selector: labels,
          ports: [
            {
              name: 'http',
              port: serverPort,
              targetPort: 'http',
            },
          ],
        },
      });
      endpoint.dependsOn(server);
      controlNs.dependsOn(fixtureNs);

      return {
        ready: true,
        endpoint:
          `http://${serverName}.${fixtureNamespace}.svc.cluster.local:${serverPort}/v1`,
      };
    },
  );
}

const inferenceServerSource = String.raw`
const http = require('node:http');
const requestInput = {
  operation: 'catalog.repair',
  target: 'production/agent-fixture',
  evidence: 'Dedicated provider fixture incident INC-AGENT-070 requires reviewed repair.',
  intendedOutcome: 'Restore catalog availability through one reviewed access grant.'
};
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ready":true}');
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(404);
    response.end();
    return;
  }
  let source = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { source += chunk; });
  request.on('end', () => {
    const input = JSON.parse(source || '{}');
    const tool = input.tools?.[0]?.function?.name ?? input.tools?.[0]?.name;
    const model = input.model ?? 'identity-reviewer-v1';
    const created = Math.floor(Date.now() / 1000);
    const toolCompleted = Array.isArray(input.messages)
      && input.messages.some(message => message?.role === 'tool');
    const call = {
      index: 0,
      id: 'call_identity_start_fixture',
      type: 'function',
      function: {
        name: tool,
        arguments: JSON.stringify(requestInput)
      }
    };
    if (input.stream === true) {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache'
      });
      if (toolCompleted) {
        response.write('data: ' + JSON.stringify({
          id: 'chatcmpl_identity_start_fixture',
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              content: 'A bounded access request was submitted for durable human review.'
            },
            finish_reason: null
          }]
        }) + '\n\n');
        response.write('data: ' + JSON.stringify({
          id: 'chatcmpl_identity_start_fixture',
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }]
        }) + '\n\n');
        response.end('data: [DONE]\n\n');
        return;
      }
      response.write('data: ' + JSON.stringify({
        id: 'chatcmpl_identity_start_fixture',
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: 'assistant', tool_calls: [call] },
          finish_reason: null
        }]
      }) + '\n\n');
      response.write('data: ' + JSON.stringify({
        id: 'chatcmpl_identity_start_fixture',
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'tool_calls'
        }]
      }) + '\n\n');
      response.end('data: [DONE]\n\n');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    if (toolCompleted) {
      response.end(JSON.stringify({
        id: 'chatcmpl_identity_start_fixture',
        object: 'chat.completion',
        created,
        model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'A bounded access request was submitted for durable human review.'
          },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));
      return;
    }
    response.end(JSON.stringify({
      id: 'chatcmpl_identity_start_fixture',
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [call]
        },
        finish_reason: 'tool_calls'
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
  });
});
server.listen(${serverPort}, '0.0.0.0');
`;

const fixture = createDedicatedFixture();
const kubeConfig = new KubeConfig();
kubeConfig.loadFromDefault();
kubeConfig.setCurrentContext(context);
const factory = fixture.factory('direct', {
  namespace: fixtureNamespace,
  waitForReady: true,
  // OrbStack's namespace controller commonly needs more than one five-minute
  // reconciliation pass after Flux/provider finalizers have disappeared.
  timeout: 20 * 60_000,
  kubeConfig,
});

try {
  if (preparing) {
    const result = await factory.deploy({ name: 'fixture' });
    if (result.status.ready !== true) {
      throw new Error(
        `Dedicated fixture did not become ready: ${JSON.stringify(result.status)}`,
      );
    }
    console.log(JSON.stringify({
      fixture: externalLifecycle
        ? 'identity-start-external-inference'
        : 'identity-start-dedicated',
      action: 'prepared',
      context,
      endpoint: result.status.endpoint,
    }));
  } else {
    const deletion = await factory.deleteInstance('fixture', {
      scopes: ['cluster'],
      includeUnscopedResources: true,
    });
    if (deletion.status !== 'complete') {
      throw new Error(
        `Dedicated fixture cleanup did not complete: ${JSON.stringify(deletion)}`,
      );
    }
    console.log(JSON.stringify({
      fixture: externalLifecycle
        ? 'identity-start-external-inference'
        : 'identity-start-dedicated',
      action: 'cleaned',
      context,
    }));
  }
} finally {
  await factory.dispose();
}
