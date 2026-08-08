import { isIPv4, isIPv6 } from 'node:net';

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inIpv4Cidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(rangeIp!) & mask);
}

const BLOCKED_IPV4_CIDRS = [
  '0.0.0.0/8', // "this network"
  '10.0.0.0/8', // private
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local — includes cloud metadata (169.254.169.254)
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved
];

function expandIpv6Groups(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  if (!ip.includes('::')) {
    return ip.split(':');
  }
  const missing = 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array(Math.max(missing, 0)).fill('0'), ...tailGroups];
}

function ipv6ToBigInt(ip: string): bigint {
  const groups = expandIpv6Groups(ip).map((g) => (g === '' ? 0 : parseInt(g, 16)));
  let result = 0n;
  for (const group of groups) {
    result = (result << 16n) | BigInt(group);
  }
  return result;
}

function inIpv6Cidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/');
  const prefix = BigInt(Number(prefixStr));
  const mask = prefix === 0n ? 0n : (~0n << (128n - prefix)) & ((1n << 128n) - 1n);
  return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(rangeIp!) & mask);
}

const BLOCKED_IPV6_CIDRS = [
  '::1/128', // loopback
  '::/128', // unspecified
  '::ffff:0:0/96', // IPv4-mapped — unwrapped and rechecked separately below
  '64:ff9b::/96', // NAT64 well-known prefix (maps to IPv4)
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  'ff00::/8', // multicast
];

function extractMappedIpv4(ip: string): string | null {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return match?.[1] ?? null;
}

/**
 * True if `ip` is a loopback, private, link-local, multicast, or otherwise
 * reserved address — including the IPv4 link-local range that covers cloud
 * metadata endpoints (169.254.169.254) and IPv6-mapped IPv4 addresses.
 * Used to block SSRF via DNS rebinding or attacker-controlled redirects
 * before downloading any Kickflip-supplied image URL.
 */
export function isBlockedIpAddress(ip: string): boolean {
  if (isIPv4(ip)) {
    return BLOCKED_IPV4_CIDRS.some((cidr) => inIpv4Cidr(ip, cidr));
  }
  if (isIPv6(ip)) {
    const mapped = extractMappedIpv4(ip);
    if (mapped) return isBlockedIpAddress(mapped);
    return BLOCKED_IPV6_CIDRS.some((cidr) => inIpv6Cidr(ip, cidr));
  }
  // Not a literal IP — caller is responsible for resolving hostnames first.
  return true;
}
