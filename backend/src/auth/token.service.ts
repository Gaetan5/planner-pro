import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hkdfSync, randomUUID } from 'crypto';

/** Types de jetons émis par la plateforme (claim `typ`). */
export const ACCESS_TOKEN_TYPE = 'access';
export const MFA_TICKET_TYPE = 'mfa_ticket';
export const MFA_TICKET_AUDIENCE = 'mfa-challenge';
export const MFA_TICKET_TTL_SECONDS = 300;

export interface AccessTokenClaims {
  sub: string;
  email?: string;
  name?: string | null;
  impersonatedBy?: string;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  typ: typeof ACCESS_TOKEN_TYPE;
}

export interface VerifiedMfaTicket {
  sub: string;
  jti: string;
}

/**
 * Point unique d'émission et de vérification des jetons (S3).
 * Le jeton d'accès et le ticket MFA sont distingués par le claim `typ` et signés avec des clés
 * différentes : un ticket MFA ne peut jamais être accepté comme jeton d'accès.
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  private getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET n'est pas défini.");
    }
    return secret;
  }

  /**
   * Clé du ticket MFA dérivée de JWT_SECRET (HKDF-SHA256, label dédié) : distincte de la clé
   * des jetons d'accès sans imposer une nouvelle variable d'environnement.
   */
  private getMfaTicketKey(): Buffer {
    return Buffer.from(
      hkdfSync('sha256', this.getJwtSecret(), 'planner-pro', 'planner-pro:mfa-ticket:v1', 32),
    );
  }

  signAccessToken(claims: AccessTokenClaims): string {
    return this.jwtService.sign({ ...claims, typ: ACCESS_TOKEN_TYPE });
  }

  /**
   * Vérifie un jeton d'accès (HTTP et WebSocket). Rejette tout jeton sans `typ: 'access'`,
   * en particulier les tickets MFA et les jetons émis avant ce correctif.
   */
  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.getJwtSecret(),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException("Token d'authentification invalide ou expiré.");
    }

    if (
      payload.typ !== ACCESS_TOKEN_TYPE ||
      'mfaPending' in payload ||
      typeof payload.sub !== 'string' ||
      !payload.sub
    ) {
      throw new UnauthorizedException("Token d'authentification invalide ou expiré.");
    }

    return payload as unknown as VerifiedAccessToken;
  }

  /**
   * Émet un ticket MFA de 5 minutes, avec un identifiant unique (`jti`) pour le suivi à usage unique.
   */
  signMfaTicket(userId: string): { ticket: string; jti: string } {
    const jti = randomUUID();
    const ticket = this.jwtService.sign(
      { sub: userId, typ: MFA_TICKET_TYPE, jti },
      {
        secret: this.getMfaTicketKey(),
        audience: MFA_TICKET_AUDIENCE,
        expiresIn: MFA_TICKET_TTL_SECONDS,
      },
    );
    return { ticket, jti };
  }

  async verifyMfaTicket(ticket: string): Promise<VerifiedMfaTicket> {
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwtService.verifyAsync(ticket, {
        secret: this.getMfaTicketKey(),
        audience: MFA_TICKET_AUDIENCE,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException(
        'Session de validation MFA expirée. Veuillez vous reconnecter.',
      );
    }

    if (
      payload.typ !== MFA_TICKET_TYPE ||
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string'
    ) {
      throw new UnauthorizedException('Jeton de challenge MFA invalide.');
    }

    return { sub: payload.sub, jti: payload.jti };
  }
}
