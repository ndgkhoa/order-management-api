import { register } from 'prom-client';

/** Current value of a no-label counter on the default prom-client registry (0 if absent). */
export async function counterValue(name: string): Promise<number> {
  const metrics = await register.getMetricsAsJSON();
  const m = metrics.find((x) => x.name === name);
  return m?.values?.[0]?.value ?? 0;
}
