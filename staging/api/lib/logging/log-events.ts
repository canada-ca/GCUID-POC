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
/*!
 * GCUID System Logging — Event Catalogue
 *
 * Every log event emitted anywhere in the system is registered here.
 * Each entry defines:
 *   code          – opaque machine code used in event_code column (prefix + 3-digit)
 *   event_type    – dotted category slug used in event_type column
 *   system        – owning system table
 *   defaultLevel  – minimum level at which this event is written under normal conditions
 *   description   – plain-English description of when this event fires
 *   requiredFields– base-column fields that MUST be populated for this event
 *   outcome       – fixed outcome value if the event always has one (otherwise omit)
 *
 * Prefixes
 *   REG – GCUID Registry
 *   CAE – CAES (Common Attribute Exchange Service)
 *   HR  – HR System
 *   LDP – LDAP / Active Directory
 *   ENG – Engineering Department
 *   FIN – Finance Department
 *   SYS – General / Infrastructure
 */

import type { LogLevel, Outcome, SystemId } from './log-types.js';

export interface LogEventDef {
  code:           string;
  event_type:     string;
  system:         SystemId;
  defaultLevel:   LogLevel;
  description:    string;
  requiredFields: string[];   // names of BaseLogRecord fields that must be set
  outcome?:       Outcome;    // set only when outcome is always the same
}

// ─── §1  GCUID Registry ───────────────────────────────────────────────────────

export const REGISTRY_EVENTS = {

  // Identity lifecycle
  IDENTITY_REQUEST_RECEIVED:  { code: 'REG-001', event_type: 'identity.request_received',  system: 'gcuid-registry', defaultLevel: 'info',    description: 'A new identity request was received from a user or system.',                           requiredFields: ['actor_id', 'actor_type', 'transaction_id'] },
  IDENTITY_CREATED:           { code: 'REG-002', event_type: 'identity.created',            system: 'gcuid-registry', defaultLevel: 'notice',  description: 'A new GCUID identity record was created in provisional state.',                         requiredFields: ['gcuid', 'actor_id', 'actor_type', 'transaction_id'], outcome: 'success' },
  IDENTITY_APPROVED:          { code: 'REG-003', event_type: 'identity.approved',           system: 'gcuid-registry', defaultLevel: 'notice',  description: 'A provisional identity was approved and transitioned to active.',                        requiredFields: ['gcuid', 'actor_id', 'actor_type', 'identity_state_before', 'identity_state_after'], outcome: 'success' },
  IDENTITY_REJECTED:          { code: 'REG-004', event_type: 'identity.rejected',           system: 'gcuid-registry', defaultLevel: 'notice',  description: 'A provisional identity request was rejected.',                                           requiredFields: ['gcuid', 'actor_id', 'actor_type', 'identity_state_before', 'identity_state_after'], outcome: 'failure' },
  IDENTITY_SUSPENDED:         { code: 'REG-005', event_type: 'identity.suspended',          system: 'gcuid-registry', defaultLevel: 'warning', description: 'An active identity was suspended.',                                                      requiredFields: ['gcuid', 'actor_id', 'actor_type', 'identity_state_before', 'identity_state_after'] },
  IDENTITY_REACTIVATED:       { code: 'REG-006', event_type: 'identity.reactivated',        system: 'gcuid-registry', defaultLevel: 'notice',  description: 'A suspended identity was restored to active.',                                           requiredFields: ['gcuid', 'actor_id', 'actor_type', 'identity_state_before', 'identity_state_after'], outcome: 'success' },
  IDENTITY_ARCHIVED:          { code: 'REG-007', event_type: 'identity.archived',           system: 'gcuid-registry', defaultLevel: 'notice',  description: 'An identity was archived (end-of-life, not deleted).',                                   requiredFields: ['gcuid', 'actor_id', 'actor_type', 'identity_state_before', 'identity_state_after'] },
  IDENTITY_DELETED:           { code: 'REG-008', event_type: 'identity.deleted',            system: 'gcuid-registry', defaultLevel: 'warning', description: 'An identity record was permanently deleted.',                                            requiredFields: ['gcuid', 'actor_id', 'actor_type'] },
  IDENTITY_STATE_INVALID:     { code: 'REG-009', event_type: 'identity.state_invalid',      system: 'gcuid-registry', defaultLevel: 'error',   description: 'A state transition was attempted that is not permitted by the state machine.',            requiredFields: ['gcuid', 'actor_id', 'actor_type', 'identity_state_before'], outcome: 'failure' },
  IDENTITY_VIEWED:            { code: 'REG-010', event_type: 'identity.viewed',             system: 'gcuid-registry', defaultLevel: 'debug',   description: 'An identity record was retrieved for viewing.',                                          requiredFields: ['gcuid', 'actor_id', 'actor_type'] },
  IDENTITY_LISTED:            { code: 'REG-011', event_type: 'identity.listed',             system: 'gcuid-registry', defaultLevel: 'debug',   description: 'The identity list was queried (possibly filtered).',                                     requiredFields: ['actor_id', 'actor_type'] },
  IDENTITY_NOT_FOUND:         { code: 'REG-012', event_type: 'identity.not_found',          system: 'gcuid-registry', defaultLevel: 'info',    description: 'A lookup for a specific GCUID returned no result.',                                      requiredFields: ['target_id', 'actor_id'], outcome: 'failure' },

  // Matching
  MATCH_ATTEMPTED:            { code: 'REG-020', event_type: 'identity.match_attempted',    system: 'gcuid-registry', defaultLevel: 'debug',   description: 'The matching engine was invoked to find candidates for an identity.',                    requiredFields: ['gcuid', 'transaction_id'] },
  MATCH_FOUND:                { code: 'REG-021', event_type: 'identity.match_found',        system: 'gcuid-registry', defaultLevel: 'info',    description: 'Matching produced at least one candidate above the confidence threshold.',               requiredFields: ['gcuid', 'match_confidence', 'source_systems', 'transaction_id'], outcome: 'success' },
  MATCH_NOT_FOUND:            { code: 'REG-022', event_type: 'identity.match_not_found',    system: 'gcuid-registry', defaultLevel: 'info',    description: 'Matching found no candidates above the confidence threshold.',                           requiredFields: ['gcuid', 'transaction_id'], outcome: 'failure' },
  MATCH_LOW_CONFIDENCE:       { code: 'REG-023', event_type: 'identity.match_low_conf',     system: 'gcuid-registry', defaultLevel: 'warning', description: 'Best match candidate is below the acceptance threshold — requires manual review.',        requiredFields: ['gcuid', 'match_confidence', 'transaction_id'] },
  DUPLICATE_DETECTED:         { code: 'REG-024', event_type: 'identity.duplicate',          system: 'gcuid-registry', defaultLevel: 'warning', description: 'A new identity request appears to duplicate an existing active identity.',                requiredFields: ['gcuid', 'target_id', 'match_confidence'] },

  // Alias management
  ALIAS_CREATED:              { code: 'REG-030', event_type: 'alias.created',               system: 'gcuid-registry', defaultLevel: 'info',    description: 'An alias was generated and attached to a GCUID.',                                        requiredFields: ['gcuid', 'alias_type', 'actor_id'], outcome: 'success' },
  ALIAS_DELETED:              { code: 'REG-031', event_type: 'alias.deleted',               system: 'gcuid-registry', defaultLevel: 'notice',  description: 'An alias was removed from a GCUID.',                                                    requiredFields: ['gcuid', 'alias_type', 'actor_id'] },
  ALIAS_LOOKUP:               { code: 'REG-032', event_type: 'alias.lookup',                system: 'gcuid-registry', defaultLevel: 'debug',   description: 'An alias was looked up to resolve its parent GCUID.',                                    requiredFields: ['target_id'] },
  ALIAS_COLLISION:            { code: 'REG-033', event_type: 'alias.collision',             system: 'gcuid-registry', defaultLevel: 'error',   description: 'Alias generation produced a value that already exists.',                                 requiredFields: ['gcuid', 'alias_type'], outcome: 'failure' },

  // Admin operations
  ADMIN_LIST:                 { code: 'REG-040', event_type: 'admin.list',                  system: 'gcuid-registry', defaultLevel: 'debug',   description: 'Admin queried the identity list.',                                                       requiredFields: ['actor_id', 'actor_type'] },
  ADMIN_BULK_ACTION:          { code: 'REG-041', event_type: 'admin.bulk_action',           system: 'gcuid-registry', defaultLevel: 'notice',  description: 'Admin performed a bulk state-change on multiple identities.',                            requiredFields: ['actor_id', 'actor_type', 'context'] },

  // Connector + flag events that originate in the registry
  CONNECTOR_REGISTERED:       { code: 'REG-050', event_type: 'connector.registered',        system: 'gcuid-registry', defaultLevel: 'notice',  description: 'A new source-system connector was registered with the registry.',                        requiredFields: ['target_id', 'actor_id'] },
  CONNECTOR_REMOVED:          { code: 'REG-051', event_type: 'connector.removed',           system: 'gcuid-registry', defaultLevel: 'notice',  description: 'A source-system connector was de-registered.',                                          requiredFields: ['target_id', 'actor_id'] },
  FLAG_CHANGED:               { code: 'REG-052', event_type: 'flag.changed',                system: 'gcuid-registry', defaultLevel: 'notice',  description: 'A feature flag was toggled.',                                                           requiredFields: ['target_id', 'actor_id'] },

  // Seed / init
  SEED_STARTED:               { code: 'REG-060', event_type: 'seed.started',                system: 'gcuid-registry', defaultLevel: 'info',    description: 'Registry database seeding or initialisation was started.',                               requiredFields: [] },
  SEED_COMPLETED:             { code: 'REG-061', event_type: 'seed.completed',              system: 'gcuid-registry', defaultLevel: 'info',    description: 'Registry database seeding completed successfully.',                                      requiredFields: [], outcome: 'success' },
  SEED_FAILED:                { code: 'REG-062', event_type: 'seed.failed',                 system: 'gcuid-registry', defaultLevel: 'critical', description: 'Registry database seeding failed; registry may be in an inconsistent state.',           requiredFields: ['error_code', 'error_detail'], outcome: 'failure' },

  // Auth / middleware
  AUTH_DENIED:                { code: 'REG-070', event_type: 'auth.denied',                 system: 'gcuid-registry', defaultLevel: 'warning', description: 'A request was rejected by the authentication/authorisation middleware.',                  requiredFields: ['actor_id', 'ip_address', 'request_id'], outcome: 'failure' },
  REQUEST_VALIDATION_FAILED:  { code: 'REG-071', event_type: 'request.validation_failed',   system: 'gcuid-registry', defaultLevel: 'warning', description: 'Incoming request body or parameters failed validation.',                                 requiredFields: ['request_id', 'error_detail'], outcome: 'failure' },

} as const satisfies Record<string, LogEventDef>;

// ─── §2  CAES ─────────────────────────────────────────────────────────────────

export const CAES_EVENTS = {

  // Attribute queries
  ATTR_QUERY_RECEIVED:        { code: 'CAE-001', event_type: 'attribute.query_received',    system: 'caes', defaultLevel: 'debug',   description: 'An attribute resolution request was received.',                                                  requiredFields: ['query_gcuid', 'attributes_requested', 'transaction_id'] },
  ATTR_RESOLVED:              { code: 'CAE-002', event_type: 'attribute.resolved',          system: 'caes', defaultLevel: 'info',    description: 'All requested attributes were resolved successfully.',                                           requiredFields: ['query_gcuid', 'attributes_returned', 'source_systems_queried', 'duration_ms'], outcome: 'success' },
  ATTR_PARTIAL:               { code: 'CAE-003', event_type: 'attribute.partial',           system: 'caes', defaultLevel: 'warning', description: 'Some requested attributes could not be resolved; partial result returned.',                       requiredFields: ['query_gcuid', 'attributes_returned', 'attributes_missing'], outcome: 'partial' },
  ATTR_NOT_FOUND:             { code: 'CAE-004', event_type: 'attribute.not_found',         system: 'caes', defaultLevel: 'info',    description: 'None of the requested attributes could be resolved.',                                            requiredFields: ['query_gcuid', 'attributes_requested', 'attributes_missing'], outcome: 'failure' },

  // Cache
  CACHE_HIT:                  { code: 'CAE-010', event_type: 'cache.hit',                   system: 'caes', defaultLevel: 'debug',   description: 'Attribute result was served from cache.',                                                        requiredFields: ['query_gcuid', 'cache_age_seconds'], outcome: 'success' },
  CACHE_MISS:                 { code: 'CAE-011', event_type: 'cache.miss',                  system: 'caes', defaultLevel: 'debug',   description: 'No valid cached entry found; live federation query required.',                                    requiredFields: ['query_gcuid'] },
  CACHE_WRITTEN:              { code: 'CAE-012', event_type: 'cache.written',               system: 'caes', defaultLevel: 'debug',   description: 'A federation result was written to the attribute cache.',                                         requiredFields: ['query_gcuid'] },
  CACHE_INVALIDATED:          { code: 'CAE-013', event_type: 'cache.invalidated',           system: 'caes', defaultLevel: 'info',    description: 'Cached entries for a GCUID were explicitly invalidated.',                                        requiredFields: ['query_gcuid', 'actor_id'] },
  CACHE_EXPIRED:              { code: 'CAE-014', event_type: 'cache.expired',               system: 'caes', defaultLevel: 'debug',   description: 'A cached entry reached its TTL and was purged.',                                                 requiredFields: ['query_gcuid'] },
  CACHE_STALE_SERVED:         { code: 'CAE-015', event_type: 'cache.stale_served',          system: 'caes', defaultLevel: 'warning', description: 'A stale cache entry was served because the live source was unavailable.',                         requiredFields: ['query_gcuid', 'cache_age_seconds', 'source_systems_failed'] },

  // Federation
  FEDERATION_STARTED:         { code: 'CAE-020', event_type: 'federation.started',          system: 'caes', defaultLevel: 'debug',   description: 'Multi-source attribute federation was initiated.',                                               requiredFields: ['query_gcuid', 'source_systems_queried', 'transaction_id'] },
  FEDERATION_COMPLETED:       { code: 'CAE-021', event_type: 'federation.completed',        system: 'caes', defaultLevel: 'info',    description: 'Federation completed with results from all queried sources.',                                     requiredFields: ['query_gcuid', 'source_systems_queried', 'duration_ms'], outcome: 'success' },
  FEDERATION_PARTIAL:         { code: 'CAE-022', event_type: 'federation.partial',          system: 'caes', defaultLevel: 'warning', description: 'Federation completed but one or more sources failed to respond.',                                 requiredFields: ['query_gcuid', 'source_systems_queried', 'source_systems_failed'], outcome: 'partial' },
  FEDERATION_FAILED:          { code: 'CAE-023', event_type: 'federation.failed',           system: 'caes', defaultLevel: 'error',   description: 'Federation failed entirely; no sources responded in time.',                                      requiredFields: ['query_gcuid', 'source_systems_failed', 'error_detail'], outcome: 'failure' },

  // Source queries
  SOURCE_QUERY_SENT:          { code: 'CAE-030', event_type: 'source.query_sent',           system: 'caes', defaultLevel: 'debug',   description: 'An attribute query was dispatched to a source system.',                                          requiredFields: ['query_gcuid', 'target_id'] },
  SOURCE_QUERY_RESPONSE:      { code: 'CAE-031', event_type: 'source.query_response',       system: 'caes', defaultLevel: 'debug',   description: 'A response was received from a source system.',                                                  requiredFields: ['query_gcuid', 'target_id', 'duration_ms'], outcome: 'success' },
  SOURCE_QUERY_TIMEOUT:       { code: 'CAE-032', event_type: 'source.query_timeout',        system: 'caes', defaultLevel: 'warning', description: 'A source system did not respond within the allowed timeout.',                                     requiredFields: ['query_gcuid', 'target_id', 'duration_ms'], outcome: 'failure' },
  SOURCE_QUERY_ERROR:         { code: 'CAE-033', event_type: 'source.query_error',          system: 'caes', defaultLevel: 'error',   description: 'A source system returned an error response.',                                                    requiredFields: ['query_gcuid', 'target_id', 'error_code', 'error_detail'], outcome: 'failure' },

  // Mapping administration
  MAPPING_CREATED:            { code: 'CAE-040', event_type: 'mapping.created',             system: 'caes', defaultLevel: 'notice',  description: 'An attribute mapping entry was created.',                                                        requiredFields: ['standard_attribute', 'actor_id'], outcome: 'success' },
  MAPPING_UPDATED:            { code: 'CAE-041', event_type: 'mapping.updated',             system: 'caes', defaultLevel: 'notice',  description: 'An attribute mapping entry was updated.',                                                        requiredFields: ['mapping_id', 'standard_attribute', 'actor_id'] },
  MAPPING_DELETED:            { code: 'CAE-042', event_type: 'mapping.deleted',             system: 'caes', defaultLevel: 'notice',  description: 'An attribute mapping entry was deleted.',                                                        requiredFields: ['mapping_id', 'actor_id'] },
  MAPPING_LISTED:             { code: 'CAE-043', event_type: 'mapping.listed',              system: 'caes', defaultLevel: 'debug',   description: 'The attribute mapping table was queried.',                                                       requiredFields: ['actor_id'] },
  PREFETCH_STARTED:           { code: 'CAE-050', event_type: 'prefetch.started',            system: 'caes', defaultLevel: 'debug',   description: 'Scheduled attribute pre-fetch job started.',                                                     requiredFields: [] },
  PREFETCH_COMPLETED:         { code: 'CAE-051', event_type: 'prefetch.completed',          system: 'caes', defaultLevel: 'info',    description: 'Scheduled attribute pre-fetch job completed.',                                                   requiredFields: ['duration_ms'], outcome: 'success' },
  PREFETCH_FAILED:            { code: 'CAE-052', event_type: 'prefetch.failed',             system: 'caes', defaultLevel: 'error',   description: 'Scheduled attribute pre-fetch job failed.',                                                      requiredFields: ['error_detail'], outcome: 'failure' },

} as const satisfies Record<string, LogEventDef>;

// ─── §3  HR System ────────────────────────────────────────────────────────────

export const HR_EVENTS = {

  // Employee CRUD
  EMPLOYEE_LISTED:            { code: 'HR-001', event_type: 'employee.listed',              system: 'hr', defaultLevel: 'debug',   description: 'Employee list was retrieved.',                                                               requiredFields: ['actor_id', 'actor_type'] },
  EMPLOYEE_VIEWED:            { code: 'HR-002', event_type: 'employee.viewed',              system: 'hr', defaultLevel: 'debug',   description: 'A single employee record was retrieved.',                                                    requiredFields: ['employee_id', 'actor_id'] },
  EMPLOYEE_CREATED:           { code: 'HR-003', event_type: 'employee.created',             system: 'hr', defaultLevel: 'notice',  description: 'A new employee record was added to the HR system.',                                          requiredFields: ['employee_id', 'actor_id', 'department'], outcome: 'success' },
  EMPLOYEE_UPDATED:           { code: 'HR-004', event_type: 'employee.updated',             system: 'hr', defaultLevel: 'notice',  description: 'An employee record was updated.',                                                            requiredFields: ['employee_id', 'actor_id'] },
  EMPLOYEE_DEACTIVATED:       { code: 'HR-005', event_type: 'employee.deactivated',         system: 'hr', defaultLevel: 'notice',  description: 'An employee record was deactivated (termination, leave, etc.).',                             requiredFields: ['employee_id', 'actor_id'] },
  EMPLOYEE_NOT_FOUND:         { code: 'HR-006', event_type: 'employee.not_found',           system: 'hr', defaultLevel: 'info',    description: 'A lookup for a specific employee ID returned no result.',                                    requiredFields: ['employee_id', 'actor_id'], outcome: 'failure' },
  EMPLOYEE_SEARCHED:          { code: 'HR-007', event_type: 'employee.searched',            system: 'hr', defaultLevel: 'debug',   description: 'A search query was executed against the HR employee dataset.',                               requiredFields: ['actor_id'] },

  // Connector lifecycle
  CONNECTOR_STARTED:          { code: 'HR-010', event_type: 'connector.started',            system: 'hr', defaultLevel: 'notice',  description: 'HR connector API server started and is ready to accept connections.',                        requiredFields: ['connector_url'], outcome: 'success' },
  CONNECTOR_STOPPED:          { code: 'HR-011', event_type: 'connector.stopped',            system: 'hr', defaultLevel: 'notice',  description: 'HR connector API server stopped.',                                                          requiredFields: ['connector_url'] },
  CONNECTOR_HEALTH_OK:        { code: 'HR-012', event_type: 'connector.health_ok',          system: 'hr', defaultLevel: 'debug',   description: 'Connector health check passed.',                                                             requiredFields: ['connector_url', 'connector_status'], outcome: 'success' },
  CONNECTOR_HEALTH_DEGRADED:  { code: 'HR-013', event_type: 'connector.health_degraded',    system: 'hr', defaultLevel: 'warning', description: 'Connector health check returned degraded status.',                                           requiredFields: ['connector_url', 'connector_status'] },
  CONNECTOR_HEALTH_FAIL:      { code: 'HR-014', event_type: 'connector.health_fail',        system: 'hr', defaultLevel: 'error',   description: 'Connector health check failed; connector is unreachable or unhealthy.',                      requiredFields: ['connector_url', 'connector_status', 'error_detail'], outcome: 'failure' },
  CONNECTOR_OFFLINE:          { code: 'HR-015', event_type: 'connector.offline',            system: 'hr', defaultLevel: 'alarm',   description: 'HR connector has been unreachable for longer than the alarm threshold.',                     requiredFields: ['connector_url'] },

  // Sync
  SYNC_STARTED:               { code: 'HR-020', event_type: 'sync.started',                 system: 'hr', defaultLevel: 'info',    description: 'Scheduled or manual HR sync job started.',                                                  requiredFields: ['sync_cursor'] },
  SYNC_COMPLETED:             { code: 'HR-021', event_type: 'sync.completed',               system: 'hr', defaultLevel: 'info',    description: 'HR sync job completed successfully.',                                                       requiredFields: ['records_affected', 'sync_cursor', 'duration_ms'], outcome: 'success' },
  SYNC_FAILED:                { code: 'HR-022', event_type: 'sync.failed',                  system: 'hr', defaultLevel: 'error',   description: 'HR sync job failed.',                                                                       requiredFields: ['error_code', 'error_detail'], outcome: 'failure' },
  SYNC_NO_CHANGES:            { code: 'HR-023', event_type: 'sync.no_changes',              system: 'hr', defaultLevel: 'debug',   description: 'Sync ran successfully but found no new or changed records.',                                 requiredFields: ['sync_cursor'], outcome: 'skipped' },

  // GCUID linkage
  GCUID_LINKED:               { code: 'HR-030', event_type: 'gcuid.linked',                 system: 'hr', defaultLevel: 'info',    description: 'An employee record was linked to a GCUID.',                                                 requiredFields: ['employee_id', 'gcuid_linked'], outcome: 'success' },
  GCUID_UNLINKED:             { code: 'HR-031', event_type: 'gcuid.unlinked',               system: 'hr', defaultLevel: 'notice',  description: 'The GCUID link was removed from an employee record.',                                       requiredFields: ['employee_id', 'gcuid_linked'] },

} as const satisfies Record<string, LogEventDef>;

// ─── §4  LDAP / AD ────────────────────────────────────────────────────────────

export const LDAP_EVENTS = {

  // User operations
  USER_LISTED:                { code: 'LDP-001', event_type: 'user.listed',                 system: 'ldap', defaultLevel: 'debug',   description: 'LDAP user list was retrieved.',                                                                  requiredFields: ['actor_id', 'actor_type'] },
  USER_VIEWED:                { code: 'LDP-002', event_type: 'user.viewed',                 system: 'ldap', defaultLevel: 'debug',   description: 'A single LDAP user record was retrieved.',                                                      requiredFields: ['username', 'actor_id'] },
  USER_UPDATED:               { code: 'LDP-003', event_type: 'user.updated',                system: 'ldap', defaultLevel: 'notice',  description: 'A LDAP user record was updated (admin-initiated).',                                              requiredFields: ['username', 'actor_id', 'attribute_changed'] },
  USER_NOT_FOUND:             { code: 'LDP-004', event_type: 'user.not_found',              system: 'ldap', defaultLevel: 'info',    description: 'A lookup for a specific LDAP user returned no result.',                                          requiredFields: ['username', 'actor_id'], outcome: 'failure' },

  // Self-service
  SELF_SVC_ATTEMPTED:         { code: 'LDP-010', event_type: 'self_service.attempted',      system: 'ldap', defaultLevel: 'info',    description: 'A user attempted a self-service attribute update.',                                              requiredFields: ['username', 'actor_id', 'attribute_changed', 'self_service'] },
  SELF_SVC_SUCCESS:           { code: 'LDP-011', event_type: 'self_service.success',        system: 'ldap', defaultLevel: 'notice',  description: 'Self-service attribute update was accepted and applied.',                                        requiredFields: ['username', 'actor_id', 'attribute_changed', 'value_before_hash'], outcome: 'success' },
  SELF_SVC_REJECTED:          { code: 'LDP-012', event_type: 'self_service.rejected',       system: 'ldap', defaultLevel: 'warning', description: 'Self-service update was rejected (validation failure or policy).',                               requiredFields: ['username', 'actor_id', 'attribute_changed', 'error_detail'], outcome: 'failure' },
  SELF_SVC_UNAUTHORISED:      { code: 'LDP-013', event_type: 'self_service.unauthorised',   system: 'ldap', defaultLevel: 'warning', description: 'Self-service update was attempted on a non-self-service attribute.',                             requiredFields: ['username', 'actor_id', 'attribute_changed'], outcome: 'failure' },

  // Group
  GROUP_QUERIED:              { code: 'LDP-020', event_type: 'group.queried',               system: 'ldap', defaultLevel: 'debug',   description: 'Group membership was queried for a user.',                                                       requiredFields: ['username', 'actor_id'] },
  GROUP_MEMBERSHIP_CHANGED:   { code: 'LDP-021', event_type: 'group.membership_changed',    system: 'ldap', defaultLevel: 'notice',  description: 'A user was added to or removed from a group.',                                                  requiredFields: ['username', 'groups_affected', 'actor_id'] },

  // Connector lifecycle
  CONNECTOR_STARTED:          { code: 'LDP-030', event_type: 'connector.started',           system: 'ldap', defaultLevel: 'notice',  description: 'LDAP connector API server started.',                                                             requiredFields: ['connector_url'], outcome: 'success' },
  CONNECTOR_STOPPED:          { code: 'LDP-031', event_type: 'connector.stopped',           system: 'ldap', defaultLevel: 'notice',  description: 'LDAP connector API server stopped.',                                                             requiredFields: ['connector_url'] },
  CONNECTOR_HEALTH_OK:        { code: 'LDP-032', event_type: 'connector.health_ok',         system: 'ldap', defaultLevel: 'debug',   description: 'LDAP connector health check passed.',                                                            requiredFields: ['connector_url', 'connector_status'], outcome: 'success' },
  CONNECTOR_HEALTH_DEGRADED:  { code: 'LDP-033', event_type: 'connector.health_degraded',   system: 'ldap', defaultLevel: 'warning', description: 'LDAP connector health check returned degraded status.',                                          requiredFields: ['connector_url', 'connector_status'] },
  CONNECTOR_HEALTH_FAIL:      { code: 'LDP-034', event_type: 'connector.health_fail',       system: 'ldap', defaultLevel: 'error',   description: 'LDAP connector health check failed.',                                                            requiredFields: ['connector_url', 'connector_status', 'error_detail'], outcome: 'failure' },
  CONNECTOR_OFFLINE:          { code: 'LDP-035', event_type: 'connector.offline',           system: 'ldap', defaultLevel: 'alarm',   description: 'LDAP connector has been unreachable for longer than the alarm threshold.',                       requiredFields: ['connector_url'] },

  // Sync
  SYNC_STARTED:               { code: 'LDP-040', event_type: 'sync.started',                system: 'ldap', defaultLevel: 'info',    description: 'Scheduled or manual LDAP sync job started.',                                                    requiredFields: ['sync_cursor'] },
  SYNC_COMPLETED:             { code: 'LDP-041', event_type: 'sync.completed',              system: 'ldap', defaultLevel: 'info',    description: 'LDAP sync job completed successfully.',                                                          requiredFields: ['records_affected', 'sync_cursor', 'duration_ms'], outcome: 'success' },
  SYNC_FAILED:                { code: 'LDP-042', event_type: 'sync.failed',                 system: 'ldap', defaultLevel: 'error',   description: 'LDAP sync job failed.',                                                                          requiredFields: ['error_code', 'error_detail'], outcome: 'failure' },
  SYNC_NO_CHANGES:            { code: 'LDP-043', event_type: 'sync.no_changes',             system: 'ldap', defaultLevel: 'debug',   description: 'LDAP sync ran successfully but found no new or changed records.',                                requiredFields: ['sync_cursor'], outcome: 'skipped' },

  // Bind
  BIND_ATTEMPTED:             { code: 'LDP-050', event_type: 'bind.attempted',              system: 'ldap', defaultLevel: 'debug',   description: 'An LDAP bind (authentication) was attempted.',                                                  requiredFields: ['username', 'ip_address'] },
  BIND_SUCCESS:               { code: 'LDP-051', event_type: 'bind.success',                system: 'ldap', defaultLevel: 'info',    description: 'LDAP bind succeeded.',                                                                           requiredFields: ['username'], outcome: 'success' },
  BIND_FAILURE:               { code: 'LDP-052', event_type: 'bind.failure',                system: 'ldap', defaultLevel: 'warning', description: 'LDAP bind failed (bad credentials or account locked).',                                          requiredFields: ['username', 'ip_address', 'error_code'], outcome: 'failure' },

  // GCUID linkage
  GCUID_LINKED:               { code: 'LDP-060', event_type: 'gcuid.linked',                system: 'ldap', defaultLevel: 'info',    description: 'A LDAP user record was linked to a GCUID.',                                                     requiredFields: ['username', 'gcuid_linked'], outcome: 'success' },

} as const satisfies Record<string, LogEventDef>;

// ─── §5  Engineering Department ───────────────────────────────────────────────

export const ENGINEERING_EVENTS = {

  // Employee operations
  EMPLOYEE_LISTED:            { code: 'ENG-001', event_type: 'employee.listed',             system: 'engineering', defaultLevel: 'debug',   description: 'Engineering employee list was retrieved.',                                                  requiredFields: ['actor_id'] },
  EMPLOYEE_VIEWED:            { code: 'ENG-002', event_type: 'employee.viewed',             system: 'engineering', defaultLevel: 'debug',   description: 'A single engineering employee record was retrieved.',                                       requiredFields: ['eng_employee_id', 'actor_id'] },
  EMPLOYEE_SEARCHED:          { code: 'ENG-003', event_type: 'employee.searched',           system: 'engineering', defaultLevel: 'debug',   description: 'A search query was executed against the engineering employee dataset.',                      requiredFields: ['actor_id'] },
  EMPLOYEE_NOT_FOUND:         { code: 'ENG-004', event_type: 'employee.not_found',          system: 'engineering', defaultLevel: 'info',    description: 'A lookup for a specific engineering employee returned no result.',                           requiredFields: ['eng_employee_id', 'actor_id'], outcome: 'failure' },

  // Cache
  CACHE_READ:                 { code: 'ENG-010', event_type: 'cache.read',                  system: 'engineering', defaultLevel: 'debug',   description: 'Engineering cache was read.',                                                               requiredFields: ['cache_operation', 'cache_mode'] },
  CACHE_WRITE:                { code: 'ENG-011', event_type: 'cache.write',                 system: 'engineering', defaultLevel: 'debug',   description: 'Engineering cache was written.',                                                            requiredFields: ['cache_operation', 'records_affected'] },
  CACHE_MISS:                 { code: 'ENG-012', event_type: 'cache.miss',                  system: 'engineering', defaultLevel: 'debug',   description: 'Cache miss — falling back to authoritative source.',                                        requiredFields: ['cache_operation'] },
  CACHE_INVALIDATED:          { code: 'ENG-013', event_type: 'cache.invalidated',           system: 'engineering', defaultLevel: 'info',    description: 'Engineering department cache was explicitly invalidated.',                                   requiredFields: ['actor_id'] },
  CACHE_EXPIRED:              { code: 'ENG-014', event_type: 'cache.expired',               system: 'engineering', defaultLevel: 'debug',   description: 'Engineering cache entry reached TTL and was purged.',                                       requiredFields: [] },
  CACHE_POLICY_VIOLATED:      { code: 'ENG-015', event_type: 'cache.policy_violated',       system: 'engineering', defaultLevel: 'error',   description: 'A read was attempted when the cache policy requires a live pull that is unavailable.',       requiredFields: ['cache_mode', 'error_detail'], outcome: 'failure' },

  // Sync
  SYNC_STARTED:               { code: 'ENG-020', event_type: 'sync.started',                system: 'engineering', defaultLevel: 'info',    description: 'Engineering connector sync job started.',                                                   requiredFields: [] },
  SYNC_COMPLETED:             { code: 'ENG-021', event_type: 'sync.completed',              system: 'engineering', defaultLevel: 'info',    description: 'Engineering connector sync job completed.',                                                 requiredFields: ['records_affected', 'duration_ms'], outcome: 'success' },
  SYNC_FAILED:                { code: 'ENG-022', event_type: 'sync.failed',                 system: 'engineering', defaultLevel: 'error',   description: 'Engineering connector sync job failed.',                                                    requiredFields: ['error_code', 'error_detail'], outcome: 'failure' },

  // Coverage
  COVERAGE_CALCULATED:        { code: 'ENG-030', event_type: 'coverage.calculated',         system: 'engineering', defaultLevel: 'debug',   description: 'GCUID coverage score was calculated for an employee.',                                      requiredFields: ['eng_employee_id', 'coverage_score', 'coverage_pct'] },
  COVERAGE_BELOW_THRESHOLD:   { code: 'ENG-031', event_type: 'coverage.below_threshold',    system: 'engineering', defaultLevel: 'warning', description: 'Coverage score is below the configured minimum acceptable threshold.',                       requiredFields: ['eng_employee_id', 'coverage_score', 'coverage_pct'] },

  // GCUID
  GCUID_LINKED:               { code: 'ENG-040', event_type: 'gcuid.linked',                system: 'engineering', defaultLevel: 'info',    description: 'Engineering employee was linked to a GCUID.',                                               requiredFields: ['eng_employee_id', 'gcuid_linked'], outcome: 'success' },

  // Portal
  PORTAL_LOADED:              { code: 'ENG-050', event_type: 'portal.loaded',               system: 'engineering', defaultLevel: 'debug',   description: 'Engineering portal page was loaded in the browser.',                                        requiredFields: ['session_id'] },

} as const satisfies Record<string, LogEventDef>;

// ─── §6  Finance Department ───────────────────────────────────────────────────

export const FINANCE_EVENTS = {

  // Employee operations
  EMPLOYEE_LISTED:            { code: 'FIN-001', event_type: 'employee.listed',             system: 'finance', defaultLevel: 'debug',   description: 'Finance employee list was retrieved.',                                                          requiredFields: ['actor_id'] },
  EMPLOYEE_VIEWED:            { code: 'FIN-002', event_type: 'employee.viewed',             system: 'finance', defaultLevel: 'debug',   description: 'A single finance employee record was retrieved.',                                               requiredFields: ['fin_employee_id', 'actor_id'] },
  EMPLOYEE_SEARCHED:          { code: 'FIN-003', event_type: 'employee.searched',           system: 'finance', defaultLevel: 'debug',   description: 'A search query was executed against the finance employee dataset.',                             requiredFields: ['actor_id'] },
  EMPLOYEE_CREATED:           { code: 'FIN-004', event_type: 'employee.created',            system: 'finance', defaultLevel: 'notice',  description: 'A new finance employee record was created.',                                                   requiredFields: ['fin_employee_id', 'actor_id', 'cost_centre'], outcome: 'success' },
  EMPLOYEE_UPDATED:           { code: 'FIN-005', event_type: 'employee.updated',            system: 'finance', defaultLevel: 'notice',  description: 'A finance employee record was updated.',                                                       requiredFields: ['fin_employee_id', 'actor_id'] },
  EMPLOYEE_DELETED:           { code: 'FIN-006', event_type: 'employee.deleted',            system: 'finance', defaultLevel: 'notice',  description: 'A finance employee record was deleted.',                                                       requiredFields: ['fin_employee_id', 'actor_id'] },
  EMPLOYEE_NOT_FOUND:         { code: 'FIN-007', event_type: 'employee.not_found',          system: 'finance', defaultLevel: 'info',    description: 'A lookup for a specific finance employee returned no result.',                                  requiredFields: ['fin_employee_id', 'actor_id'], outcome: 'failure' },

  // Financial records
  FINANCIAL_RECORD_CREATED:   { code: 'FIN-010', event_type: 'financial_record.created',    system: 'finance', defaultLevel: 'notice',  description: 'A financial record (cost centre, budget code, etc.) was created.',                             requiredFields: ['actor_id', 'financial_record_type', 'cost_centre'] },
  FINANCIAL_RECORD_UPDATED:   { code: 'FIN-011', event_type: 'financial_record.updated',    system: 'finance', defaultLevel: 'notice',  description: 'A financial record was updated.',                                                              requiredFields: ['actor_id', 'financial_record_type', 'cost_centre'] },
  FINANCIAL_RECORD_VIEWED:    { code: 'FIN-012', event_type: 'financial_record.viewed',     system: 'finance', defaultLevel: 'debug',   description: 'A financial record was retrieved.',                                                             requiredFields: ['actor_id', 'financial_record_type'] },

  // Cache
  CACHE_READ:                 { code: 'FIN-020', event_type: 'cache.read',                  system: 'finance', defaultLevel: 'debug',   description: 'Finance cache was read.',                                                                       requiredFields: ['cache_operation', 'cache_mode'] },
  CACHE_WRITE:                { code: 'FIN-021', event_type: 'cache.write',                 system: 'finance', defaultLevel: 'debug',   description: 'Finance cache was written.',                                                                    requiredFields: ['cache_operation', 'records_affected'] },
  CACHE_MISS:                 { code: 'FIN-022', event_type: 'cache.miss',                  system: 'finance', defaultLevel: 'debug',   description: 'Finance cache miss — falling back to authoritative source.',                                    requiredFields: ['cache_operation'] },
  CACHE_INVALIDATED:          { code: 'FIN-023', event_type: 'cache.invalidated',           system: 'finance', defaultLevel: 'info',    description: 'Finance department cache was explicitly invalidated.',                                          requiredFields: ['actor_id'] },
  CACHE_EXPIRED:              { code: 'FIN-024', event_type: 'cache.expired',               system: 'finance', defaultLevel: 'debug',   description: 'Finance cache entry reached TTL and was purged.',                                               requiredFields: [] },
  CACHE_POLICY_VIOLATED:      { code: 'FIN-025', event_type: 'cache.policy_violated',       system: 'finance', defaultLevel: 'error',   description: 'A read was attempted when cache policy requires a live pull that is unavailable.',               requiredFields: ['cache_mode', 'error_detail'], outcome: 'failure' },

  // Sync
  SYNC_STARTED:               { code: 'FIN-030', event_type: 'sync.started',                system: 'finance', defaultLevel: 'info',    description: 'Finance connector sync job started.',                                                           requiredFields: [] },
  SYNC_COMPLETED:             { code: 'FIN-031', event_type: 'sync.completed',              system: 'finance', defaultLevel: 'info',    description: 'Finance connector sync job completed.',                                                         requiredFields: ['records_affected', 'duration_ms'], outcome: 'success' },
  SYNC_FAILED:                { code: 'FIN-032', event_type: 'sync.failed',                 system: 'finance', defaultLevel: 'error',   description: 'Finance connector sync job failed.',                                                            requiredFields: ['error_code', 'error_detail'], outcome: 'failure' },

  // Coverage
  COVERAGE_CALCULATED:        { code: 'FIN-040', event_type: 'coverage.calculated',         system: 'finance', defaultLevel: 'debug',   description: 'GCUID coverage score was calculated for a finance employee.',                                   requiredFields: ['fin_employee_id', 'coverage_score', 'coverage_pct'] },

  // GCUID
  GCUID_LINKED:               { code: 'FIN-050', event_type: 'gcuid.linked',                system: 'finance', defaultLevel: 'info',    description: 'Finance employee was linked to a GCUID.',                                                      requiredFields: ['fin_employee_id', 'gcuid_linked'], outcome: 'success' },

  // Portal
  PORTAL_LOADED:              { code: 'FIN-060', event_type: 'portal.loaded',               system: 'finance', defaultLevel: 'debug',   description: 'Finance portal page was loaded in the browser.',                                               requiredFields: ['session_id'] },

} as const satisfies Record<string, LogEventDef>;

// ─── §7  General / Infrastructure ────────────────────────────────────────────

export const SYSTEM_EVENTS = {

  // Server lifecycle
  SERVER_STARTED:             { code: 'SYS-001', event_type: 'server.started',              system: 'system', defaultLevel: 'notice',  description: 'API server process started and is listening.',                                                  requiredFields: ['service_name', 'service_version', 'host', 'port'], outcome: 'success' },
  SERVER_READY:               { code: 'SYS-002', event_type: 'server.ready',                system: 'system', defaultLevel: 'notice',  description: 'Server completed startup and all subsystems are initialised.',                                  requiredFields: ['service_name', 'host', 'port'], outcome: 'success' },
  SERVER_STOPPING:            { code: 'SYS-003', event_type: 'server.stopping',             system: 'system', defaultLevel: 'notice',  description: 'Server received shutdown signal and is draining connections.',                                  requiredFields: ['service_name'] },
  SERVER_STOPPED:             { code: 'SYS-004', event_type: 'server.stopped',              system: 'system', defaultLevel: 'notice',  description: 'Server process exited cleanly.',                                                                requiredFields: ['service_name', 'duration_ms'] },
  SERVER_CRASH:               { code: 'SYS-005', event_type: 'server.crash',                system: 'system', defaultLevel: 'emergency', description: 'Server process crashed unexpectedly.',                                                      requiredFields: ['service_name', 'error_code', 'error_detail'] },

  // HTTP request pipeline
  HTTP_REQUEST:               { code: 'SYS-010', event_type: 'http.request',                system: 'system', defaultLevel: 'debug',   description: 'An HTTP request was received.',                                                                 requiredFields: ['http_method', 'http_path', 'request_id', 'ip_address'] },
  HTTP_RESPONSE:              { code: 'SYS-011', event_type: 'http.response',               system: 'system', defaultLevel: 'debug',   description: 'An HTTP response was sent.',                                                                    requiredFields: ['http_method', 'http_path', 'http_status', 'duration_ms', 'request_id'] },
  HTTP_4XX:                   { code: 'SYS-012', event_type: 'http.error_4xx',              system: 'system', defaultLevel: 'info',    description: 'A 4xx client-error response was returned.',                                                    requiredFields: ['http_method', 'http_path', 'http_status', 'request_id', 'ip_address'] },
  HTTP_5XX:                   { code: 'SYS-013', event_type: 'http.error_5xx',              system: 'system', defaultLevel: 'error',   description: 'A 5xx server-error response was returned.',                                                    requiredFields: ['http_method', 'http_path', 'http_status', 'request_id', 'error_detail'] },
  HTTP_SLOW_REQUEST:          { code: 'SYS-014', event_type: 'http.slow_request',           system: 'system', defaultLevel: 'warning', description: 'An HTTP request exceeded the slow-request threshold.',                                          requiredFields: ['http_method', 'http_path', 'http_status', 'duration_ms', 'request_id'] },
  CORS_BLOCKED:               { code: 'SYS-015', event_type: 'http.cors_blocked',           system: 'system', defaultLevel: 'warning', description: 'A CORS preflight or request was blocked by policy.',                                            requiredFields: ['http_path', 'ip_address', 'user_agent'], outcome: 'failure' },

  // Connector management (infra level)
  CONNECTOR_ENABLED:          { code: 'SYS-020', event_type: 'connector.enabled',           system: 'system', defaultLevel: 'notice',  description: 'A connector was enabled via the connectors API.',                                               requiredFields: ['target_id', 'actor_id'] },
  CONNECTOR_DISABLED:         { code: 'SYS-021', event_type: 'connector.disabled',          system: 'system', defaultLevel: 'notice',  description: 'A connector was disabled via the connectors API.',                                              requiredFields: ['target_id', 'actor_id'] },
  CONNECTOR_CONFIG_LOADED:    { code: 'SYS-022', event_type: 'connector.config_loaded',     system: 'system', defaultLevel: 'debug',   description: 'Connector configuration was loaded from disk.',                                                 requiredFields: ['target_id'] },
  CONNECTOR_CONFIG_INVALID:   { code: 'SYS-023', event_type: 'connector.config_invalid',    system: 'system', defaultLevel: 'error',   description: 'Connector configuration file is malformed or missing required fields.',                         requiredFields: ['target_id', 'error_detail'], outcome: 'failure' },
  CONNECTOR_RESOLVER_FAILED:  { code: 'SYS-024', event_type: 'connector.resolver_failed',   system: 'system', defaultLevel: 'error',   description: 'The connector resolver could not resolve a connector for a given system ID.',                   requiredFields: ['target_id', 'error_detail'], outcome: 'failure' },

  // Feature flags
  FLAG_READ:                  { code: 'SYS-030', event_type: 'flag.read',                   system: 'system', defaultLevel: 'debug',   description: 'A feature flag value was read.',                                                                requiredFields: ['flag_name'] },
  FLAG_CHANGED:               { code: 'SYS-031', event_type: 'flag.changed',                system: 'system', defaultLevel: 'notice',  description: 'A feature flag was toggled on or off.',                                                         requiredFields: ['flag_name', 'flag_value_before', 'flag_value_after', 'actor_id'] },
  FLAG_FILE_INVALID:          { code: 'SYS-032', event_type: 'flag.file_invalid',           system: 'system', defaultLevel: 'error',   description: 'The feature flags JSON file could not be read or parsed.',                                       requiredFields: ['error_detail'], outcome: 'failure' },

  // Configuration
  CONFIG_LOADED:              { code: 'SYS-040', event_type: 'config.loaded',               system: 'system', defaultLevel: 'info',    description: 'Application configuration was loaded at startup.',                                              requiredFields: ['service_name'] },
  CONFIG_INVALID:             { code: 'SYS-041', event_type: 'config.invalid',              system: 'system', defaultLevel: 'critical', description: 'Application configuration is invalid; service cannot start.',                                 requiredFields: ['config_key', 'error_detail'], outcome: 'failure' },
  CONFIG_RELOADED:            { code: 'SYS-042', event_type: 'config.reloaded',             system: 'system', defaultLevel: 'notice',  description: 'Application configuration was reloaded at runtime.',                                            requiredFields: ['actor_id'] },

  // Session
  SESSION_CREATED:            { code: 'SYS-050', event_type: 'session.created',             system: 'system', defaultLevel: 'info',    description: 'A new authenticated session was created.',                                                       requiredFields: ['session_id', 'actor_id', 'ip_address'] },
  SESSION_EXPIRED:            { code: 'SYS-051', event_type: 'session.expired',             system: 'system', defaultLevel: 'info',    description: 'A session expired naturally (TTL reached).',                                                    requiredFields: ['session_id', 'actor_id'] },
  SESSION_REVOKED:            { code: 'SYS-052', event_type: 'session.revoked',             system: 'system', defaultLevel: 'notice',  description: 'A session was explicitly revoked (logout or admin action).',                                    requiredFields: ['session_id', 'actor_id'] },
  SESSION_INVALID:            { code: 'SYS-053', event_type: 'session.invalid',             system: 'system', defaultLevel: 'warning', description: 'A request was received with an invalid or unrecognised session token.',                         requiredFields: ['ip_address', 'request_id'], outcome: 'failure' },

  // Error handling
  ERROR_UNHANDLED:            { code: 'SYS-060', event_type: 'error.unhandled',             system: 'system', defaultLevel: 'critical', description: 'An unhandled exception reached the error middleware.',                                         requiredFields: ['request_id', 'error_code', 'error_detail'] },
  ERROR_VALIDATION:           { code: 'SYS-061', event_type: 'error.validation',            system: 'system', defaultLevel: 'warning', description: 'A request failed input validation at the middleware boundary.',                                 requiredFields: ['http_path', 'request_id', 'error_detail'], outcome: 'failure' },
  ERROR_DB:                   { code: 'SYS-062', event_type: 'error.database',              system: 'system', defaultLevel: 'error',   description: 'A database operation failed.',                                                                  requiredFields: ['error_code', 'error_detail'], outcome: 'failure' },

  // Health + metrics
  HEALTH_CHECK:               { code: 'SYS-070', event_type: 'health.check',                system: 'system', defaultLevel: 'debug',   description: 'The /health endpoint was called.',                                                              requiredFields: ['service_name', 'outcome'] },
  METRICS_SAMPLED:            { code: 'SYS-071', event_type: 'metrics.sampled',             system: 'system', defaultLevel: 'debug',   description: 'Resource metrics (memory, CPU, connections) were sampled.',                                     requiredFields: ['service_name', 'memory_mb', 'cpu_percent'] },
  METRICS_THRESHOLD_EXCEEDED: { code: 'SYS-072', event_type: 'metrics.threshold_exceeded',  system: 'system', defaultLevel: 'alarm',   description: 'A resource metric exceeded the configured alert threshold.',                                   requiredFields: ['service_name', 'memory_mb', 'cpu_percent', 'context'] },

  // Dept cache (infrastructure level)
  DEPT_CACHE_INIT:            { code: 'SYS-080', event_type: 'dept_cache.init',             system: 'system', defaultLevel: 'info',    description: 'Department cache was initialised for a system.',                                                requiredFields: ['target_id'] },
  DEPT_CACHE_CORRUPT:         { code: 'SYS-081', event_type: 'dept_cache.corrupt',          system: 'system', defaultLevel: 'alarm',   description: 'Department cache data integrity check failed.',                                                 requiredFields: ['target_id', 'error_detail'], outcome: 'failure' },

} as const satisfies Record<string, LogEventDef>;

// ─── Combined catalogue ───────────────────────────────────────────────────────

export const ALL_EVENTS = {
  ...REGISTRY_EVENTS,
  ...CAES_EVENTS,
  ...HR_EVENTS,
  ...LDAP_EVENTS,
  ...ENGINEERING_EVENTS,
  ...FINANCE_EVENTS,
  ...SYSTEM_EVENTS,
} as const;

/** Look up an event definition by its code string (e.g. 'REG-001'). */
export function getEventByCode(code: string): LogEventDef | undefined {
  return Object.values(ALL_EVENTS).find(e => e.code === code);
}

/** Look up an event definition by its event_type slug (e.g. 'identity.created'). */
export function getEventByType(event_type: string): LogEventDef | undefined {
  return Object.values(ALL_EVENTS).find(e => e.event_type === event_type);
}
