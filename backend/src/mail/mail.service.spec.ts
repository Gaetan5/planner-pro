import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';
import * as nodemailer from 'nodemailer';

jest.mock('nodemailer');

describe('MailService', () => {
  let service: MailService;
  let mockSendMail: jest.Mock;

  beforeEach(async () => {
    mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-message-id' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    // Sauvegarder l'env
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASS = 'pass';
    process.env.SMTP_FROM = 'no-reply@test.com';
    process.env.FRONTEND_URL = 'http://test.com';

    const module: TestingModule = await Test.createTestingModule({
      providers: [MailService],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize transporter with SMTP config if provided', () => {
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: {
        user: 'user',
        pass: 'pass',
      },
    });
  });

  it('should send invitation email successfully', async () => {
    const result = await service.sendInvitationEmail(
      'invited@test.com',
      'My Workspace',
      'Alice',
      'secret-token',
      'MEMBER',
    );

    expect(result).toBe(true);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@test.com',
        to: 'invited@test.com',
        subject: expect.stringContaining('My Workspace'),
        html: expect.stringContaining('http://test.com/?token=secret-token'),
      }),
    );
  });

  it('should send mention email successfully', async () => {
    const result = await service.sendMentionEmail(
      'recipient@test.com',
      'Bob',
      'Finish features',
      'Hey @user please review this code',
    );

    expect(result).toBe(true);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@test.com',
        to: 'recipient@test.com',
        subject: expect.stringContaining('Bob'),
        html: expect.stringContaining('Hey @user please review this code'),
      }),
    );
  });

  describe('Fallback/Simulated mode', () => {
    let fallbackService: MailService;

    beforeEach(async () => {
      // Supprimer SMTP config
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;

      const module: TestingModule = await Test.createTestingModule({
        providers: [MailService],
      }).compile();

      fallbackService = module.get<MailService>(MailService);
    });

    it('should successfully complete sending in simulated mode without invoking nodemailer', async () => {
      jest.clearAllMocks();

      const result = await fallbackService.sendInvitationEmail(
        'invited@test.com',
        'Simulated WS',
        'Charlie',
        'simulated-token',
        'ADMIN',
      );

      expect(result).toBe(true);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });
  });
});
