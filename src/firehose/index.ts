// Firehose module: in-process pub/sub broadcast of all repository events.
// Simulates the AT Protocol Firehose — every record write is an event.

import { randomUUID } from 'node:crypto';
import type { Firehose, FirehoseFilter, FirehoseSubscription } from '../schemas/types.js';
import { SubscriptionNotFoundError } from '../errors.js';
import { CONSTANTS } from '../constants.js';

/**
 * Create a new Firehose instance.
 * Must be created first — before any repositories — so no events are missed.
 */
export function createFirehose(): Firehose {
  return {
    seq: CONSTANTS.FIREHOSE_SEQ_START,
    log: [],
    subscriptions: new Map(),
  };
}

/**
 * Subscribe to firehose events with an optional filter.
 * Filter semantics: if both collections AND dids are provided, both must match (AND).
 * If only one is provided, only that filter is checked.
 * If no filter, all events are delivered.
 *
 * @returns The subscription ID (use to unsubscribe)
 */
export function subscribe(
  firehose: Firehose,
  filter: FirehoseFilter | undefined,
  handler: FirehoseSubscription['handler'],
): string {
  const id = randomUUID();
  firehose.subscriptions.set(id, { id, filter, handler });
  return id;
}

/**
 * Remove a subscription by ID.
 * In-flight handlers that are currently executing will finish normally.
 *
 * @throws SubscriptionNotFoundError if the subscription ID is not found
 */
export function unsubscribe(firehose: Firehose, subscriptionId: string): void {
  if (!firehose.subscriptions.has(subscriptionId)) {
    throw new SubscriptionNotFoundError(subscriptionId);
  }
  firehose.subscriptions.delete(subscriptionId);
}

/**
 * Return the full event log for dashboard replay.
 * The log is append-only and ordered by seq.
 */
export function getEventLog(firehose: Firehose) {
  return [...firehose.log]; // Defensive copy
}
