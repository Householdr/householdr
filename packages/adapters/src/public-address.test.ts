import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './public-address';

describe('isPublicAddress (ADR-0017 §6)', () => {
  it.each([
    ['0.0.0.0', 'this network'],
    ['10.1.2.3', 'private'],
    ['100.64.0.1', 'shared address space'],
    ['100.100.100.200', 'shared address space, a cloud metadata address'],
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', 'link-local, the cloud metadata service'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.0.0.1', 'protocol assignments'],
    ['192.0.2.1', 'documentation'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['64:ff9b::a00:1', 'NAT64 to a private address'],
    ['2001::1', 'Teredo'],
    ['2001:db8::1', 'documentation'],
    ['2002:a00:1::1', '6to4 around a private address'],
    ['fc00::1', 'unique local'],
    ['fd00:ec2::254', 'unique local, a cloud metadata address'],
    ['fe80::1', 'link-local'],
    ['fe80::1%eth0', 'link-local with a zone'],
    ['ff02::1', 'multicast'],
    ['localhost', 'not an address at all'],
    ['', 'empty'],
  ])('refuses %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4001::1'])(
    'allows %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});
