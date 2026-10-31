import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Corps de `POST /auth/github/login` et `/auth/github/link` (S9). */
export class GithubLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  state!: string;
}

export const GITHUB_PURPOSES = ['login', 'link', 'repos'] as const;
export type GithubPurpose = (typeof GITHUB_PURPOSES)[number];

export class GithubAuthorizeQueryDto {
  @IsOptional()
  @IsIn(GITHUB_PURPOSES as unknown as string[])
  purpose?: GithubPurpose;
}
