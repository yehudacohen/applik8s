import {
  type CanonicalJsonV1Policy,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
  canonicalJsonV1Value,
} from "@applik8s/core";
import type {
  ApplicationDeploymentEdge,
  ApplicationDeploymentGraph,
  ApplicationDeploymentNode,
} from "./types.js";

// typecast-file-boundary: Canonical JSON normalization reconstructs the same
// closed portable graph shapes while erasing insertion order and undefined values.

/** Canonical JSON v1 policy for deployment graphs and deployment value digests. */
export const applicationDeploymentCanonicalJsonV1Policy: CanonicalJsonV1Policy = Object.freeze({
  ...canonicalJsonCompatibleV1Policy,
  name: "application-deployment-contract",
});

export function normalizeApplicationDeploymentGraph(
  graph: ApplicationDeploymentGraph,
): ApplicationDeploymentGraph {
  return {
    ...graph,
    metadata: normalizeJson(graph.metadata) as ApplicationDeploymentGraph["metadata"],
    nodes: [...graph.nodes].map(normalizeNode).sort(compareNodes),
    edges: [...graph.edges].map(normalizeEdge).sort(compareEdges),
  };
}

export function serializeApplicationDeploymentGraph(
  graph: ApplicationDeploymentGraph,
): string {
  return `${canonicalJsonV1String(
    normalizeApplicationDeploymentGraph(graph),
    applicationDeploymentCanonicalJsonV1Policy,
  )}\n`;
}

export function digestApplicationDeploymentGraph(
  graph: ApplicationDeploymentGraph,
): string {
  return `sha256:${sha256Hex(serializeApplicationDeploymentGraph(graph))}`;
}

export function digestApplicationDeploymentValue(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJsonV1String(
    value,
    applicationDeploymentCanonicalJsonV1Policy,
  ))}`;
}

function normalizeNode(node: ApplicationDeploymentNode): ApplicationDeploymentNode {
  return normalizeJson({
    ...node,
    capabilities: {
      ...node.capabilities,
      strategies: [...node.capabilities.strategies].sort(compareStrings),
    },
    outputs: [...node.outputs].sort((left, right) =>
      compareStrings(left.name, right.name),
    ),
  }) as ApplicationDeploymentNode;
}

function normalizeEdge(edge: ApplicationDeploymentEdge): ApplicationDeploymentEdge {
  return normalizeJson(edge) as ApplicationDeploymentEdge;
}

function normalizeJson<T>(value: T): T {
  return canonicalJsonV1Value(
    value,
    applicationDeploymentCanonicalJsonV1Policy,
  ) as T;
}

function compareNodes(
  left: ApplicationDeploymentNode,
  right: ApplicationDeploymentNode,
): number {
  return compareStrings(left.id, right.id) || compareStrings(left.kind, right.kind);
}

function compareEdges(
  left: ApplicationDeploymentEdge,
  right: ApplicationDeploymentEdge,
): number {
  return (
    compareStrings(left.from, right.from) ||
    compareStrings(left.relationship, right.relationship) ||
    compareStrings(left.to, right.to) ||
    compareStrings(left.output ?? "", right.output ?? "")
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Portable, synchronous SHA-256 used by deployment-plan compilers. */
export function sha256Hex(value: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (const shift of [24, 16, 8, 0]) bytes.push((high >>> shift) & 0xff);
  for (const shift of [24, 16, 8, 0]) bytes.push((low >>> shift) & 0xff);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f,
    0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Array<number>(64).fill(0);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] =
        (((bytes[start] ?? 0) << 24) |
          ((bytes[start + 1] ?? 0) << 16) |
          ((bytes[start + 2] ?? 0) << 8) |
          (bytes[start + 3] ?? 0)) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const small0 =
        rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const small1 =
        rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) +
          small0 +
          (words[index - 7] ?? 0) +
          small1) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper1 =
        rotateRight(e ?? 0, 6) ^
        rotateRight(e ?? 0, 11) ^
        rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temporary1 =
        ((h ?? 0) +
          upper1 +
          choice +
          (constants[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const upper0 =
        rotateRight(a ?? 0, 2) ^
        rotateRight(a ?? 0, 13) ^
        rotateRight(a ?? 0, 22);
      const majority =
        ((a ?? 0) & (b ?? 0)) ^
        ((a ?? 0) & (c ?? 0)) ^
        ((b ?? 0) & (c ?? 0));
      const temporary2 = (upper0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + (a ?? 0)) >>> 0;
    hash[1] = ((hash[1] ?? 0) + (b ?? 0)) >>> 0;
    hash[2] = ((hash[2] ?? 0) + (c ?? 0)) >>> 0;
    hash[3] = ((hash[3] ?? 0) + (d ?? 0)) >>> 0;
    hash[4] = ((hash[4] ?? 0) + (e ?? 0)) >>> 0;
    hash[5] = ((hash[5] ?? 0) + (f ?? 0)) >>> 0;
    hash[6] = ((hash[6] ?? 0) + (g ?? 0)) >>> 0;
    hash[7] = ((hash[7] ?? 0) + (h ?? 0)) >>> 0;
  }
  return hash
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}
