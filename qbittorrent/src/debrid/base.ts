/**
 * Base interface for debrid services
 */
export interface DebridService {
  readonly name: string;

  /**
   * Check if the service is configured (has API key)
   */
  isConfigured(): boolean;

  /**
   * Check if the service is enabled
   */
  isEnabled(): boolean;

  /**
   * Test connection to the debrid service
   */
  testConnection(): Promise<boolean>;

  /**
   * Debrid a single link
   * Returns the debrided link or throws an error if debrid fails
   */
  debridLink(link: string): Promise<string>;
}
