import { DebridService } from './base.js';
import { AllDebridClient } from './alldebrid.js';
import { RealDebridClient } from './realdebrid.js';
import { PremiumizeClient } from './premiumize.js';

// All available debrid services
export const debridServices: DebridService[] = [
  new AllDebridClient(),
  new RealDebridClient(),
  new PremiumizeClient(),
];

/**
 * Get all enabled debrid services
 */
export function getEnabledDebridServices(): DebridService[] {
  return debridServices.filter(service => service.isEnabled());
}

/**
 * Check if any debrid service is configured
 */
export function isAnyDebridConfigured(): boolean {
  return debridServices.some(service => service.isConfigured());
}

/**
 * Check if any debrid service is enabled
 */
export function isAnyDebridEnabled(): boolean {
  return debridServices.some(service => service.isEnabled());
}

/**
 * Debrid a link using the first available service
 * Tries each enabled service in order until one succeeds
 * Returns the original link if all services fail
 */
export async function debridLink(link: string): Promise<string> {
  const enabledServices = getEnabledDebridServices();

  if (enabledServices.length === 0) {
    console.log('[Debrid] No debrid service enabled, returning original link');
    return link;
  }

  for (const service of enabledServices) {
    try {
      const debridedLink = await service.debridLink(link);
      if (debridedLink && debridedLink !== link) {
        console.log(`[Debrid] Successfully debrided with ${service.name}`);
        return debridedLink;
      }
    } catch (error: any) {
      console.warn(`[Debrid] ${service.name} failed: ${error.message}`);
      // Continue to next service
    }
  }

  console.warn('[Debrid] All services failed, returning original link');
  return link;
}

/**
 * Test connection to a specific debrid service
 */
export async function testDebridService(serviceName: string): Promise<boolean> {
  const service = debridServices.find(
    s => s.name.toLowerCase() === serviceName.toLowerCase()
  );

  if (!service) {
    console.error(`[Debrid] Service not found: ${serviceName}`);
    return false;
  }

  return service.testConnection();
}

export type { DebridService } from './base.js';
