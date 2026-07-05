export type Transitions<Status extends string> = Record<Status, readonly Status[]>;

export function canTransition<Status extends string>(
  transitions: Transitions<Status>,
  from: Status,
  to: Status,
): boolean {
  return transitions[from].includes(to);
}

export function assertTransition<Status extends string>(
  transitions: Transitions<Status>,
  from: Status,
  to: Status,
): void {
  if (!canTransition(transitions, from, to)) {
    throw new Error(`illegal status transition: ${from} → ${to}`);
  }
}

export function nextStatus<Status extends string>(
  transitions: Transitions<Status>,
  from: Status,
): Status | null {
  return transitions[from][0] ?? null;
}
