import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { INTEGRATION_TYPES, IntegrationType } from '../integration-url';

export class CreateIntegrationDto {
  @IsIn(INTEGRATION_TYPES)
  type!: IntegrationType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @IsOptional()
  @IsUrl(
    { protocols: ['https'], require_protocol: true, require_tld: true },
    { message: 'url must be a valid https URL' },
  )
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  calendarId?: string;
}
