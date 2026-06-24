# Positioning

`applik8s` is a TypeScript framework for building Kubernetes-native applications and operators.

It does not replace Kubernetes. It makes Kubernetes programmable with typed TypeScript authoring, explicit operation plans, generated artifacts, and a Rust/WASM runtime.

## Compared With Kubebuilder And Operator SDK

Kubebuilder and Operator SDK are mature operator frameworks centered on Go and controller-runtime patterns.

applik8s is for teams that want a TypeScript authoring model, local handler tests, WASM handler artifacts, and generated Kubernetes install assets while preserving Kubernetes semantics.

## Compared With Kopf And Metacontroller

Kopf and Metacontroller provide alternative ways to write controllers with less boilerplate.

applik8s emphasizes typed CRD authoring, operation-plan validation before effects, generated runtime manifests, source-mapped diagnostics, and explicit compatibility contracts.

## Compared With Pulumi And cdk8s

Pulumi and cdk8s are infrastructure authoring tools.

applik8s builds reconciling operators that react to Kubernetes objects over time. Generated YAML is an install artifact, not the entire product model.

## Compared With TypeKro

TypeKro composes Kubernetes resources and status relationships.

applik8s complements TypeKro by producing operators that TypeKro can install and whose CRDs can be instantiated inside a composition. TypeKro remains an integration target, not a core dependency.

## Compared With Dapr, Knative, Temporal, And Argo Workflows

Those systems provide application runtime, serverless, workflow, or orchestration models.

applik8s is an operator authoring and runtime framework. It models Kubernetes reconciliation and explicit Kubernetes side effects, not general workflow execution.

## v0.1 Message

Use v0.1 to evaluate whether applik8s makes TypeScript operator authoring feel clear, inspectable, and diagnosable.

Do not use v0.1 as a claim of production HA, broad packaging support, arbitrary external capability coverage, or high-scale controller benchmarking.
