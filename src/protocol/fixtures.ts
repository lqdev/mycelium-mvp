import { generateIdentity } from '../identity/index.js';
import type { AgentIdentity } from '../schemas/types.js';
import type { ProtocolRole } from './constants.js';
import type { Principal, PrincipalKind } from './types.js';

export interface DemoPrincipal extends Principal {
  role: ProtocolRole;
  identity: AgentIdentity;
}

const DEMO_ACCOUNTS: ReadonlyArray<{
  role: ProtocolRole;
  handle: string;
  displayName: string;
  kind: PrincipalKind;
}> = [
  { role: 'requester', handle: 'requester.demo.test', displayName: 'Demo Requester', kind: 'human' },
  { role: 'worker', handle: 'worker-a.demo.test', displayName: 'Worker A', kind: 'agent-service' },
  { role: 'worker', handle: 'worker-b.demo.test', displayName: 'Worker B', kind: 'agent-service' },
  { role: 'verifier', handle: 'verifier.demo.test', displayName: 'Demo Verifier', kind: 'agent-service' },
  { role: 'coordinator', handle: 'coordinator.demo.test', displayName: 'Demo Coordinator', kind: 'agent-service' },
];

export function createDemoPrincipals(): DemoPrincipal[] {
  return DEMO_ACCOUNTS.map((account) => {
    const identity = generateIdentity(account.handle, account.displayName);
    return {
      did: identity.did,
      kind: account.kind,
      handle: account.handle,
      displayName: account.displayName,
      role: account.role,
      identity,
    };
  });
}
