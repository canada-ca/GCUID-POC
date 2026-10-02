/*!
 * GCUID — Government of Canada Unique Identifier System
 *
 * @license
 * Copyright (c) 2024-2026 NOETRONIQ Strategic Initiatives. All rights reserved.
 * Author: Philippe R. Beauchamp <prb@noetroniq.com>
 *
 * Licensed for use and modification by the Treasury Board of Canada Secretariat.
 * See LICENSE in the project root for full terms.
 */
/**
 * Federation module for connecting with external identity providers
 * 
 * Supports both GCUID V2 format (urn:gcuid:{core}) and V1 format (urn:gcuid:{entity-type}:{version}:{core})
 * GCUIDs are treated as opaque strings - format handling is delegated to @gcuid/core.
 */

export interface FederatedEntity {
  id: string;
  name: string;
  endpoint: string;
  protocol: 'SAML' | 'OAuth2' | 'OIDC' | 'Custom';
}

export interface FederationAdapter {
  connect(entity: FederatedEntity): Promise<void>;
  disconnect(entityId: string): Promise<void>;
  queryAttributes(entityId: string, gcuid: string, attributes: string[]): Promise<Record<string, any>>;
}

export class FederationManager {
  private entities: Map<string, FederatedEntity> = new Map();
  private adapters: Map<string, FederationAdapter> = new Map();

  /**
   * Register a federated entity
   */
  registerEntity(entity: FederatedEntity): void {
    this.entities.set(entity.id, entity);
  }

  /**
   * Get all registered entities
   */
  getEntities(): FederatedEntity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Register an adapter for a specific protocol
   */
  registerAdapter(protocol: string, adapter: FederationAdapter): void {
    this.adapters.set(protocol, adapter);
  }

  /**
   * Query attributes from a federated entity
   */
  async queryFederatedAttributes(
    entityId: string,
    gcuid: string,
    attributes: string[]
  ): Promise<Record<string, any>> {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} not found`);
    }

    const adapter = this.adapters.get(entity.protocol);
    if (!adapter) {
      throw new Error(`No adapter registered for protocol ${entity.protocol}`);
    }

    return adapter.queryAttributes(entityId, gcuid, attributes);
  }
}

export default FederationManager;
