import { BadRequestException } from '@nestjs/common';
import { AppValidationPipe } from '../../../src/common/app-validation.pipe';
import { AttachmentDto } from '../../../src/projects/dto/attachment.dto';
import { CreateCommentDto } from '../../../src/projects/dto/create-comment.dto';

describe('S20 : validation des pièces jointes (400)', () => {
  const pipe = new AppValidationPipe();
  const attachment = (over: Record<string, unknown> = {}) => ({
    fileName: 'plan.png',
    fileUrl: 'https://files.example.com/plan.png',
    fileType: 'image/png',
    fileSize: 1024,
    ...over,
  });
  const asAttachment = (v: object) => pipe.transform(v, { type: 'body', metatype: AttachmentDto });
  const asComment = (v: object) => pipe.transform(v, { type: 'body', metatype: CreateCommentDto });

  it('accepte https: et data: image/PDF', async () => {
    await expect(asAttachment(attachment())).resolves.toBeDefined();
    await expect(
      asAttachment(attachment({ fileUrl: 'data:image/png;base64,iVBORw0KGgo=' })),
    ).resolves.toBeDefined();
    await expect(
      asAttachment(attachment({ fileUrl: 'data:application/pdf;base64,JVBERi0xLjQ=' })),
    ).resolves.toBeDefined();
  });

  it.each([
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'http://files.example.com/a.png',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png,<script>',
    'data:image/png;base64,AAAA ',
    'data:image/png;base64,AAAA"',
    'data:image/png;base64,AAAA"onerror="x',
    'data:image/png;base64,AAAA\n',
    'data:image/png;base64,AAAA\n<script>',
    'blob:https://x.example/1',
    'file:///etc/passwd',
    'https://user:pass@files.example.com/a.png',
  ])('rejette fileUrl %s', async (fileUrl) => {
    await expect(asAttachment(attachment({ fileUrl }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['nom avec /', { fileName: '../../etc/passwd' }],
    ['nom avec \\', { fileName: 'a\\b.png' }],
    ['nom trop long', { fileName: 'a'.repeat(256) }],
    ['nom vide', { fileName: '' }],
    ['taille négative', { fileSize: -1 }],
    ['taille excessive', { fileSize: 11 * 1024 * 1024 }],
    ['taille non entière', { fileSize: 1.5 }],
    ['champ inconnu', { uploadedById: 'autre' }],
  ])('rejette : %s', async (_l, over) => {
    await expect(asAttachment(attachment(over))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un commentaire valide la liste imbriquée et la limite à 10 éléments', async () => {
    await expect(asComment({ content: 'x', attachments: [attachment()] })).resolves.toBeDefined();
    await expect(
      asComment({ content: 'x', attachments: [attachment({ fileUrl: 'javascript:alert(1)' })] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      asComment({ content: 'x', attachments: Array.from({ length: 11 }, () => attachment()) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
