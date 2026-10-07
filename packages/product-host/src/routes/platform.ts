/** HTTP adapters for platform connection commands. Parsing + response shaping only;
 * every business decision lives in PlatformConnectionService. */
import type { PlatformConnectionService } from '../platform/connection-service.ts'

export type CommandRespond = (status: number, payload: unknown) => void

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${field} is required`)
  return value
}

/** Returns true when the pathname belongs to the platform context and was handled. */
export async function handlePlatformCommand(
  pathname: string,
  input: Record<string, unknown>,
  service: PlatformConnectionService,
  respond: CommandRespond,
  onMutated: () => Promise<void>,
): Promise<boolean> {
  if (pathname === '/api/v1/platform/connections/start') {
    respond(200, await service.start())
    await onMutated()
    return true
  }
  if (pathname === '/api/v1/platform/connections/callback') {
    const result = await service.authorizeCallback({
      connectionId: requireString(input['connectionId'], 'connectionId'),
      state: typeof input['state'] === 'string' ? input['state'] : '',
      approved: input['approved'] !== false,
    })
    respond(200, result)
    await onMutated()
    return true
  }
  if (pathname === '/api/v1/platform/connections/verify' || pathname === '/api/v1/platform/connections/disconnect') {
    const connectionId = requireString(input['connectionId'], 'connectionId')
    const health = pathname.endsWith('/disconnect')
      ? await service.disconnect(connectionId)
      : await service.verify(connectionId)
    respond(200, health)
    await onMutated()
    return true
  }
  if (pathname === '/api/v1/platform/connections/expire') {
    await service.expire(requireString(input['connectionId'], 'connectionId'))
    respond(200, { expired: true })
    return true
  }
  if (pathname === '/api/v1/platform/stores/list') {
    respond(200, service.listStores())
    return true
  }
  return false
}
