import {
  app,
  applicationGraphFor,
  getApplicationModelFacet,
} from '@applik8s/applik8s';
import {
  applicationArtifactSchema,
  artifacts,
} from '@applik8s/artifacts';
import {
  applicationConversationSchema,
  conversations,
} from '@applik8s/conversations';
import {
  applicationEvaluationSchema,
  evaluations,
} from '@applik8s/evals';
import { applicationUsageSchema, usage } from '@applik8s/usage';
import { describe, expect, it } from 'vitest';
import {
  applicationApprovalSchema,
  approvals,
} from '../src/index.js';

describe('maintained agentic product modules', () => {
  it('compose as ordinary typed relational models on one application graph', () => {
    const application = app('agentic-modules', {
      namespace: 'agentic-modules-system',
    });
    const database = application.database.postgres('application', {
      schema: {
        ...applicationConversationSchema,
        ...applicationApprovalSchema,
        ...applicationArtifactSchema,
        ...applicationEvaluationSchema,
        ...applicationUsageSchema,
      },
    });

    const Conversations = conversations(application, { database });
    const Approvals = approvals(application, { database });
    const Artifacts = artifacts(application, { database });
    const Evaluations = evaluations(application, { database });
    const Usage = usage(application, { database });

    expect(typeof Conversations.Conversation.create).toBe('function');
    expect(typeof Approvals.ApprovalReview.create).toBe('function');
    expect(typeof Artifacts.Artifact.create).toBe('function');
    expect(typeof Evaluations.EvaluationResult.create).toBe('function');
    expect(typeof Usage.UsageFact.create).toBe('function');
    expect(
      getApplicationModelFacet(Approvals.OutcomeObservation)?.relationships,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'review',
          target: 'ApprovalReview',
        }),
      ]),
    );

    const graph = applicationGraphFor(application.composition);
    const models = graph?.nodes
      .filter((node) => node.kind === 'model')
      .map((node) => node.name)
      .sort();
    expect(models).toEqual([
      'ApprovalReview',
      'Artifact',
      'Entitlement',
      'EvaluationCase',
      'EvaluationDataset',
      'EvaluationResult',
      'EvaluationRun',
      'EvaluationScorer',
      'Memory',
      'Message',
      'OutcomeObservation',
      'ProtocolRun',
      'RunEvent',
      'UsageFact',
      'Conversation',
    ].sort());
  });
});
