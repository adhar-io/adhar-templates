// What the function knows about itself, read once at startup from the
// environment every revision gets: PORT from Knative, FUNCTION_NAME,
// FUNCTION_RUNTIME and FUNCTION_TRIGGER from the Function composition
// (deploy/base/function.yaml). The defaults are what `npm start` on a laptop
// uses. A PORT that is set but invalid stops the function at startup, naming
// it.

export interface FunctionConfig {
  readonly name: string;
  // The runtime the image was built for (node24), as the platform labels it.
  readonly runtime: string;
  // What can invoke the function: http, and the trigger the Function names.
  readonly trigger: string;
  readonly port: number;
}

// process.env, or the variables a test passes instead.
export type Environment = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Environment = process.env): FunctionConfig {
  const rawPort = env.PORT?.trim() || '8080';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a whole number from 0 to 65535, not "${rawPort}"`);
  }
  return Object.freeze({
    name: env.FUNCTION_NAME || ${{ values.name | dump }},
    runtime: env.FUNCTION_RUNTIME || 'node24',
    trigger: env.FUNCTION_TRIGGER || 'http',
    port,
  });
}
