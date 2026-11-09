import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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

/**
 * Format `propriétaire/dépôt` d'un dépôt GitHub (nom d'utilisateur ou d'organisation, puis dépôt).
 * Les noms `.` et `..` sont refusés : ils ne sont pas des dépôts et `encodeURIComponent` ne les
 * neutralise pas dans un chemin.
 */
export const GITHUB_REPO_FULL_NAME = /^[A-Za-z0-9-]{1,39}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

/** Corps de `POST /auth/github/sync` : le dépôt est dans le corps, jamais dans le chemin (P9-R). */
export class GithubSyncDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  projectId!: string;

  @IsString()
  @Matches(GITHUB_REPO_FULL_NAME)
  repoFullName!: string;
}
