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
 * API layer for GCUID identity operations
 * Provides REST endpoints for identity management, attribute operations, and federation
 * 
 * Supports both GCUID V2 format (urn:gcuid:{core}) and V1 format (urn:gcuid:{entity-type}:{version}:{core})
 * through transparent handling in the @gcuid/core package.
 */

import IdentityManager from '@gcuid/core';
import FederationManager from '@gcuid/federation';
import AttributeManager from '@gcuid/attributes';

export interface APIConfig {
  port?: number;
  host?: string;
}

export class GCUIDAPI {
  private identityManager: IdentityManager;
  private federationManager: FederationManager;
  private attributeManager: AttributeManager;

  constructor() {
    this.identityManager = new IdentityManager();
    this.federationManager = new FederationManager();
    this.attributeManager = new AttributeManager(this.federationManager);
  }

  /**
   * Get the identity manager instance
   */
  getIdentityManager(): IdentityManager {
    return this.identityManager;
  }

  /**
   * Get the federation manager instance
   */
  getFederationManager(): FederationManager {
    return this.federationManager;
  }

  /**
   * Get the attribute manager instance
   */
  getAttributeManager(): AttributeManager {
    return this.attributeManager;
  }

  /**
   * Initialize the API server
   * TODO: Implement REST API endpoints using Express or similar framework
   */
  async start(config: APIConfig = {}): Promise<void> {
    const port = config.port || 3000;
    const host = config.host || 'localhost';
    
    console.log(`GCUID API ready to start on ${host}:${port}`);
    // TODO: Initialize HTTP server with routes
  }
}

export default GCUIDAPI;
