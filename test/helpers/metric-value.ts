import { register } from 'prom-client';

export async function counterValue(name: string): Promise<number> {
  const metrics = await register.getMetricsAsJSON();
  const m = metrics.find((x) => x.name === name);
  return m?.values?.[0]?.value ?? 0;
}
