// Node-env `unit` vitest project can't resolve the `cloudflare:workers` virtual
// module. These no-op bases let modules that `extends DurableObject` (etc.) load
// for import-only unit tests; the workers-pool projects use the real runtime.
export class DurableObject {}
export class WorkerEntrypoint {}
export class WorkflowEntrypoint {}
export const env = {} as Record<string, unknown>;
