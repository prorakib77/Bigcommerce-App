import { describe, expect, it } from 'vitest';
import { isBlockedIpAddress } from './ssrf';

describe('isBlockedIpAddress', () => {
  it.each([
    ['127.0.0.1', 'IPv4 loopback'],
    ['10.0.0.5', 'IPv4 private (10/8)'],
    ['172.16.0.5', 'IPv4 private (172.16/12)'],
    ['172.31.255.255', 'IPv4 private (172.16/12 upper bound)'],
    ['192.168.1.1', 'IPv4 private (192.168/16)'],
    ['169.254.169.254', 'cloud metadata endpoint'],
    ['169.254.0.1', 'IPv4 link-local'],
    ['0.0.0.0', '"this network"'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'IPv4 multicast'],
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'IPv6 link-local'],
    ['fc00::1', 'IPv6 unique local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped IPv6 loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped IPv6 metadata endpoint'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIpAddress(ip)).toBe(true);
  });

  it.each([
    ['8.8.8.8', 'public IPv4'],
    ['1.1.1.1', 'public IPv4'],
    ['93.184.216.34', 'public IPv4'],
    ['2606:4700:4700::1111', 'public IPv6'],
  ])('allows %s (%s)', (ip) => {
    expect(isBlockedIpAddress(ip)).toBe(false);
  });

  it('treats an unparseable value as blocked (fail closed)', () => {
    expect(isBlockedIpAddress('not-an-ip')).toBe(true);
  });

  it('does not misclassify a public address adjacent to a private range boundary', () => {
    expect(isBlockedIpAddress('172.32.0.1')).toBe(false); // just above 172.16.0.0/12
    expect(isBlockedIpAddress('172.15.255.255')).toBe(false); // just below
  });
});
