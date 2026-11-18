// SSRF protection: only public http(s) hosts on standard ports, revalidated on every redirect.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export class DnsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DnsError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
  }
  return true; // not an IP at all -> treat as unsafe
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export const defaultResolver: HostResolver = async (hostname) => {
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((r) => r.address);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    throw new DnsError(`DNS lookup failed for ${hostname} (${code || "unknown"})`);
  }
};

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "instance-data", "169.254.169.254"]);

/** Throws UnsafeUrlError / DnsError when a URL must not be fetched. */
export async function assertPublicUrl(rawUrl: string, resolve: HostResolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError(`Blocked protocol ${url.protocol}`);
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in URL are not allowed");
  if (url.port && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError(`Blocked non-standard port ${url.port}`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (METADATA_HOSTS.has(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeUrlError(`Blocked internal host ${host}`);
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError(`Blocked private address ${host}`);
    return url;
  }
  const addresses = await resolve(host);
  if (addresses.length === 0) throw new DnsError(`No DNS records for ${host}`);
  const bad = addresses.find(isPrivateAddress);
  if (bad) throw new UnsafeUrlError(`${host} resolves to private address ${bad}`);
  return url;
}

type LookupAll = (hostname: string, options: { all: true; verbatim: boolean }, cb: (err: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void) => void;

/**
 * DNS lookup for the HTTP connection itself: refuses to connect to private, loopback, link-local or
 * metadata addresses. This closes the DNS-rebinding gap between our pre-check and the socket connect.
 */
export function makeSafeLookup(lookupImpl?: LookupAll) {
  return function safeLookup(
    hostname: string,
    options: { all?: boolean; family?: number } | number | undefined,
    callback: (err: NodeJS.ErrnoException | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void,
  ): void {
    const run = (lookup: LookupAll) =>
      lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
        if (err) return callback(err);
        const bad = addresses.find((a) => isPrivateAddress(a.address));
        if (bad || addresses.length === 0) {
          const e = new Error(`Blocked connection to private address for ${hostname}`) as NodeJS.ErrnoException;
          e.code = "ESSRF";
          return callback(e);
        }
        if (typeof options === "object" && options?.all) return callback(null, addresses);
        return callback(null, addresses[0].address, addresses[0].family);
      });
    if (lookupImpl) run(lookupImpl);
    else import("node:dns").then(({ lookup }) => run(lookup as unknown as LookupAll));
  };
}

export const safeLookup = makeSafeLookup();
