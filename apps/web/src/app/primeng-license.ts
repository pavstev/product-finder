/** The PrimeNG key is not in the source tree: `primeng-license.plugin.mjs` injects it from the environment. */
declare const NG_PRIMENG_LICENSE: string | undefined;

export const PRIMENG_LICENSE: string = typeof NG_PRIMENG_LICENSE === 'string' ? NG_PRIMENG_LICENSE : '';
