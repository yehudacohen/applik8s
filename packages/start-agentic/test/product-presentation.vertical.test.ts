import { describe, expect, it } from 'vitest';
import {
  agenticAssistantFailureMessage,
  agenticToolLabel,
  agenticToolStateLabel,
} from '../src/product-presentation.js';

describe('Agentic Start product presentation', () => {
  it('removes protocol and digest noise from generated tool labels', () => {
    expect(agenticToolLabel('applik8s_models_Document_create_1a2b3c4')).toBe('Models Document create');
    expect(agenticToolStateLabel('input-streaming')).toBe('input streaming');
  });

  it('maps provider and cancellation failures to bounded product language', () => {
    expect(agenticAssistantFailureMessage(new Error('HTTP 401 unauthorized'))).toContain('credential');
    expect(agenticAssistantFailureMessage(new Error('AbortError: cancelled'))).toContain('cancelled');
  });
});
