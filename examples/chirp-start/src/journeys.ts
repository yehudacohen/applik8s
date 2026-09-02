import { journey } from '@applik8s/testing';

/** The smallest real Chirp product path: publish through admission and observe the live timeline. */
export const PublishChirpPostJourney = journey(
  'chirp.publish-post.v1',
  async context => {
    const browser = context.browser();
    const body = `A source-owned journey ${context.fixtureSeed}`.slice(0, 280);
    await browser.goto('/');
    await browser.fill({ by: 'label', value: 'Post text' }, body);
    await browser.click({ by: 'role', role: 'button', name: 'Post' });
    await browser.expectText({ by: 'text', value: body }, body, 'the committed post appears in the live home timeline');
    await browser.expectAccessible({ maximumImpact: 'moderate' });
  },
  {
    modes: ['browser'],
    requirements: ['browser'],
    dependencies: [
      { kind: 'model', id: 'Post', reason: 'publishes the authenticated post' },
      { kind: 'event', id: 'PostTimelineChanged', reason: 'invalidates the live timeline projection' },
      { kind: 'page', id: '/', reason: 'owns the primary Chirp author journey' },
    ],
  },
);

export const chirpJourneys = Object.freeze([PublishChirpPostJourney]);
