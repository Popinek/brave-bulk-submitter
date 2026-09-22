import { isIP } from "node:net";

function normalizeHostname(hostname) {
  return String(hostname).toLowerCase().replace(/^\[|\]$/g, "");
}

function ipv4Octets(address) {
  return address.split(".").map((part) => Number(part));
}

function isNonPublicIpv4Octets([a, b, c, d]) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 ||
    [a, b, c, d].some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  );
}

function isNonPublicIpv4(address) {
  return isNonPublicIpv4Octets(ipv4Octets(address));
}

function ipv6ToBigInt(address) {
  let input = address.toLowerCase();

  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const octets = ipv4Octets(input.slice(lastColon + 1));
    const [a, b, c, d] = octets;
    input = `${input.slice(0, lastColon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = input.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;

  const parts = halves.length === 2
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;

  if (parts.length !== 8) return null;

  return parts.reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function isNonPublicIpv6(address) {
  const value = ipv6ToBigInt(address);
  if (value === null) return true;

  if (value === 0n || value === 1n) return true;
  if ((value >> 121n) === 0x7en) return true; // fc00::/7 unique-local
  if ((value >> 118n) === 0x3fan) return true; // fe80::/10 link-local
  if ((value >> 120n) === 0xffn) return true; // ff00::/8 multicast
  if ((value >> 96n) === 0x20010db8n) return true; // 2001:db8::/32 documentation

  // IPv4-mapped IPv6, e.g. ::ffff:192.168.1.1.
  if ((value >> 32n) === 0xffffn) {
    const ipv4 = Number(value & 0xffffffffn);
    return isNonPublicIpv4Octets([
      (ipv4 >>> 24) & 255,
      (ipv4 >>> 16) & 255,
      (ipv4 >>> 8) & 255,
      ipv4 & 255
    ]);
  }

  return false;
}

function nonPublicReason(hostname) {
  const host = normalizeHostname(hostname);

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "home.arpa" ||
    host.endsWith(".home.arpa")
  ) {
    return "local hostname";
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 && isNonPublicIpv4(host)) return "non-public IPv4 address";
  if (ipVersion === 6 && isNonPublicIpv6(host)) return "non-public IPv6 address";

  return null;
}

export function normalizeUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("URL is empty");

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("URL is not valid");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }

  const privateReason = nonPublicReason(parsed.hostname);
  if (privateReason) {
    throw new Error(`Private, local, or special-use URLs are not allowed (${privateReason})`);
  }

  parsed.hash = "";
  const isBareRoot = (parsed.pathname === "/" || parsed.pathname === "") && !parsed.search;
  const normalized = parsed.toString();
  return isBareRoot ? parsed.origin : normalized;
}

export function parseBulkInput(input) {
  const tokens = String(input ?? "")
    .split(/\r?\n/)
    .flatMap((line) => line.split(","))
    .map((token) => token.trim())
    .filter(Boolean);
  const sites = [];
  const errors = [];
  const seen = new Set();

  for (const token of tokens) {
    try {
      const url = normalizeUrl(token);
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sites.push(url);
    } catch (error) {
      errors.push({ input: token, message: error.message });
    }
  }

  return { sites, errors };
}

export function createSiteRecords(urls) {
  return urls.map((url, index) => ({
    id: `${index + 1}-${Buffer.from(url).toString("base64url").slice(0, 10)}`,
    url,
    status: "ready",
    attempts: 0,
    submittedAt: null,
    lastError: null
  }));
}
