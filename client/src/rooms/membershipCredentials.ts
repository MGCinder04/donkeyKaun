const KEY = "dk-room-memberships";

interface CredentialRecord {
  current: string;
  pending: string;
}

type CredentialMap = Record<string, CredentialRecord>;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function read(): CredentialMap {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return typeof value === "object" && value !== null ? (value as CredentialMap) : {};
  } catch {
    return {};
  }
}

function write(value: CredentialMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Private browsing can disable storage. The current page still works; only a full
    // refresh cannot prove that it owns the old seat.
  }
}

export function prepareMembershipCredentials(code: string): CredentialRecord {
  const normalized = code.toUpperCase();
  const records = read();
  const previous = records[normalized];
  const prepared = {
    current: previous?.current || randomToken(),
    pending: previous?.pending || randomToken(),
  };
  records[normalized] = prepared;
  write(records);
  return prepared;
}

export function commitMembershipCredentials(code: string): void {
  const normalized = code.toUpperCase();
  const records = read();
  const previous = records[normalized];
  if (!previous) return;
  records[normalized] = { current: previous.pending, pending: randomToken() };
  write(records);
}

export function storeCreatedMembership(code: string, acceptedToken: string): void {
  const records = read();
  records[code.toUpperCase()] = { current: acceptedToken, pending: randomToken() };
  write(records);
}

export function clearMembershipCredentials(code: string): void {
  const records = read();
  delete records[code.toUpperCase()];
  write(records);
}

export function createInitialMembershipTokens(): CredentialRecord {
  return { current: randomToken(), pending: randomToken() };
}
