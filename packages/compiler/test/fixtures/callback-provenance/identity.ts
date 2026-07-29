function normalizeIdentity(request: Request) {
  return request.headers.get('x-user') ?? 'anonymous';
}

export async function authenticateRequest(request: Request) {
  return { principal: { id: normalizeIdentity(request) }, trustedContext: {}, authorizationVersion: 'v1' };
}
