/**
 * Faux Prisma en mémoire pour les tests HTTP d'abus : un sous-ensemble fidèle des opérations
 * utilisées par les services d'authentification (where avec in/gt/lt/gte/lte/not/startsWith/OR/AND,
 * select, updateMany/deleteMany avec compte). Les identifiants sont générés si absents.
 */
import { randomUUID } from 'crypto';

type Row = Record<string, unknown>;

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
    const cond = expected as Record<string, unknown>;
    return Object.entries(cond).every(([op, value]) => {
      switch (op) {
        case 'in':
          return (value as unknown[]).includes(actual);
        case 'notIn':
          return !(value as unknown[]).includes(actual);
        case 'not':
          return !matchValue(actual, value);
        case 'gt':
          return actual != null && (actual as Date | number) > (value as Date | number);
        case 'gte':
          return actual != null && (actual as Date | number) >= (value as Date | number);
        case 'lt':
          return actual != null && (actual as Date | number) < (value as Date | number);
        case 'lte':
          return actual != null && (actual as Date | number) <= (value as Date | number);
        case 'startsWith':
          return typeof actual === 'string' && actual.startsWith(value as string);
        case 'equals':
          return actual === value;
        default:
          throw new Error(`Opérateur Prisma non géré par le faux : ${op}`);
      }
    });
  }
  if (expected instanceof Date && actual instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return (expected as Row[]).some((w) => matches(row, w));
    if (key === 'AND') return (expected as Row[]).every((w) => matches(row, w));
    if (key === 'NOT') return !matches(row, expected as Row);
    return matchValue(row[key], expected);
  });
}

export class FakeTable {
  rows: Row[] = [];
  constructor(
    private readonly defaults: () => Row = () => ({}),
    private readonly uniqueKeys: string[] = ['id'],
  ) {}

  private project(row: Row, select?: Record<string, boolean>): Row {
    if (!select) return { ...row };
    return Object.fromEntries(
      Object.entries(select)
        .filter(([, v]) => v)
        .map(([k]) => [k, row[k]]),
    );
  }

  async create({ data, select }: { data: Row; select?: Record<string, boolean> }) {
    const row: Row = { id: randomUUID(), createdAt: new Date(), ...this.defaults(), ...data };
    for (const key of this.uniqueKeys) {
      if (row[key] != null && this.rows.some((r) => r[key] === row[key])) {
        throw Object.assign(new Error(`Unique constraint failed on ${key}`), { code: 'P2002' });
      }
    }
    this.rows.push(row);
    return this.project(row, select);
  }

  async findUnique({ where, select }: { where: Row; select?: Record<string, boolean> }) {
    const row = this.rows.find((r) => matches(r, where));
    return row ? this.project(row, select) : null;
  }

  async findFirst({
    where,
    select,
    orderBy,
  }: {
    where?: Row;
    select?: Record<string, boolean>;
    orderBy?: Record<string, 'asc' | 'desc'>;
  } = {}) {
    const found = (await this.findMany({ where, orderBy })) as Row[];
    return found[0] ? this.project(found[0], select) : null;
  }

  async findMany({
    where,
    select,
    orderBy,
  }: {
    where?: Row;
    select?: Record<string, boolean>;
    orderBy?: Record<string, 'asc' | 'desc'>;
  } = {}) {
    let found = this.rows.filter((r) => matches(r, where));
    if (orderBy) {
      const [[key, dir]] = Object.entries(orderBy);
      found = [...found].sort((a, b) => {
        const av = a[key] as number | Date;
        const bv = b[key] as number | Date;
        return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === 'desc' ? -1 : 1);
      });
    }
    return found.map((r) => this.project(r, select));
  }

  async count({ where }: { where?: Row } = {}) {
    return this.rows.filter((r) => matches(r, where)).length;
  }

  async update({
    where,
    data,
    select,
  }: {
    where: Row;
    data: Row;
    select?: Record<string, boolean>;
  }) {
    const row = this.rows.find((r) => matches(r, where));
    if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
    Object.assign(row, data, { updatedAt: new Date() });
    return this.project(row, select);
  }

  async updateMany({ where, data }: { where?: Row; data: Row }) {
    const found = this.rows.filter((r) => matches(r, where));
    found.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
    return { count: found.length };
  }

  async upsert({ where, update, create }: { where: Row; update: Row; create: Row }) {
    const existing = this.rows.find((r) => matches(r, where));
    return existing ? this.update({ where, data: update }) : this.create({ data: create });
  }

  async delete({ where }: { where: Row }) {
    const index = this.rows.findIndex((r) => matches(r, where));
    if (index === -1) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
    const [row] = this.rows.splice(index, 1);
    return row;
  }

  async deleteMany({ where }: { where?: Row } = {}) {
    const keep = this.rows.filter((r) => !matches(r, where));
    const count = this.rows.length - keep.length;
    this.rows = keep;
    return { count };
  }
}

export class FakePrisma {
  user = new FakeTable(
    () => ({
      isSuspended: false,
      mfaEnabled: false,
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaLastUsedStep: null,
      passwordHash: null,
      firebaseUid: null,
      githubId: null,
      githubUsername: null,
      githubAccessToken: null,
      ssoUid: null,
      platformRole: null,
      provisionedByWorkspaceId: null,
      emailVerifiedAt: new Date(),
      name: null,
    }),
    ['id', 'email', 'firebaseUid', 'githubId'],
  );
  refreshToken = new FakeTable(
    () => ({ revokedAt: null, rotatedAt: null, userAgent: null }),
    ['id', 'hashedToken'],
  );
  authToken = new FakeTable(() => ({ usedAt: null }), ['id', 'tokenHash']);
  mfaRecoveryCode = new FakeTable(() => ({ usedAt: null }), ['id']);
  sSOConfiguration = new FakeTable();
  membership = new FakeTable();
  workspace = new FakeTable();
  project = new FakeTable();
  task = new FakeTable();
  taskDependency = new FakeTable();

  /** Les transactions partagent le même état : suffisant pour des tests sans concurrence. */
  async $transaction<T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
