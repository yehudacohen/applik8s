import { journey } from '@applik8s/testing';

/** Product acceptance owned beside the GuestBook UI, not by an external test script. */
export const PublishGuestBookEntryJourney = journey(
  'guestbook.publish-entry.v1',
  async context => {
    const browser = context.browser();
    const message = `Hello from ${context.fixtureSeed}`;
    await browser.goto('/');
    await browser.fill({ by: 'label', value: 'Name' }, 'Journey Author');
    await browser.fill({ by: 'label', value: 'Message' }, message);
    await browser.click({ by: 'role', role: 'button', name: 'Create entry' });
    await browser.expectText({ by: 'text', value: message }, message, 'the published entry appears in the authoritative list');
    await browser.expectAccessible({ maximumImpact: 'moderate' });
  },
  {
    modes: ['browser'],
    requirements: ['browser'],
    dependencies: [
      { kind: 'model', id: 'GuestBookEntry', reason: 'creates and observes a published GuestBook entry' },
      { kind: 'page', id: '/', reason: 'owns the GuestBook author journey' },
    ],
  },
);

export const guestBookJourneys = Object.freeze([PublishGuestBookEntryJourney]);
