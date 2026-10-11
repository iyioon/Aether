import argon2 from "argon2";

const PASSWORD_HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  version: 0x13
} as const;

const ARGON2ID_HASH_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

const MAX_MEMORY_COST = 262_144;
const MAX_TIME_COST = 10;
const MAX_PARALLELISM = 16;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: PASSWORD_HASH_OPTIONS.memoryCost,
    timeCost: PASSWORD_HASH_OPTIONS.timeCost,
    parallelism: PASSWORD_HASH_OPTIONS.parallelism,
    version: PASSWORD_HASH_OPTIONS.version
  });
}

export function assertSupportedPasswordHash(hash: string): void {
  const match = ARGON2ID_HASH_PATTERN.exec(hash);

  try {
    // node-argon2's PHC parser is the source of truth for whether the encoded
    // value can be verified. Keep this inside the guard because malformed PHC
    // strings throw synchronously from needsRehash.
    argon2.needsRehash(hash, PASSWORD_HASH_OPTIONS);
  } catch {
    throw invalidPasswordHashError();
  }

  if (!match) {
    throw invalidPasswordHashError();
  }

  const memoryCost = Number(match[1]);
  const timeCost = Number(match[2]);
  const parallelism = Number(match[3]);
  const saltBytes = decodedBase64Length(match[4]!);
  const hashBytes = decodedBase64Length(match[5]!);

  if (
    !Number.isSafeInteger(memoryCost) ||
    memoryCost < PASSWORD_HASH_OPTIONS.memoryCost ||
    memoryCost > MAX_MEMORY_COST ||
    !Number.isSafeInteger(timeCost) ||
    timeCost < PASSWORD_HASH_OPTIONS.timeCost ||
    timeCost > MAX_TIME_COST ||
    !Number.isSafeInteger(parallelism) ||
    parallelism < PASSWORD_HASH_OPTIONS.parallelism ||
    parallelism > MAX_PARALLELISM ||
    saltBytes < 8 ||
    saltBytes > 64 ||
    hashBytes < 16 ||
    hashBytes > 64
  ) {
    throw invalidPasswordHashError();
  }
}

export async function verifyPasswordHash(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

function decodedBase64Length(value: string): number {
  try {
    return Buffer.from(value, "base64").byteLength;
  } catch {
    return 0;
  }
}

function invalidPasswordHashError(): Error {
  return new Error(
    "AETHER_PASSWORD_HASH must be a supported Argon2id password hash."
  );
}
