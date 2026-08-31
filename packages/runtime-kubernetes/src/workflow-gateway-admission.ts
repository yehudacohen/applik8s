/**
 * Kubernetes primitives used by compiler-generated workflow gateway admission.
 *
 * Generated applications import this focused runtime-owned boundary instead of
 * depending directly on runtime-kubernetes's private Kubernetes SDK dependency.
 */
export {
  AuthenticationV1Api,
  CoordinationV1Api,
  KubeConfig,
  V1MicroTime,
} from '@kubernetes/client-node';
