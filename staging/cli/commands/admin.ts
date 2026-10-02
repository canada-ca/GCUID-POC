/**
 * Admin Commands - Central Registry Administrator Functions
 * 
 * These commands are used by central administrators to:
 * - Manage the central GCUID registry
 * - Approve/review identities
 * - Detect and resolve duplicates
 * - Monitor system-wide activity
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import Database from 'better-sqlite3';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const REGISTRY_DB = path.join(DATA_DIR, 'registry.db');

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command('admin')
    .description('Central administrator commands for registry management');

  // admin list
  admin
    .command('list')
    .description('List all identities in the registry')
    .option('-s, --state <state>', 'Filter by state')
    .option('-l, --limit <n>', 'Maximum results', '50')
    .option('-f, --format <format>', 'Output format (table|json)', 'table')
    .action(async (options: { state?: string; limit: string; format: string }) => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        let query = 'SELECT * FROM identities';
        const params: any[] = [];
        
        if (options.state) {
          query += ' WHERE state = ?';
          params.push(options.state);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(options.limit));
        
        const identities = db.prepare(query).all(...params);
        db.close();
        
        if (options.format === 'json') {
          console.log(JSON.stringify(identities, null, 2));
          return;
        }
        
        const table = new Table({
          head: [
            chalk.cyan('Entity ID'),
            chalk.cyan('State'),
            chalk.cyan('Type'),
            chalk.cyan('GCUID'),
            chalk.cyan('Created')
          ],
          colWidths: [15, 15, 10, 32, 20]
        });
        
        for (const identity of identities) {
          table.push([
            identity.entity_id || 'N/A',
            formatState(identity.state),
            identity.entity_type || 'N/A',
            identity.gcuid.substring(10, 25) + '...',
            new Date(identity.created_at).toLocaleDateString()
          ]);
        }
        
        console.log(table.toString());
        console.log(chalk.gray(`\n${identities.length} identit${identities.length === 1 ? 'y' : 'ies'}`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // admin view <gcuid>
  admin
    .command('view <gcuid>')
    .description('View detailed information about an identity')
    .option('--with-history', 'Include state history')
    .action(async (gcuid: string, options: { withHistory: boolean }) => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid);
        
        if (!identity) {
          console.log(chalk.yellow(`⚠️  Identity not found: ${gcuid}`));
          db.close();
          return;
        }
        
        const table = new Table({
          head: [chalk.cyan('Field'), chalk.cyan('Value')],
          colWidths: [20, 60]
        });
        
        const metadata = identity.metadata ? JSON.parse(identity.metadata) : {};
        
        table.push(
          ['GCUID', chalk.green(identity.gcuid)],
          ['Entity ID', identity.entity_id || 'N/A'],
          ['Entity Type', identity.entity_type || 'N/A'],
          ['State', formatState(identity.state)],
          ['Created', new Date(identity.created_at).toLocaleString()],
          ['Updated', new Date(identity.updated_at).toLocaleString()]
        );
        
        if (Object.keys(metadata).length > 0) {
          table.push(['─────────────', '─────────────────────────────────']);
          for (const [key, value] of Object.entries(metadata)) {
            table.push([`Metadata: ${key}`, String(value)]);
          }
        }
        
        console.log(table.toString());
        
        if (options.withHistory) {
          const history = db.prepare(`
            SELECT * FROM state_history 
            WHERE gcuid = ?
            ORDER BY timestamp ASC
          `).all(gcuid);
          
          if (history.length > 0) {
            console.log(chalk.bold('\n📜 State History\n'));
            
            const histTable = new Table({
              head: [chalk.cyan('Time'), chalk.cyan('From'), chalk.cyan('To'), chalk.cyan('Reason')],
              colWidths: [22, 15, 15, 35]
            });
            
            for (const entry of history) {
              histTable.push([
                new Date(entry.timestamp).toLocaleString(),
                entry.from_state || '(none)',
                entry.to_state,
                entry.reason || 'N/A'
              ]);
            }
            
            console.log(histTable.toString());
          }
        }
        
        db.close();
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // admin approve <gcuid>
  admin
    .command('approve <gcuid>')
    .description('Approve a provisional identity')
    .option('-r, --reason <reason>', 'Approval reason', 'Administrator approval')
    .action(async (gcuid: string, options: { reason: string }) => {
      try {
        const db = new Database(REGISTRY_DB);
        
        const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid);
        
        if (!identity) {
          console.log(chalk.yellow(`⚠️  Identity not found: ${gcuid}`));
          db.close();
          return;
        }
        
        if (identity.state !== 'provisional' && identity.state !== 'under_review') {
          console.log(chalk.yellow(`⚠️  Identity is not in provisional/under_review state (current: ${identity.state})`));
          db.close();
          return;
        }
        
        // Update state
        db.prepare(`
          UPDATE identities 
          SET state = 'active', updated_at = datetime('now')
          WHERE gcuid = ?
        `).run(gcuid);
        
        // Add history
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, timestamp)
          VALUES (?, ?, 'active', 'approve', ?, datetime('now'))
        `).run(gcuid, identity.state, options.reason);
        
        db.close();
        
        console.log(chalk.green(`✅ Identity approved: ${gcuid}`));
        console.log(chalk.gray(`   ${identity.state} → active`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // admin suspend <gcuid>
  admin
    .command('suspend <gcuid>')
    .description('Suspend an active identity')
    .option('-r, --reason <reason>', 'Suspension reason', 'Administrator suspension')
    .action(async (gcuid: string, options: { reason: string }) => {
      try {
        const db = new Database(REGISTRY_DB);
        
        const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid);
        
        if (!identity) {
          console.log(chalk.yellow(`⚠️  Identity not found: ${gcuid}`));
          db.close();
          return;
        }
        
        if (identity.state !== 'active') {
          console.log(chalk.yellow(`⚠️  Only active identities can be suspended (current: ${identity.state})`));
          db.close();
          return;
        }
        
        // Update state
        db.prepare(`
          UPDATE identities 
          SET state = 'suspended', updated_at = datetime('now')
          WHERE gcuid = ?
        `).run(gcuid);
        
        // Add history
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, timestamp)
          VALUES (?, 'active', 'suspended', 'suspend', ?, datetime('now'))
        `).run(gcuid, options.reason);
        
        db.close();
        
        console.log(chalk.yellow(`⚠️  Identity suspended: ${gcuid}`));
        console.log(chalk.gray(`   active → suspended`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // admin retire <gcuid>
  admin
    .command('retire <gcuid>')
    .description('Retire an identity (soft delete)')
    .option('-r, --reason <reason>', 'Retirement reason', 'Administrator retirement')
    .action(async (gcuid: string, options: { reason: string }) => {
      try {
        const db = new Database(REGISTRY_DB);
        
        const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid);
        
        if (!identity) {
          console.log(chalk.yellow(`⚠️  Identity not found: ${gcuid}`));
          db.close();
          return;
        }
        
        // Update state
        db.prepare(`
          UPDATE identities 
          SET state = 'retired', updated_at = datetime('now')
          WHERE gcuid = ?
        `).run(gcuid);
        
        // Add history
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, timestamp)
          VALUES (?, ?, 'retired', 'retire', ?, datetime('now'))
        `).run(gcuid, identity.state, options.reason);
        
        db.close();
        
        console.log(chalk.gray(`✓ Identity retired: ${gcuid}`));
        console.log(chalk.gray(`   ${identity.state} → retired`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // admin detect-duplicates
  admin
    .command('detect-duplicates')
    .description('Detect potential duplicate identities')
    .option('-t, --threshold <n>', 'Similarity threshold (0-100)', '80')
    .action(async (options: { threshold: string }) => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        // Simple duplicate detection based on entity_id or metadata
        const identities = db.prepare('SELECT * FROM identities WHERE state != ?').all('retired');
        
        const duplicates: any[] = [];
        const threshold = parseInt(options.threshold);
        
        // Check for exact entity_id matches
        const entityIdGroups = new Map<string, any[]>();
        for (const identity of identities) {
          if (identity.entity_id) {
            if (!entityIdGroups.has(identity.entity_id)) {
              entityIdGroups.set(identity.entity_id, []);
            }
            entityIdGroups.get(identity.entity_id)!.push(identity);
          }
        }
        
        for (const [entityId, group] of entityIdGroups) {
          if (group.length > 1) {
            duplicates.push({
              type: 'Exact Entity ID Match',
              confidence: 100,
              identities: group
            });
          }
        }
        
        db.close();
        
        if (duplicates.length === 0) {
          console.log(chalk.green('\n✅ No duplicates detected\n'));
          return;
        }
        
        console.log(chalk.bold(`\n⚠️  Found ${duplicates.length} potential duplicate group(s)\n`));
        
        for (let i = 0; i < duplicates.length; i++) {
          const dup = duplicates[i];
          console.log(chalk.bold(`Group ${i + 1}: ${dup.type} (${dup.confidence}% confidence)`));
          
          const table = new Table({
            head: [chalk.cyan('GCUID'), chalk.cyan('Entity ID'), chalk.cyan('State')],
            colWidths: [32, 15, 15]
          });
          
          for (const identity of dup.identities) {
            table.push([
              identity.gcuid.substring(10, 30) + '...',
              identity.entity_id,
              formatState(identity.state)
            ]);
          }
          
          console.log(table.toString());
          console.log('');
        }
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // admin stats
  admin
    .command('stats')
    .description('Show comprehensive registry statistics')
    .action(async () => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        const total = db.prepare('SELECT COUNT(*) as count FROM identities').get() as { count: number };
        const byState = db.prepare(`
          SELECT state, COUNT(*) as count 
          FROM identities 
          GROUP BY state
        `).all() as { state: string; count: number }[];
        
        const byType = db.prepare(`
          SELECT entity_type, COUNT(*) as count 
          FROM identities 
          WHERE entity_type IS NOT NULL
          GROUP BY entity_type
        `).all() as { entity_type: string; count: number }[];
        
        const recent24h = db.prepare(`
          SELECT COUNT(*) as count 
          FROM identities 
          WHERE created_at > datetime('now', '-24 hours')
        `).get() as { count: number };
        
        const transitions24h = db.prepare(`
          SELECT COUNT(*) as count 
          FROM state_history 
          WHERE timestamp > datetime('now', '-24 hours')
        `).get() as { count: number };
        
        db.close();
        
        console.log(chalk.bold('\n📊 Registry Statistics\n'));
        console.log(chalk.bold('='.repeat(60)));
        
        console.log(chalk.bold('\n📈 Overview\n'));
        console.log(`  Total Identities:      ${chalk.cyan(total.count.toString())}`);
        console.log(`  Created (24h):         ${chalk.cyan(recent24h.count.toString())}`);
        console.log(`  Transitions (24h):     ${chalk.cyan(transitions24h.count.toString())}`);
        
        if (byState.length > 0) {
          console.log(chalk.bold('\n📋 By State\n'));
          for (const state of byState) {
            const pct = Math.round((state.count / total.count) * 100);
            console.log(`  ${formatState(state.state).padEnd(20)} ${chalk.cyan(state.count.toString().padStart(5))}  (${pct}%)`);
          }
        }
        
        if (byType.length > 0) {
          console.log(chalk.bold('\n🏷️  By Entity Type\n'));
          for (const type of byType) {
            console.log(`  ${type.entity_type.padEnd(20)} ${chalk.cyan(type.count.toString())}`);
          }
        }
        
        console.log('\n' + chalk.bold('='.repeat(60)) + '\n');
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // admin search <query>
  admin
    .command('search <query>')
    .description('Search identities across all fields')
    .option('-l, --limit <n>', 'Maximum results', '20')
    .action(async (query: string, options: { limit: string }) => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        const identities = db.prepare(`
          SELECT * FROM identities 
          WHERE gcuid LIKE ?
             OR entity_id LIKE ?
             OR metadata LIKE ?
          LIMIT ?
        `).all(`%${query}%`, `%${query}%`, `%${query}%`, parseInt(options.limit));
        
        db.close();
        
        if (identities.length === 0) {
          console.log(chalk.yellow(`⚠️  No identities found matching: ${query}`));
          return;
        }
        
        const table = new Table({
          head: [chalk.cyan('GCUID'), chalk.cyan('Entity ID'), chalk.cyan('State'), chalk.cyan('Type')],
          colWidths: [32, 15, 15, 12]
        });
        
        for (const identity of identities) {
          table.push([
            identity.gcuid.substring(10, 30) + '...',
            identity.entity_id || 'N/A',
            formatState(identity.state),
            identity.entity_type || 'N/A'
          ]);
        }
        
        console.log(table.toString());
        console.log(chalk.gray(`\nFound ${identities.length} result(s)`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // admin audit <gcuid>
  admin
    .command('audit <gcuid>')
    .description('Show complete audit trail for an identity')
    .action(async (gcuid: string) => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid);
        
        if (!identity) {
          console.log(chalk.yellow(`⚠️  Identity not found: ${gcuid}`));
          db.close();
          return;
        }
        
        const history = db.prepare(`
          SELECT * FROM state_history 
          WHERE gcuid = ?
          ORDER BY timestamp ASC
        `).all(gcuid);
        
        db.close();
        
        console.log(chalk.bold('\n🔍 Audit Trail\n'));
        console.log(`GCUID: ${chalk.cyan(gcuid)}`);
        console.log(`Current State: ${formatState(identity.state)}`);
        console.log(`Created: ${new Date(identity.created_at).toLocaleString()}`);
        console.log('');
        
        if (history.length === 0) {
          console.log(chalk.gray('No history recorded'));
          return;
        }
        
        const table = new Table({
          head: [
            chalk.cyan('Timestamp'),
            chalk.cyan('Transition'),
            chalk.cyan('Type'),
            chalk.cyan('Reason')
          ],
          colWidths: [22, 25, 12, 35]
        });
        
        for (const entry of history) {
          const transition = entry.from_state 
            ? `${entry.from_state} → ${entry.to_state}`
            : `(new) → ${entry.to_state}`;
          
          table.push([
            new Date(entry.timestamp).toLocaleString(),
            transition,
            entry.transition_type,
            entry.reason || 'N/A'
          ]);
        }
        
        console.log(table.toString());
        console.log(chalk.gray(`\n${history.length} event(s) in audit trail`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // admin health
  admin
    .command('health')
    .description('Check registry health and integrity')
    .action(async () => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        // Run health checks
        const checks = [];
        
        // Check 1: Registry accessible
        checks.push({ name: 'Registry accessible', passed: true });
        
        // Check 2: Valid GCUID format
        const invalidGcuids = db.prepare(`
          SELECT COUNT(*) as count FROM identities 
          WHERE gcuid NOT LIKE 'urn:gcuid:%'
        `).get() as { count: number };
        checks.push({ 
          name: 'All GCUIDs have valid format', 
          passed: invalidGcuids.count === 0,
          details: invalidGcuids.count > 0 ? `${invalidGcuids.count} invalid` : undefined
        });
        
        // Check 3: No orphaned state history
        const orphanedHistory = db.prepare(`
          SELECT COUNT(*) as count FROM state_history 
          WHERE gcuid NOT IN (SELECT gcuid FROM identities)
        `).get() as { count: number };
        checks.push({
          name: 'No orphaned history records',
          passed: orphanedHistory.count === 0,
          details: orphanedHistory.count > 0 ? `${orphanedHistory.count} orphaned` : undefined
        });
        
        db.close();
        
        console.log(chalk.bold('\n💚 Registry Health Check\n'));
        
        let allPassed = true;
        for (const check of checks) {
          const status = check.passed ? chalk.green('✓') : chalk.red('✗');
          const details = check.details ? chalk.gray(` (${check.details})`) : '';
          console.log(`${status} ${check.name}${details}`);
          if (!check.passed) allPassed = false;
        }
        
        console.log('');
        if (allPassed) {
          console.log(chalk.green('✅ All health checks passed'));
        } else {
          console.log(chalk.yellow('⚠️  Some health checks failed'));
        }
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });
}

function formatState(state: string): string {
  const colors: Record<string, string> = {
    'active': chalk.green(state),
    'provisional': chalk.yellow(state),
    'under_review': chalk.yellow(state),
    'suspended': chalk.red(state),
    'retired': chalk.gray(state),
    'archived': chalk.gray(state)
  };
  return colors[state] || state;
}
