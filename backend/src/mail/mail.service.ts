import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { maskEmail } from '../projects/mask-email';

/** Échappe une valeur interpolée dans un gabarit HTML (prévention de l'injection de contenu). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Environnements où le corps des e-mails peut apparaître dans la console (mode simulé). Partout
 * ailleurs, il contient des liens secrets (vérification, réinitialisation) et n'est jamais écrit
 * dans les journaux (CWE-532, P6-a).
 */
const isDevelopmentLike = () => ['development', 'test'].includes(process.env.NODE_ENV ?? '');

@Injectable()
export class MailService {
  private readonly logger = new Logger('MailService');
  private transporter: nodemailer.Transporter | null = null;
  private readonly frontendUrl: string;
  private readonly fromAddress: string;

  constructor() {
    this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    this.fromAddress = process.env.SMTP_FROM || 'no-reply@planner.pro';

    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    // Fail-closed (P6-a) : sans SMTP, la production ne pourrait ni vérifier les adresses ni
    // réinitialiser les mots de passe, et serait tentée de « simuler » en journalisant les liens.
    if (process.env.NODE_ENV === 'production' && !(host && port)) {
      throw new Error(
        'SMTP_HOST et SMTP_PORT sont obligatoires en production (envoi des liens de vérification et de réinitialisation).',
      );
    }

    if (host && port) {
      this.logger.log(`Initialisation de l'expéditeur SMTP réel sur ${host}:${port}`);
      try {
        this.transporter = nodemailer.createTransport({
          host,
          port: parseInt(port, 10),
          secure: process.env.SMTP_SECURE === 'true' || port === '465',
          auth: user && pass ? { user, pass } : undefined,
        });
      } catch (error: unknown) {
        this.logger.error(
          `Échec de création du transporteur SMTP réel : ${error instanceof Error ? error.message : String(error)}`,
        );
        if (process.env.NODE_ENV === 'production') throw error;
        this.transporter = null;
      }
    } else {
      this.logger.log(
        "Aucune configuration SMTP détectée dans l'environnement. Mode d'envoi d'emails simulé activé.",
      );
    }
  }

  /**
   * Envoie un email d'invitation à rejoindre un espace de travail.
   */
  async sendInvitationEmail(
    to: string,
    workspaceName: string,
    invitedByName: string,
    rawToken: string,
    role: string,
  ): Promise<boolean> {
    const inviteLink = `${this.frontendUrl}/?token=${rawToken}`;
    const subject = `Invitation à rejoindre l'espace de travail "${workspaceName}"`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${subject}</title>
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #0f172a;
            color: #f8fafc;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 40px auto;
            background: rgba(30, 41, 59, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 32px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(12px);
          }
          .header {
            text-align: center;
            margin-bottom: 24px;
          }
          .logo {
            font-size: 24px;
            font-weight: 800;
            color: #6366f1;
            letter-spacing: -0.05em;
          }
          .title {
            font-size: 22px;
            font-weight: 700;
            color: #ffffff;
            margin-top: 16px;
            margin-bottom: 8px;
            text-align: center;
          }
          .content {
            font-size: 16px;
            line-height: 1.6;
            color: #cbd5e1;
            margin-bottom: 32px;
          }
          .role-badge {
            display: inline-block;
            background: rgba(99, 102, 241, 0.15);
            color: #818cf8;
            border: 1px solid rgba(99, 102, 241, 0.3);
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
          }
          .btn-container {
            text-align: center;
            margin-bottom: 32px;
          }
          .btn {
            display: inline-block;
            background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
            color: #ffffff !important;
            text-decoration: none;
            padding: 14px 28px;
            font-weight: 600;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
            transition: all 0.2s ease;
          }
          .footer {
            text-align: center;
            font-size: 12px;
            color: #64748b;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 24px;
          }
          .link-fallback {
            word-break: break-all;
            font-size: 13px;
            color: #64748b;
            margin-top: 16px;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="logo">⚡ Planner Pro</span>
          </div>
          <h2 class="title">Rejoignez vos collaborateurs</h2>
          <div class="content">
            <p>Bonjour,</p>
            <p><strong>${invitedByName}</strong> vous invite chaleureusement à collaborer au sein de l'espace de travail de gestion de projet <strong>"${workspaceName}"</strong>.</p>
            <p>Vous y serez affecté avec le rôle : <span class="role-badge">${role}</span>.</p>
            <p>Planner Pro vous permettra d'organiser vos tâches, de suivre la rentabilité de vos projets avec des dashboards en temps réel et de collaborer avec votre équipe.</p>
          </div>
          <div class="btn-container">
            <a href="${inviteLink}" class="btn">Accepter l'Invitation</a>
          </div>
          <div class="link-fallback">
            Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :<br>
            <a href="${inviteLink}" style="color: #818cf8; text-decoration: none;">${inviteLink}</a>
          </div>
          <div class="footer">
            Cet email a été envoyé automatiquement par Planner Pro. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité.
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `Bonjour,\n\n${invitedByName} vous invite à rejoindre l'espace de travail "${workspaceName}" sur Planner Pro avec le rôle ${role}.\n\nPour accepter cette invitation et configurer votre compte, cliquez sur le lien suivant :\n${inviteLink}\n\nL'équipe Planner Pro.`;

    return this.sendMail(to, subject, text, html);
  }

  /**
   * Envoie un email d'alerte lorsqu'un utilisateur est mentionné dans un commentaire.
   */
  async sendMentionEmail(
    to: string,
    senderName: string,
    taskTitle: string,
    commentSnippet: string,
  ): Promise<boolean> {
    const subject = `${senderName} vous a mentionné sur la tâche "${taskTitle}"`;
    const actionLink = `${this.frontendUrl}/?activeTab=kanban`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${subject}</title>
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #0f172a;
            color: #f8fafc;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 40px auto;
            background: rgba(30, 41, 59, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 32px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(12px);
          }
          .header {
            text-align: center;
            margin-bottom: 24px;
          }
          .logo {
            font-size: 24px;
            font-weight: 800;
            color: #6366f1;
            letter-spacing: -0.05em;
          }
          .title {
            font-size: 20px;
            font-weight: 700;
            color: #ffffff;
            margin-top: 16px;
            margin-bottom: 16px;
            text-align: center;
          }
          .content {
            font-size: 16px;
            line-height: 1.6;
            color: #cbd5e1;
            margin-bottom: 24px;
          }
          .quote-container {
            background: rgba(15, 23, 42, 0.6);
            border-left: 4px solid #6366f1;
            padding: 16px;
            border-radius: 0 8px 8px 0;
            margin-bottom: 32px;
            font-style: italic;
            color: #e2e8f0;
          }
          .btn-container {
            text-align: center;
            margin-bottom: 32px;
          }
          .btn {
            display: inline-block;
            background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
            color: #ffffff !important;
            text-decoration: none;
            padding: 12px 24px;
            font-weight: 600;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
          }
          .footer {
            text-align: center;
            font-size: 12px;
            color: #64748b;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 24px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="logo">⚡ Planner Pro</span>
          </div>
          <h2 class="title">Nouvelle mention</h2>
          <div class="content">
            <p>Bonjour,</p>
            <p><strong>${senderName}</strong> vous a mentionné dans un commentaire sur la tâche <strong>"${taskTitle}"</strong> :</p>
          </div>
          <div class="quote-container">
            "${commentSnippet}"
          </div>
          <div class="btn-container">
            <a href="${actionLink}" class="btn">Répondre sur le Kanban</a>
          </div>
          <div class="footer">
            Vous recevez cet email car vous avez été mentionné par un collaborateur dans Planner Pro. Vous pouvez ajuster vos préférences de notification dans vos paramètres.
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `Bonjour,\n\n${senderName} vous a mentionné dans un commentaire sur la tâche "${taskTitle}" :\n\n"${commentSnippet}"\n\nPour y répondre, rendez-vous sur votre tableau Kanban :\n${actionLink}\n\nL'équipe Planner Pro.`;

    return this.sendMail(to, subject, text, html);
  }

  /**
   * E-mail de vérification d'adresse (P6) : lien à usage unique valable 24 h.
   */
  async sendEmailVerificationEmail(to: string, rawToken: string): Promise<boolean> {
    const link = `${this.frontendUrl}/?verify=${encodeURIComponent(rawToken)}`;
    const subject = 'Confirmez votre adresse e-mail Planner-Pro';
    const html = this.simpleMailHtml(
      subject,
      `<p>Bonjour,</p><p>Confirmez votre adresse e-mail pour activer votre compte Planner-Pro. Ce lien est valable 24 heures.</p>`,
      'Confirmer mon adresse',
      link,
    );
    const text = `Bonjour,\n\nConfirmez votre adresse e-mail pour activer votre compte Planner-Pro (lien valable 24 heures) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez ce message.`;
    return this.sendMail(to, subject, text, html);
  }

  /**
   * E-mail de réinitialisation de mot de passe (P6) : lien à usage unique valable 30 minutes.
   */
  async sendPasswordResetEmail(to: string, rawToken: string): Promise<boolean> {
    const link = `${this.frontendUrl}/?reset=${encodeURIComponent(rawToken)}`;
    const subject = 'Réinitialisation de votre mot de passe Planner-Pro';
    const html = this.simpleMailHtml(
      subject,
      '<p>Une réinitialisation de mot de passe a été demandée pour votre compte. Ce lien est valable 30 minutes et ne peut être utilisé qu’une fois. Toutes vos sessions seront fermées après le changement.</p>',
      'Choisir un nouveau mot de passe',
      link,
    );
    const text = `Une réinitialisation de mot de passe a été demandée pour votre compte Planner-Pro.\n\nLien (valable 30 minutes, usage unique) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`;
    return this.sendMail(to, subject, text, html);
  }

  /**
   * Notification envoyée quand quelqu'un tente de s'inscrire avec une adresse déjà utilisée :
   * la réponse de l'API reste identique (pas d'énumération de comptes, S27).
   */
  async sendAccountExistsEmail(to: string): Promise<boolean> {
    const link = `${this.frontendUrl}/`;
    const subject = 'Une inscription a été tentée avec votre adresse e-mail';
    const html = this.simpleMailHtml(
      subject,
      '<p>Quelqu’un a tenté de créer un compte Planner-Pro avec cette adresse, qui possède déjà un compte. Si c’est vous, connectez-vous ou utilisez « Mot de passe oublié ». Sinon, ignorez ce message.</p>',
      'Aller à Planner-Pro',
      link,
    );
    const text = `Quelqu'un a tenté de créer un compte Planner-Pro avec cette adresse, qui possède déjà un compte.\nSi c'est vous, connectez-vous ou utilisez « Mot de passe oublié » : ${link}\nSinon, ignorez ce message.`;
    return this.sendMail(to, subject, text, html);
  }

  private simpleMailHtml(title: string, bodyHtml: string, buttonLabel: string, link: string) {
    const safeLink = escapeHtml(link);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#f8fafc;padding:32px">
<div style="max-width:560px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px">
<h2 style="margin-top:0">${escapeHtml(title)}</h2>${bodyHtml}
<p style="text-align:center;margin:28px 0"><a href="${safeLink}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">${escapeHtml(buttonLabel)}</a></p>
<p style="font-size:12px;opacity:.7">Si le bouton ne fonctionne pas, copiez ce lien : ${safeLink}</p>
</div></body></html>`;
  }

  /**
   * Méthode générique d'envoi d'email.
   */
  private async sendMail(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): Promise<boolean> {
    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: this.fromAddress,
          to,
          subject,
          text,
          html,
        });
        this.logger.log(
          `Email envoyé à ${this.describeRecipient(to)}. MessageId: ${info.messageId}`,
        );
        return true;
      } catch (error: unknown) {
        // Jamais l'objet d'erreur complet ni le corps : seulement le message
        this.logger.error(
          `Échec de l'envoi de l'email à ${this.describeRecipient(to)} (« ${subject} ») : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // Repli « simulé » réservé au développement (le corps contient des liens secrets)
        if (isDevelopmentLike()) this.logSimulatedEmail(to, subject, text);
        return false;
      }
    }

    if (isDevelopmentLike()) {
      this.logSimulatedEmail(to, subject, text);
      return true;
    }
    this.logger.warn(
      `Aucun SMTP configuré : email « ${subject} » non envoyé à ${this.describeRecipient(to)}.`,
    );
    return false;
  }

  /** Destinataire journalisé : en clair en développement, masqué sinon. */
  private describeRecipient(to: string): string {
    return isDevelopmentLike() ? to : maskEmail(to);
  }

  /**
   * Log d'email simulé dans la console avec un formatage lisible pour le développement local.
   */
  private logSimulatedEmail(to: string, subject: string, text: string) {
    this.logger.log(`
┌────────────────────────────────────────────────────────────────────────┐
│ 📧 EMAIL SIMULÉ ENVOYÉ (MODE DÉVELOPPEMENT)                            │
├────────────────────────────────────────────────────────────────────────┤
│ Expéditeur : ${this.fromAddress}                                      
│ Destinataire : ${to}                                                   
│ Objet : ${subject}                                                     
├────────────────────────────────────────────────────────────────────────┤
│ Message :                                                              
│                                                                        
${text
  .split('\n')
  .map((line) => `│ ${line}`)
  .join('\n')}
│                                                                        
└────────────────────────────────────────────────────────────────────────┘
`);
  }
}
