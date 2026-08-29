const distractingTemplate = String.raw`
  function notARealHelper() { return 'template'; }
`;
const distractingPattern = /function alsoNotARealHelper\(\) \{\}/u;

export async function routeCallback(input: { readonly id: string }) {
  return lateHelper(input.id);
}

function lateHelper(id: string) {
  return { id };
}
