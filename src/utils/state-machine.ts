/**
 * Generic finite-state-machine helpers, shared by every status vocabulary (order / payment /
 * shipment). Each status file owns only its `Transitions` map (`from` → allowed `to`s); these
 * functions provide the reusable guards so the logic is written once, not copied per status.
 */
export type Transitions<Status extends string> = Record<Status, readonly Status[]>;

/** True if `from → to` is a legal move in `transitions`. */
export function canTransition<Status extends string>(
  transitions: Transitions<Status>,
  from: Status,
  to: Status,
): boolean {
  return transitions[from].includes(to);
}

/** Throws on an illegal transition. Callers should hold a row lock / use compare-and-set. */
export function assertTransition<Status extends string>(
  transitions: Transitions<Status>,
  from: Status,
  to: Status,
): void {
  if (!canTransition(transitions, from, to)) {
    throw new Error(`illegal status transition: ${from} → ${to}`);
  }
}

/** The single next state for a LINEAR machine (each state has at most one successor), or null. */
export function nextStatus<Status extends string>(
  transitions: Transitions<Status>,
  from: Status,
): Status | null {
  return transitions[from][0] ?? null;
}
