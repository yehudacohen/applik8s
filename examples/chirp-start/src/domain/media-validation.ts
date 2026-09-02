/** Pure media validation helpers kept independent of Chirp's deployment graph. */
export function matchesMediaSignature(contentType: string, body: Uint8Array): boolean {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => body[index] === byte);
  switch (contentType.toLowerCase()) {
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/gif':
      return starts(0x47, 0x49, 0x46, 0x38) && (body[4] === 0x37 || body[4] === 0x39) && body[5] === 0x61;
    case 'image/webp':
      return (
        starts(0x52, 0x49, 0x46, 0x46) && body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50
      );
    case 'video/mp4':
      return body[4] === 0x66 && body[5] === 0x74 && body[6] === 0x79 && body[7] === 0x70;
    default:
      return false;
  }
}

export function containsAscii(body: Uint8Array, value: string): boolean {
  const needle = new TextEncoder().encode(value);
  for (let offset = 0; offset <= body.byteLength - needle.byteLength; offset += 1) {
    if (needle.every((byte, index) => body[offset + index] === byte)) return true;
  }
  return false;
}
