import { createHash } from 'node:crypto';
import { PermissionDeniedError, PermissionResolutionError } from '../errors.js';
import { canonicalize } from '../identity/index.js';
import { COLLECTIONS, MYCELIUM_NAMESPACE, ROLE_PERMISSION_SETS, type ProtocolRole } from './constants.js';

export type RepoAction = 'create' | 'update' | 'delete';

export interface RepoPermission {
  resource: 'repo';
  collection: string;
  actions: ReadonlySet<RepoAction>;
}

export interface IncludePermission {
  resource: 'include';
  permissionSet: string;
  audience?: string;
}

export type ParsedPermission = RepoPermission | IncludePermission;

export interface PermissionSetDocument {
  id: string;
  permissions: ReadonlyArray<{
    type: 'permission';
    resource: 'repo';
    collection: ReadonlyArray<string>;
    action?: ReadonlyArray<RepoAction>;
  }>;
  title?: string;
  detail?: string;
}

export interface PermissionSetResolver {
  resolve(permissionSet: string): Promise<PermissionSetDocument | null>;
}

export interface PermissionCacheEntry {
  document: PermissionSetDocument;
  staleAt: number;
  expiresAt: number;
}

export interface ResolvedPermissions {
  permissions: ReadonlyArray<RepoPermission>;
  includes: ReadonlyArray<string>;
  resolvedAt: number;
  snapshotHash: string;
}

const REPO_ACTIONS: ReadonlySet<RepoAction> = new Set(['create', 'update', 'delete']);

function assertNsid(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z0-9][a-z0-9.-]*\.[a-z0-9][a-z0-9.-]*(?:\.[a-z0-9][a-z0-9.-]*)*$/.test(value)) {
    throw new PermissionResolutionError(`Invalid ${label} NSID "${value}"`);
  }
}

function parseQuery(query: string): URLSearchParams {
  if (!query) return new URLSearchParams();
  if (/\s/.test(query)) {
    throw new PermissionResolutionError('Permission scope contains whitespace');
  }
  return new URLSearchParams(query);
}

function parseActions(params: URLSearchParams): ReadonlySet<RepoAction> {
  const values = params.getAll('action');
  if (values.length === 0) return REPO_ACTIONS;
  const actions = new Set<RepoAction>();
  for (const value of values) {
    if (!REPO_ACTIONS.has(value as RepoAction)) {
      throw new PermissionResolutionError(`Unknown repo action "${value}"`);
    }
    actions.add(value as RepoAction);
  }
  return actions;
}

function assertNoUnexpectedParams(
  params: URLSearchParams,
  allowed: ReadonlySet<string>,
): void {
  for (const key of params.keys()) {
    if (!allowed.has(key)) {
      throw new PermissionResolutionError(`Unknown permission parameter "${key}"`);
    }
  }
}

export function parsePermissionScope(scope: string): ParsedPermission {
  if (!scope || /\s/.test(scope)) {
    throw new PermissionResolutionError('Permission scope must be non-empty ASCII without whitespace');
  }

  const question = scope.indexOf('?');
  const base = question === -1 ? scope : scope.slice(0, question);
  const query = question === -1 ? '' : scope.slice(question + 1);
  const colon = base.indexOf(':');
  const resource = colon === -1 ? base : base.slice(0, colon);
  const positional = colon === -1 ? undefined : decodeURIComponent(base.slice(colon + 1));
  const params = parseQuery(query);

  if (resource === 'include') {
    if (!positional || params.size > 0) {
      throw new PermissionResolutionError('include scopes require only a permission-set NSID');
    }
    assertNsid(positional, 'permission-set');
    return { resource: 'include', permissionSet: positional };
  }

  if (resource !== 'repo' || !positional) {
    throw new PermissionResolutionError(`Unsupported permission resource "${resource}"`);
  }
  assertNsid(positional === '*' ? 'a.b.c' : positional, 'collection');
  if (positional !== '*' && positional.includes('*')) {
    throw new PermissionResolutionError('Partial collection wildcards are not allowed');
  }
  assertNoUnexpectedParams(params, new Set(['action']));
  return {
    resource: 'repo',
    collection: positional,
    actions: parseActions(params),
  };
}

function namespaceGroup(nsid: string): string {
  return nsid.split('.').slice(0, 3).join('.');
}

function assertPermissionSetDocument(document: PermissionSetDocument): void {
  assertNsid(document.id, 'permission-set');
  if (!document.id.startsWith(`${MYCELIUM_NAMESPACE}.`)) {
    throw new PermissionResolutionError(
      `Permission set "${document.id}" is outside the Mycelium namespace`,
      document.id,
    );
  }

  const authority = namespaceGroup(document.id);
  for (const permission of document.permissions) {
    if (permission.type !== 'permission' || permission.resource !== 'repo') {
      throw new PermissionResolutionError(
        `Permission set "${document.id}" contains an unsupported resource`,
        document.id,
      );
    }
    if (permission.collection.length === 0) {
      throw new PermissionResolutionError(
        `Permission set "${document.id}" contains an empty collection list`,
        document.id,
      );
    }
    for (const collection of permission.collection) {
      assertNsid(collection, 'collection');
      if (collection.includes('*') || namespaceGroup(collection) !== authority) {
        throw new PermissionResolutionError(
          `Permission set "${document.id}" is not authoritative for "${collection}"`,
          document.id,
        );
      }
    }
    for (const action of permission.action ?? REPO_ACTIONS) {
      if (!REPO_ACTIONS.has(action)) {
        throw new PermissionResolutionError(
          `Permission set "${document.id}" contains unknown action "${action}"`,
          document.id,
        );
      }
    }
  }
}

export class PermissionSetCache {
  private readonly entries = new Map<string, PermissionCacheEntry>();

  constructor(
    private readonly resolver: PermissionSetResolver,
    private readonly staleLifetimeMs = 24 * 60 * 60 * 1000,
    private readonly expirationLifetimeMs = 90 * 24 * 60 * 60 * 1000,
  ) {}

  async get(permissionSet: string, now = Date.now()): Promise<PermissionSetDocument> {
    const cached = this.entries.get(permissionSet);
    if (cached && now < cached.staleAt) return cached.document;

    try {
      const resolved = await this.resolver.resolve(permissionSet);
      if (!resolved) {
        throw new PermissionResolutionError(
          `Permission set "${permissionSet}" could not be resolved`,
          permissionSet,
        );
      }
      assertPermissionSetDocument(resolved);
      this.entries.set(permissionSet, {
        document: resolved,
        staleAt: now + this.staleLifetimeMs,
        expiresAt: now + this.expirationLifetimeMs,
      });
      return resolved;
    } catch (error) {
      if (cached && now < cached.expiresAt) return cached.document;
      if (error instanceof PermissionResolutionError) throw error;
      throw new PermissionResolutionError(
        `Permission set "${permissionSet}" resolution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        permissionSet,
      );
    }
  }
}

export async function resolvePermissionScopes(
  scopes: ReadonlyArray<string>,
  cache: PermissionSetCache,
  now = Date.now(),
): Promise<ResolvedPermissions> {
  const permissions: RepoPermission[] = [];
  const includes: string[] = [];

  for (const scope of scopes) {
    const parsed = parsePermissionScope(scope);
    if (parsed.resource === 'repo') {
      permissions.push(parsed);
      continue;
    }

    includes.push(parsed.permissionSet);
    const set = await cache.get(parsed.permissionSet, now);
    for (const permission of set.permissions) {
      permissions.push({
        resource: 'repo',
        collection: permission.collection[0] as string,
        actions: new Set(permission.action ?? REPO_ACTIONS),
      });
      for (const collection of permission.collection.slice(1)) {
        permissions.push({
          resource: 'repo',
          collection,
          actions: new Set(permission.action ?? REPO_ACTIONS),
        });
      }
    }
  }

  const deduped = new Map<string, RepoPermission>();
  for (const permission of permissions) {
    const key = `${permission.collection}:${[...permission.actions].sort().join(',')}`;
    deduped.set(key, permission);
  }
  const normalized = [...deduped.values()].sort((a, b) => a.collection.localeCompare(b.collection));
  return {
    permissions: normalized,
    includes: [...new Set(includes)].sort(),
    resolvedAt: now,
    snapshotHash: createHash('sha256').update(canonicalize({
      permissions: normalized.map((permission) => ({
        collection: permission.collection,
        actions: [...permission.actions].sort(),
      })),
      includes: [...new Set(includes)].sort(),
    })).digest('hex'),
  };
}

export function isPermissionAllowed(
  permissions: ReadonlyArray<RepoPermission>,
  collection: string,
  action: RepoAction,
): boolean {
  return permissions.some((permission) =>
    (permission.collection === collection || permission.collection === '*') &&
    permission.actions.has(action),
  );
}

export function assertPermissionAllowed(
  permissions: ReadonlyArray<RepoPermission>,
  collection: string,
  action: RepoAction,
): void {
  if (!isPermissionAllowed(permissions, collection, action)) {
    throw new PermissionDeniedError(collection, action);
  }
}

export function rolePermissionSet(role: ProtocolRole): PermissionSetDocument {
  const common = (collection: string) => ({
    type: 'permission' as const,
    resource: 'repo' as const,
    collection: [collection],
    action: ['create'] as const,
  });

  const permissionsByRole: Record<ProtocolRole, PermissionSetDocument['permissions']> = {
    requester: [
      common(COLLECTIONS.taskOffer),
      common(COLLECTIONS.taskAward),
      common(COLLECTIONS.taskAcceptance),
      common(COLLECTIONS.taskCancellation),
      common(COLLECTIONS.authorityDelegation),
      common(COLLECTIONS.authorityRevocation),
      common(COLLECTIONS.trustAttestation),
    ],
    worker: [
      common(COLLECTIONS.taskClaim),
      common(COLLECTIONS.taskCompletion),
      common(COLLECTIONS.artifactManifest),
    ],
    verifier: [common(COLLECTIONS.verificationResult)],
    coordinator: [
      common(COLLECTIONS.taskRecommendation),
      common(COLLECTIONS.taskAward),
    ],
  };

  return {
    id: ROLE_PERMISSION_SETS[role],
    title: `${role[0]?.toUpperCase() ?? role}${role.slice(1)} permissions`,
    detail: `Create-only Mycelium Protocol 0.1 records for the ${role} role.`,
    permissions: permissionsByRole[role],
  };
}

export function createRolePermissionSetResolver(): PermissionSetResolver {
  return {
    async resolve(permissionSet) {
      const role = (Object.entries(ROLE_PERMISSION_SETS)
        .find(([, nsid]) => nsid === permissionSet)?.[0]) as ProtocolRole | undefined;
      return role ? rolePermissionSet(role) : null;
    },
  };
}
