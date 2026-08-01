import dns from "node:dns/promises";
import net from "node:net";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";

const FORBIDDEN_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const METADATA_IPS = new Set(["169.254.169.254"]);

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((sum, part) => (sum << 8) + Number(part), 0) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsText] = cidr.split("/");
  if (!range || !bitsText) return false;
  const bits = Number(bitsText);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToNumber(ip) & mask) === (ipv4ToNumber(range) & mask);
}

function isPrivateIpv4(ip: string): boolean {
  return [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "224.0.0.0/4",
    "240.0.0.0/4",
  ].some((cidr) => ipv4InCidr(ip, cidr));
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:")
  );
}

export function isForbiddenAddress(address: string): boolean {
  if (METADATA_IPS.has(address)) return true;
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

export async function assertSafeTargetUrl(
  rawUrl: string,
  options: { allowPrivateNetworkTargets: boolean; requireHttps: boolean },
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError({
      code: ERROR_CODES.UNSAFE_TARGET,
      message: "Target URL is invalid.",
      statusCode: 400,
      fatal: true,
    });
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throwUnsafe("Only http and https targets are supported.");
  }
  if (url.username || url.password) {
    throwUnsafe("URLs containing credentials are not allowed.");
  }
  if (options.requireHttps && url.protocol !== "https:" && process.env.NODE_ENV !== "development") {
    throwUnsafe("HTTPS is required outside local development.");
  }

  const hostname = url.hostname.toLowerCase();
  if (FORBIDDEN_HOSTNAMES.has(hostname) && !options.allowPrivateNetworkTargets) {
    throwUnsafe("Localhost targets are disabled by default.");
  }

  if (net.isIP(hostname)) {
    if (!options.allowPrivateNetworkTargets && isForbiddenAddress(hostname)) {
      throwUnsafe("Private, local, metadata, and reserved IP targets are disabled by default.");
    }
    return url;
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length) {
      throw new Error("No DNS records returned.");
    }
    if (
      !options.allowPrivateNetworkTargets &&
      addresses.some((record) => isForbiddenAddress(record.address))
    ) {
      throwUnsafe("DNS resolves to a private, local, metadata, or reserved address.");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: ERROR_CODES.DNS_RESOLUTION_FAILURE,
      message: "Could not safely resolve target hostname.",
      statusCode: 400,
      details: error instanceof Error ? error.message : String(error),
      fatal: true,
    });
  }

  return url;
}

function throwUnsafe(message: string): never {
  throw new AppError({
    code: ERROR_CODES.UNSAFE_TARGET,
    message,
    statusCode: 400,
    fatal: true,
  });
}
