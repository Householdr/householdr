import { BlockList, isIP } from 'node:net';

/** Only global unicast IPv6 can be public; everything else (loopback, mapped, link-local…) can't. */
const globalUnicast = new BlockList();
globalUnicast.addSubnet('2000::', 3, 'ipv6');

/**
 * Ranges the server must never be made to reach: private, loopback, link-local (including the cloud
 * metadata service at 169.254.169.254), shared, documentation, benchmarking, multicast and reserved
 * IPv4, and the global unicast IPv6 ranges that are documentation or carry an IPv4 address inside
 * (Teredo and other protocol assignments, 6to4).
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/**
 * Whether `address` is a public internet address the server may connect to: anything else could
 * reach our own network or the cloud's metadata service (ADR-0017 §6, SEC-5).
 */
export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !blocked.check(address, 'ipv4');
    case 6:
      return globalUnicast.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
    default:
      return false;
  }
}
