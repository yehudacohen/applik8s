import type { DevelopmentChangePlan, DevelopmentContextAttachment, DevelopmentConversationReferent } from '../contracts.js';

export interface StartDevelopmentSession {
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly mode: 'suggest' | 'reviewed-apply';
  readonly sourceEgress: { readonly provider: string; readonly remote: boolean; readonly consentedAttachmentClasses: readonly string[] };
}
export interface DevelopmentSession { readonly id: string; readonly provider: string; readonly createdAt: string; readonly expiresAt?: string }
export interface InspectDevelopmentWorkspace { readonly sessionId: string; readonly request: string; readonly attachments: readonly DevelopmentContextAttachment[]; readonly referents: readonly DevelopmentConversationReferent[] }
export interface ProposeDevelopmentChange extends InspectDevelopmentWorkspace { readonly requestedOutcome: string }
export interface ContinueDevelopmentSession { readonly sessionId: string; readonly turnId: string; readonly input: string }
export interface CancelDevelopmentTurn { readonly sessionId: string; readonly turnId: string }
export interface CloseDevelopmentSession { readonly sessionId: string }
export interface DevelopmentCancellation { readonly sessionId: string; readonly turnId: string; readonly state: 'cancelled' | 'already-terminal' }
export type DevelopmentEvent =
  | { readonly type: 'status'; readonly state: 'starting' | 'inspecting' | 'planning' | 'waiting-for-approval' | 'applying' | 'validating' | 'complete' | 'failed' | 'cancelled'; readonly message: string }
  | { readonly type: 'message'; readonly text: string }
  | { readonly type: 'plan'; readonly plan: DevelopmentChangePlan }
  | { readonly type: 'diagnostic'; readonly severity: 'info' | 'warning' | 'error'; readonly code: string; readonly message: string };

export interface DevelopmentAgentProvider {
  startSession(input: StartDevelopmentSession): Promise<DevelopmentSession>;
  inspect(input: InspectDevelopmentWorkspace): AsyncIterable<DevelopmentEvent>;
  propose(input: ProposeDevelopmentChange): AsyncIterable<DevelopmentEvent>;
  continue(input: ContinueDevelopmentSession): AsyncIterable<DevelopmentEvent>;
  cancel(input: CancelDevelopmentTurn): Promise<DevelopmentCancellation>;
  close(input: CloseDevelopmentSession): Promise<void>;
  /** Rebind one journal-recovered session without granting new authority. */
  restoreSession?(session: DevelopmentSession, input: StartDevelopmentSession): Promise<DevelopmentSession>;
  stop?(): Promise<void>;
}
