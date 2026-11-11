import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { isSafeAttachmentUrl } from '../attachment-url';

/** `https:` ou `data:` d'un type MIME en liste blanche (S20). */
function IsSafeAttachmentUrl(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isSafeAttachmentUrl',
      target: target.constructor,
      propertyName,
      options: {
        message: 'fileUrl must be an https URL or a data URL of an allowed type',
        ...options,
      },
      validator: { validate: (value: unknown) => isSafeAttachmentUrl(value) },
    });
}

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_COMMENT = 10;

export class AttachmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^/\\\u0000-\u001f]+$/, {
    message: 'fileName must not contain / \\ or control characters',
  })
  fileName!: string;

  @IsSafeAttachmentUrl()
  @MaxLength(65_000)
  fileUrl!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(127)
  fileType!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_ATTACHMENT_SIZE)
  fileSize!: number;
}
