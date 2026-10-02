/**
 * User Commands - End User Identity Queries
 * 
 * These commands are used by regular employees to look up
 * identity information about themselves or colleagues.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import Database from 'better-sqlite3';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const REGISTRY_DB = path.join(DATA_DIR, 'registry.db');

export function registerUserCommands(program: Command): void {
  const user = program
    .command('user')
    .description('End user commands for identity lookup');

  // user lookup <id>
  user
    .command('lookup <id>')
    .description('Look up identity by employee ID, email, or GCUID')
    .option('-f, --format <format>', 'Output format (table|json)', 'table')
    .action(async (id: string, options: { format: string }) => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        // Try to find identity by various fields
        let identity;
        
        if (id.startsWith('urn:gcuid:')) {
          // GCUID lookup
          identity = db.prepare(`
            SELECT * FROM identities WHERE gcuid = ?
          `).get(id);
        } else if (id.includes('@')) {
          // Email lookup
          identity = db.prepare(`
            SELECT * FROM identities 
            WHERE json_extract(metadata, '$.email') = ?
          `).get(id);
        } else {
          // Entity ID lookup
          identity = db.prepare(`
            SELECT * FROM identities WHERE entity_id = ?
          `).get(id);
        }
        
        db.close();
        
        if (!identity) {
          console.log(chalk.yellow(`⚠️  No identity found for: ${id}`));
          return;
        }
        
        if (options.format === 'json') {
          console.log(JSON.stringify(identity, null, 2));
          return;
        }
        
        // Table output
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
          ['Email', metadata.email || 'N/A'],
          ['Name', metadata.name || 'N/A'],
          ['Source', metadata.source || 'N/A'],
          ['Created', new Date(identity.created_at).toLocaleString()],
          ['Updated', new Date(identity.updated_at).toLocaleString()]
        );
        
        console.log(table.toString());
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // user search <query>
  user
    .command('search <query>')
    .description('Search for identities by name or email')
    .option('-l, --limit <n>', 'Maximum results', '10')
    .option('-f, --format <format>', 'Output format (table|json)', 'table')
    .action(async (query: string, options: { limit: string; format: string }) => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        const identities = db.prepare(`
          SELECT * FROM identities 
          WHERE json_extract(metadata, '$.name') LIKE ?
             OR json_extract(metadata, '$.email') LIKE ?
             OR entity_id LIKE ?
          LIMIT ?
        `).all(`%${query}%`, `%${query}%`, `%${query}%`, parseInt(options.limit));
        
        db.close();
        
        if (identities.length === 0) {
          console.log(chalk.yellow(`⚠️  No identities found matching: ${query}`));
          return;
        }
        
        if (options.format === 'json') {
          console.log(JSON.stringify(identities, null, 2));
          return;
        }
        
        // Table output
        const table = new Table({
          head: [
            chalk.cyan('Entity ID'),
            chalk.cyan('Name'),
            chalk.cyan('Email'),
            chalk.cyan('State'),
            chalk.cyan('GCUID')
          ],
          colWidths: [15, 20, 30, 12, 30]
        });
        
        for (const identity of identities) {
          const metadata = identity.metadata ? JSON.parse(identity.metadata) : {};
          table.push([
            identity.entity_id || 'N/A',
            metadata.name || 'N/A',
            metadata.email || 'N/A',
            formatState(identity.state),
            identity.gcuid.substring(10, 25) + '...'
          ]);
        }
        
        console.log(table.toString());
        console.log(chalk.gray(`\nFound ${identities.length} result(s)`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // user history <gcuid>
  user
    .command('history <gcuid>')
    .description('View state transition history for an identity')
    .option('-f, --format <format>', 'Output format (table|json)', 'table')
    .action(async (gcuid: string, options: { format: string }) => {
      try {
        const db = new Database(REGISTRY_DB, { readonly: true });
        
        const history = db.prepare(`
          SELECT * FROM state_history 
          WHERE gcuid = ?
          ORDER BY timestamp ASC
        `).all(gcuid);
        
        db.close();
        
        if (history.length === 0) {
          console.log(chalk.yellow(`⚠️  No history found for: ${gcuid}`));
          return;
        }
        
        if (options.format === 'json') {
          console.log(JSON.stringify(history, null, 2));
          return;
        }
        
        // Table output
        const table = new Table({
          head: [
            chalk.cyan('Timestamp'),
            chalk.cyan('From'),
            chalk.cyan('To'),
            chalk.cyan('Type'),
            chalk.cyan('Reason')
          ],
          colWidths: [22, 15, 15, 12, 30]
        });
        
        for (const entry of history) {
          table.push([
            new Date(entry.timestamp).toLocaleString(),
            entry.from_state || '(none)',
            entry.to_state,
            entry.transition_type,
            entry.reason || 'N/A'
          ]);
        }
        
        console.log(chalk.bold(`\nState History for ${gcuid}\n`));
        console.log(table.toString());
        console.log(chalk.gray(`\n${history.length} transition(s)`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // user verify <gcuid>
  user
    .command('verify <gcuid>')
    .description('Verify GCUID format and check if active')
    .action(async (gcuid: string) => {
      try {
        // Format validation
        const v2Pattern = /^urn:gcuid:[0-9A-HJKMNP-TV-Z]{26}$/;
        const isValidFormat = v2Pattern.test(gcuid);
        
        console.log(chalk.bold('\n🔍 GCUID Verification\n'));
        console.log(`GCUID: ${chalk.cyan(gcuid)}`);
        console.log(`Format: ${isValidFormat ? chalk.green('✓ Valid V2') : chalk.red('✗ Invalid')}`);
        
        if (!isValidFormat) {
          console.log(chalk.yellow('\n⚠️  Invalid GCUID format'));
          return;
        }
        
        // Check registry
        const db = new Database(REGISTRY_DB, { readonly: true });
        const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid);
        db.close();
        
        if (!identity) {
          console.log(`Registry: ${chalk.yellow('⚠️  Not found in registry')}`);
          return;
        }
        
        console.log(`Registry: ${chalk.green('✓ Found')}`);
        console.log(`State: ${formatState(identity.state)}`);
        console.log(`Entity ID: ${identity.entity_id || 'N/A'}`);
        
        if (identity.state === 'active') {
          console.log(chalk.green('\n✅ GCUID is valid and active'));
        } else {
          console.log(chalk.yellow(`\n⚠️  GCUID exists but state is: ${identity.state}`));
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
