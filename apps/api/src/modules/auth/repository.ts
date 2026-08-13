import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../platform/db.js';
import type { TokenPurposeValue } from './tokens.js';

export type AuthUser = {
  id: string;
  personId: string;
  passwordHash: string | null;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  mfaEnabled: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  person: { id: string; firstName: string; lastName: string };
};

/**
 * Email lives on `persons`, not `users`, so authentication looks the account up through
 * the person. Deleted persons are excluded: a soft-deleted member must not be able to
 * log in.
 */
export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const user = await prisma.user.findFirst({
    where: { person: { email, deletedAt: null } },
    select: {
      id: true,
      personId: true,
      passwordHash: true,
      status: true,
      mfaEnabled: true,
      failedAttempts: true,
      lockedUntil: true,
      person: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return user;
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  return prisma.user.findFirst({
    where: { id, person: { deletedAt: null } },
    select: {
      id: true,
      personId: true,
      passwordHash: true,
      status: true,
      mfaEnabled: true,
      failedAttempts: true,
      lockedUntil: true,
      person: { select: { id: true, firstName: true, lastName: true } },
    },
  });
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
