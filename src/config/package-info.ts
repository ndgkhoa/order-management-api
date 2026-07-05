import pkg from '../../package.json' with { type: 'json' };

export function packageInfo(): { name: string; version: string } {
  return { name: pkg.name, version: pkg.version };
}
