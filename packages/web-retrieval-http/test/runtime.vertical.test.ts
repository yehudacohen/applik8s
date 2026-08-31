import { describe, expect, it } from 'vitest';
import {
  BoundedHttpSourceRetriever,
  normalizeBoundedHttpSourceRetrieverOptions,
} from '../src/index.js';
import { isPublicAddress } from '../src/runtime.js';

describe('bounded HTTP source retrieval', () => {
  it('rejects private, loopback, link-local, documentation, and metadata destinations', async () => {
    const provider = BoundedHttpSourceRetriever.create({ allowInsecureHttp: true });
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '192.0.2.1',
      '198.51.100.1',
      '203.0.113.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      'fe80::1',
      '2001:db8::1',
    ]) {
      expect(isPublicAddress(address)).toBe(false);
      const host = address.includes(':') ? `[${address}]` : address;
      await expect(provider.retrieve({ url: `http://${host}/` }))
        .rejects.toThrow(/rejects non-public address/u);
    }
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('fails closed for plaintext defaults, unsafe ports, and unbounded policies', async () => {
    const provider = BoundedHttpSourceRetriever.create();
    await expect(provider.retrieve({ url: 'http://example.com' })).rejects.toThrow(/requires HTTPS/u);
    await expect(provider.retrieve({ url: 'https://example.com:8443' })).rejects.toThrow(/port 8443/u);
    expect(() => normalizeBoundedHttpSourceRetrieverOptions({ maximumBytes: 50_000_000 })).toThrow(/maximumBytes/u);
    expect(() => normalizeBoundedHttpSourceRetrieverOptions({ maximumRedirects: 100 })).toThrow(/maximumRedirects/u);
  });

  it('publishes a portable managed-worker policy without leaking callbacks', () => {
    const provider = BoundedHttpSourceRetriever.create({
      allowedPorts: [443],
      maximumRedirects: 3,
      maximumBytes: 500_000,
    });
    expect(provider).toMatchObject({
      provider: 'bounded-http',
      kind: 'bounded-http-source-retriever',
      policy: { allowedPorts: [443], maximumRedirects: 3, maximumBytes: 500_000 },
    });
  });
});
