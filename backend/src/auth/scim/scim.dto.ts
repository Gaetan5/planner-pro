export interface ScimName {
  formatted?: string;
  familyName?: string;
  givenName?: string;
}

export interface ScimEmail {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails: ScimEmail[];
  active: boolean;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location?: string;
  };
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimPatchOperation {
  op: 'add' | 'replace' | 'remove';
  path?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

export interface ScimPatchRequest {
  schemas: string[];
  Operations: ScimPatchOperation[];
}

export interface CreateScimUserDto {
  schemas?: string[];
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails?: ScimEmail[];
  active?: boolean;
  externalId?: string;
}
