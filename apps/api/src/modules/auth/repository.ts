import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../platform/db.js';
import type { TokenPurposeValue } from './tokens.js';

export type AuthUser = {
  id: string;
  personId: string;
  passwordHash: string | null;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaLastUsedStep: bigint | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  person: { id: string; firstName: string; lastName: string; email: string | null };
};

const AUTH_USER_SELECT = {
  id: true,
  personId: true,
  passwordHash: true,
  status: true,
  mfaEnabled: true,
  mfaSecret: true,
  mfaLastUsedStep: true,
  failedAttempts: true,
  lockedUntil: true,
  person: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

/**
 * Email lives on `persons`, not `users`, so authentication looks the account up through
 * the person. Deleted persons are excluded: a soft-deleted member must not be able to
 * log in.
 */
export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  return prisma.user.findFirst({
    where: { person: { email, deletedAt: null } },
    select: AUTH_USER_SELECT,
  });
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  return prisma.user.findFirst({
    where: { id, person: { deletedAt: null } },
    select: AUTH_USER_SELECT,
  });
}

/** Stores a pending secret. MFA stays OFF until a code proves the app is set up. */
export async function stageMfaSecret(userId: string, secret: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { mfaSecret: secret, mfaEnabled: false, mfaLastUsedStep: null },
  });
}

/**
 * Records a consumed TOTP step, and enables MFA if this was the confirming code.
 *
 * The `mfaLastUsedStep: { lt: step }` guard is what makes replay impossible: two requests
 * carrying the same code both verify, but only one updates a row, and the loser is
 * rejected by its caller. OR null covers the first use, where no step is recorded yet.
 */
export async function consumeMfaStep(
  userId: string,
  step: bigint,
  options: { enable?: boolean } = {},
): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
    },
    data: { mfaLastUsedStep: step, ...(options.enable ? { mfaEnabled: true } : {}) },
  });
  return result.count === 1;
}

export async function disableMfa(userId: string): Promise<void> {
  // Recovery codes are meaningless without the factor they recover, and leaving them
  // would let a stale printout re-enter an account after MFA was deliberately removed.
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaLastUsedStep: null },
    }),
  ]);
}

/** Replaces the whole set: issuing new codes invalidates every previous one. */
export async function replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
  ]);
}

/**
 * Redeems a recovery code, returning false if it was unknown or already used.
 *
 * The `usedAt: null` inside the update is what makes redemption single use under
 * concurrency: two requests carrying the same code both find the row, and only one
 * updates it.
 */
export async function redeemRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
  const result = await prisma.mfaRecoveryCode.updateMany({
    where: { userId, codeHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  return prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
}

export async function recordFailedAttempt(
  userId: string,
  lockedUntil: Date | null,
): Promise<number> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      failedAttempts: { increment: 1 },
      ...(lockedUntil ? { lockedUntil } : {}),
    },
    select: { failedAttempts: true },
  });
  return user.failedAttempts;
}

export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}

export async function createToken(input: {
  userId: string;
  purpose: TokenPurposeValue;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.userToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    },
  });
}

export type ConsumableToken = {
  id: string;
  userId: string;
  purpose: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export async function findTokenByHash(tokenHash: string): Promise<ConsumableToken | null> {
  return prisma.userToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });
}

/**
 * Marks the token used and sets the new password in ONE transaction, and only if the
 * token is still unconsumed.
 *
 * The `consumedAt: null` in the where clause is what makes single use real: two
 * simultaneous requests with the same token both pass the earlier validity read, but
 * only one matches here. The loser updates zero rows and is rejected. Checking then
 * updating without this would let a leaked token be used twice by racing it.
 */
export async function consumeTokenAndSetPassword(input: {
  tokenId: string;
  userId: string;
  passwordHash: string;
  activateUser: boolean;
  consent?: { policyVersion: string; sourceIp: string | null; personId: string };
}): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const consumed = await tx.userToken.updateMany({
        where: { id: input.tokenId, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      if (consumed.count !== 1) {
        throw new TokenAlreadyConsumedError();
      }

      await tx.user.update({
        where: { id: input.userId },
        data: {
          passwordHash: input.passwordHash,
          failedAttempts: 0,
          lockedUntil: null,
          ...(input.activateUser ? { status: 'ACTIVE' as const } : {}),
        },
      });

      if (input.consent) {
        // Written in the same transaction as the account it justifies: a consent record
        // that can fail independently is not a demonstrable lawful basis (DPPA 2019).
        await tx.consent.create({
          data: {
            personId: input.consent.personId,
            consentType: 'DATA_PROCESSING',
            policyVersion: input.consent.policyVersion,
            grantedAt: new Date(),
            sourceIp: input.consent.sourceIp,
          },
        });
      }
    });
    return true;
  } catch (error) {
    if (error instanceof TokenAlreadyConsumedError) return false;
    throw error;
  }
}

class TokenAlreadyConsumedError extends Error {}
