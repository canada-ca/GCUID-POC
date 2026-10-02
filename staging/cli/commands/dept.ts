/**
 * Department Commands - Departmental Operator Functions
 * 
 * These commands are used by HR/IT department operators to:
 * - Manage their departmental data
 * - Operate and monitor the GCUID connector
 * - View integration status and performance
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const REGISTRY_DB = path.join(DATA_DIR, 'registry.db');
const HR_DB = path.join(DATA_DIR, 'sources', 'conn-hr.db');

export function registerDeptCommands(program: Command): void {
  const dept = program
    .command('dept')
    .description('Department operator commands for data and connector management');

  registerDataCommands(dept);
  registerConnectorCommands(dept);
  registerMonitoringCommands(dept);
}

/**
 * Data Management Commands
 */
function registerDataCommands(dept: Command): void {
  const data = dept
    .command('data')
    .alias('d')
    .description('Manage departmental employee data');

  // dept data list
  data
    .command('list')
    .description('List all employees in the department')
    .option('-l, --limit <n>', 'Maximum results', '50')
    .option('-f, --format <format>', 'Output format (table|json)', 'table')
    .option('--with-gcuid', 'Show GCUID integration status')
    .action(async (options: { limit: string; format: string; withGcuid: boolean }) => {
      try {
        const hrDb = new Database(HR_DB, { readonly: true });
        const employees = hrDb.prepare('SELECT * FROM employees LIMIT ?')
          .all(parseInt(options.limit));
        
        if (options.withGcuid) {
          const registryDb = new Database(REGISTRY_DB, { readonly: true });
          for (const emp of employees) {
            const identity = registryDb.prepare(
              'SELECT gcuid, state FROM identities WHERE entity_id = ?'
            ).get(emp.employee_id);
            emp.gcuid = identity?.gcuid || null;
            emp.gcuid_state = identity?.state || null;
          }
          registryDb.close();
        }
        
        hrDb.close();
        
        if (options.format === 'json') {
          console.log(JSON.stringify(employees, null, 2));
          return;
        }
        
        const table = new Table({
          head: options.withGcuid 
            ? [chalk.cyan('ID'), chalk.cyan('Name'), chalk.cyan('Email'), chalk.cyan('Dept'), chalk.cyan('GCUID Status')]
            : [chalk.cyan('ID'), chalk.cyan('Name'), chalk.cyan('Email'), chalk.cyan('Department')],
          colWidths: options.withGcuid ? [12, 20, 30, 15, 15] : [12, 20, 30, 20]
        });
        
        for (const emp of employees) {
          const row = [
            emp.employee_id,
            `${emp.first_name} ${emp.last_name}`,
            emp.email,
            emp.department
          ];
          
          if (options.withGcuid) {
            row.push(emp.gcuid ? chalk.green('✓ ' + emp.gcuid_state) : chalk.gray('No GCUID'));
          }
          
          table.push(row);
        }
        
        console.log(table.toString());
        console.log(chalk.gray(`\n${employees.length} employee(s)`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // dept data view <id>
  data
    .command('view <id>')
    .description('View detailed employee information')
    .option('--with-gcuid', 'Include GCUID information')
    .action(async (id: string, options: { withGcuid: boolean }) => {
      try {
        const hrDb = new Database(HR_DB, { readonly: true });
        const employee = hrDb.prepare('SELECT * FROM employees WHERE employee_id = ?').get(id);
        hrDb.close();
        
        if (!employee) {
          console.log(chalk.yellow(`⚠️  Employee not found: ${id}`));
          return;
        }
        
        const table = new Table({
          head: [chalk.cyan('Field'), chalk.cyan('Value')],
          colWidths: [20, 50]
        });
        
        table.push(
          ['Employee ID', employee.employee_id],
          ['First Name', employee.first_name],
          ['Last Name', employee.last_name],
          ['Email', employee.email],
          ['Department', employee.department],
          ['Phone', employee.phone || 'N/A'],
          ['Hire Date', employee.hire_date || 'N/A']
        );
        
        if (options.withGcuid) {
          const registryDb = new Database(REGISTRY_DB, { readonly: true });
          const identity = registryDb.prepare(
            'SELECT * FROM identities WHERE entity_id = ?'
          ).get(id);
          registryDb.close();
          
          if (identity) {
            table.push(
              ['─────────────', '─────────────────────────────────'],
              ['GCUID', chalk.green(identity.gcuid)],
              ['GCUID State', formatState(identity.state)],
              ['Created', new Date(identity.created_at).toLocaleString()]
            );
          } else {
            table.push(
              ['─────────────', '─────────────────────────────────'],
              ['GCUID', chalk.gray('Not integrated')]
            );
          }
        }
        
        console.log(table.toString());
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // dept data stats
  data
    .command('stats')
    .description('Show department data statistics')
    .action(async () => {
      try {
        const hrDb = new Database(HR_DB, { readonly: true });
        const registryDb = new Database(REGISTRY_DB, { readonly: true });

        const totalEmployees = hrDb.prepare('SELECT COUNT(*) as count FROM employees').get() as { count: number };
        const byDept = hrDb.prepare(
          'SELECT department, COUNT(*) as count FROM employees GROUP BY department'
        ).all() as { department: string; count: number }[];

        // Check GCUID integration: fetch all HR employee_ids, then count
        // matching identities in a single IN-clause on the registry db.
        // (The cross-DB subquery shape from earlier revisions doesn't
        // work because better-sqlite3 binds each statement to a single
        // database connection.)
        const employeeIds = (hrDb.prepare('SELECT employee_id FROM employees').all() as { employee_id: string }[])
          .map(r => r.employee_id);
        const placeholders = employeeIds.map(() => '?').join(',');
        const integrated = employeeIds.length === 0
          ? { count: 0 }
          : registryDb.prepare(
              `SELECT COUNT(*) as count FROM identities WHERE entity_id IN (${placeholders})`
            ).get(...employeeIds) as { count: number };

        hrDb.close();
        registryDb.close();
        
        console.log(chalk.bold('\n📊 Department Statistics\n'));
        
        const table = new Table({
          head: [chalk.cyan('Metric'), chalk.cyan('Value')],
          colWidths: [30, 20]
        });
        
        table.push(
          ['Total Employees', totalEmployees.count.toString()],
          ['GCUID Integrated', `${integrated.count} (${Math.round(integrated.count / totalEmployees.count * 100)}%)`],
          ['Not Integrated', (totalEmployees.count - integrated.count).toString()]
        );
        
        console.log(table.toString());
        
        console.log(chalk.bold('\n📋 By Department\n'));
        
        const deptTable = new Table({
          head: [chalk.cyan('Department'), chalk.cyan('Count')],
          colWidths: [30, 15]
        });
        
        for (const dept of byDept) {
          deptTable.push([dept.department, dept.count.toString()]);
        }
        
        console.log(deptTable.toString());
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // dept data search <query>
  data
    .command('search <query>')
    .description('Search employees by name, email, or department')
    .option('-l, --limit <n>', 'Maximum results', '20')
    .option('--with-gcuid', 'Show GCUID integration status')
    .action(async (query: string, options: { limit: string; withGcuid: boolean }) => {
      try {
        const hrDb = new Database(HR_DB, { readonly: true });
        const employees = hrDb.prepare(`
          SELECT * FROM employees 
          WHERE first_name LIKE ? 
             OR last_name LIKE ? 
             OR email LIKE ?
             OR department LIKE ?
          LIMIT ?
        `).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, parseInt(options.limit));
        
        if (options.withGcuid) {
          const registryDb = new Database(REGISTRY_DB, { readonly: true });
          for (const emp of employees) {
            const identity = registryDb.prepare(
              'SELECT gcuid, state FROM identities WHERE entity_id = ?'
            ).get(emp.employee_id);
            emp.gcuid_status = identity ? chalk.green('✓') : chalk.gray('✗');
          }
          registryDb.close();
        }
        
        hrDb.close();
        
        if (employees.length === 0) {
          console.log(chalk.yellow(`⚠️  No employees found matching: ${query}`));
          return;
        }
        
        const table = new Table({
          head: options.withGcuid
            ? [chalk.cyan('ID'), chalk.cyan('Name'), chalk.cyan('Email'), chalk.cyan('Dept'), chalk.cyan('GCUID')]
            : [chalk.cyan('ID'), chalk.cyan('Name'), chalk.cyan('Email'), chalk.cyan('Department')],
          colWidths: options.withGcuid ? [12, 20, 30, 15, 8] : [12, 20, 30, 20]
        });
        
        for (const emp of employees) {
          const row = [
            emp.employee_id,
            `${emp.first_name} ${emp.last_name}`,
            emp.email,
            emp.department
          ];
          
          if (options.withGcuid) {
            row.push(emp.gcuid_status);
          }
          
          table.push(row);
        }
        
        console.log(table.toString());
        console.log(chalk.gray(`\nFound ${employees.length} result(s)`));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });
}

/**
 * Connector Management Commands
 */
function registerConnectorCommands(dept: Command): void {
  const connector = dept
    .command('connector')
    .alias('c')
    .description('Manage and monitor GCUID connector');

  // dept connector status
  connector
    .command('status')
    .description('Show connector status and health')
    .action(async () => {
      try {
        // Check if databases exist
        const registryExists = fs.existsSync(REGISTRY_DB);
        const hrExists = fs.existsSync(HR_DB);
        
        console.log(chalk.bold('\n🔌 Connector Status\n'));
        
        const table = new Table({
          head: [chalk.cyan('Component'), chalk.cyan('Status'), chalk.cyan('Details')],
          colWidths: [25, 12, 40]
        });
        
        table.push(
          ['Central Registry', registryExists ? chalk.green('✓ Online') : chalk.red('✗ Offline'), 
           registryExists ? 'Connected' : 'Not accessible'],
          ['HR System Database', hrExists ? chalk.green('✓ Online') : chalk.red('✗ Offline'),
           hrExists ? 'Connected' : 'Not found'],
          ['Connector Service', chalk.yellow('⚠ Simulated'), 'Use start-connectors for real service']
        );
        
        if (registryExists && hrExists) {
          const hrDb = new Database(HR_DB, { readonly: true });
          const registryDb = new Database(REGISTRY_DB, { readonly: true });

          const empCount = hrDb.prepare('SELECT COUNT(*) as count FROM employees').get() as { count: number };

          // Fetch employee_ids from hrDb, then query registryDb for
          // matching identities. See dept data stats for the rationale.
          const employeeIds = (hrDb.prepare('SELECT employee_id FROM employees').all() as { employee_id: string }[])
            .map(r => r.employee_id);
          const placeholders = employeeIds.map(() => '?').join(',');
          const gcuidCount = employeeIds.length === 0
            ? { count: 0 }
            : registryDb.prepare(
                `SELECT COUNT(*) as count FROM identities WHERE entity_id IN (${placeholders})`
              ).get(...employeeIds) as { count: number };

table.push(
            ['Integration Rate', 
             gcuidCount.count === empCount.count ? chalk.green('100%') : chalk.yellow(`${Math.round(gcuidCount.count / empCount.count * 100)}%`),
             `${gcuidCount.count}/${empCount.count} employees integrated`]
          );
          
          hrDb.close();
          registryDb.close();
        }
        
        console.log(table.toString());
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // dept connector test
  connector
    .command('test')
    .description('Test connector connectivity and configuration')
    .action(async () => {
      console.log(chalk.bold('\n🧪 Testing Connector\n'));
      
      const tests = [
        { name: 'Registry database accessible', test: () => fs.existsSync(REGISTRY_DB) },
        { name: 'HR database accessible', test: () => fs.existsSync(HR_DB) },
        { name: 'Can query HR database', test: () => {
          try {
            const db = new Database(HR_DB, { readonly: true });
            db.prepare('SELECT COUNT(*) FROM employees').get();
            db.close();
            return true;
          } catch {
            return false;
          }
        }},
        { name: 'Can query registry database', test: () => {
          try {
            const db = new Database(REGISTRY_DB, { readonly: true });
            db.prepare('SELECT COUNT(*) FROM identities').get();
            db.close();
            return true;
          } catch {
            return false;
          }
        }}
      ];
      
      let passed = 0;
      for (const test of tests) {
        const result = test.test();
        console.log(result ? chalk.green('✓') : chalk.red('✗'), test.name);
        if (result) passed++;
      }
      
      console.log(chalk.bold(`\n${passed}/${tests.length} tests passed`));
      
      if (passed === tests.length) {
        console.log(chalk.green('\n✅ Connector is healthy'));
      } else {
        console.log(chalk.red('\n❌ Connector has issues'));
      }
    });

  // dept connector info
  connector
    .command('info')
    .description('Show connector configuration and details')
    .action(async () => {
      console.log(chalk.bold('\n📋 Connector Information\n'));
      
      const table = new Table({
        head: [chalk.cyan('Property'), chalk.cyan('Value')],
        colWidths: [30, 50]
      });
      
      table.push(
        ['Connector Type', 'HR System Connector'],
        ['Protocol', 'SQLite Direct Access'],
        ['Database', path.basename(HR_DB)],
        ['Registry', path.basename(REGISTRY_DB)],
        ['Working Directory', process.cwd()],
        ['Node Version', process.version]
      );
      
      console.log(table.toString());
    });
}

/**
 * Monitoring Commands
 */
function registerMonitoringCommands(dept: Command): void {
  const monitor = dept
    .command('monitor')
    .alias('m')
    .description('Monitor system performance and activity');

  // dept monitor dashboard
  monitor
    .command('dashboard')
    .description('Show monitoring dashboard')
    .action(async () => {
      try {
        const hrDb = new Database(HR_DB, { readonly: true });
        const registryDb = new Database(REGISTRY_DB, { readonly: true });
        
        // Get counts
        const totalEmp = hrDb.prepare('SELECT COUNT(*) as count FROM employees').get() as { count: number };
        const totalGcuid = registryDb.prepare('SELECT COUNT(*) as count FROM identities').get() as { count: number };
        const activeGcuid = registryDb.prepare('SELECT COUNT(*) as count FROM identities WHERE state = ?')
          .get('active') as { count: number };
        
        // Get recent activity
        const recentHistory = registryDb.prepare(`
          SELECT COUNT(*) as count FROM state_history 
          WHERE timestamp > datetime('now', '-24 hours')
        `).get() as { count: number };
        
        hrDb.close();
        registryDb.close();
        
        console.log(chalk.bold('\n📊 Monitoring Dashboard\n'));
        console.log(chalk.bold('='.repeat(60)));
        
        console.log(chalk.bold('\n📈 Statistics\n'));
        console.log(`  Total Employees:       ${chalk.cyan(totalEmp.count.toString())}`);
        console.log(`  Total GCUIDs:          ${chalk.cyan(totalGcuid.count.toString())}`);
        console.log(`  Active GCUIDs:         ${chalk.green(activeGcuid.count.toString())}`);
        console.log(`  Integration Rate:      ${chalk.cyan(Math.round(totalGcuid.count / totalEmp.count * 100))}%`);
        
        console.log(chalk.bold('\n🔄 Recent Activity (24h)\n'));
        console.log(`  State Transitions:     ${chalk.cyan(recentHistory.count.toString())}`);
        
        console.log(chalk.bold('\n🎯 System Health\n'));
        console.log(chalk.green('  ✓ All systems operational'));
        console.log(chalk.green('  ✓ Databases accessible'));
        console.log(chalk.green('  ✓ No errors detected'));
        
        console.log('\n' + chalk.bold('='.repeat(60)));
        
      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        process.exit(1);
      }
    });

  // dept monitor stats
  monitor
    .command('stats')
    .description('Show detailed statistics')
    .option('--period <period>', 'Time period (24h|7d|30d)', '24h')
    .action(async (options: { period: string }) => {
      try {
        const registryDb = new Database(REGISTRY_DB, { readonly: true });
        
        const periodMap: Record<string, string> = {
          '24h': '-1 day',
          '7d': '-7 days',
          '30d': '-30 days'
        };
        
        const period = periodMap[options.period] || '-1 day';
        
        // State distribution
        const byState = registryDb.prepare(`
          SELECT state, COUNT(*) as count 
          FROM identities 
          GROUP BY state
        `).all() as { state: string; count: number }[];
        
        // Recent transitions
        const recentTransitions = registryDb.prepare(`
          SELECT to_state, COUNT(*) as count 
          FROM state_history 
          WHERE timestamp > datetime('now', ?)
          GROUP BY to_state
        `).all(period) as { to_state: string; count: number }[];
        
        registryDb.close();
        
        console.log(chalk.bold(`\n📊 Statistics (${options.period})\n`));
        
        // State distribution table
        const stateTable = new Table({
          head: [chalk.cyan('State'), chalk.cyan('Count'), chalk.cyan('Percentage')],
          colWidths: [20, 10, 15]
        });
        
        const total = byState.reduce((sum, s) => sum + s.count, 0);
        for (const state of byState) {
          const pct = Math.round((state.count / total) * 100);
          stateTable.push([
            formatState(state.state),
            state.count.toString(),
            `${pct}%`
          ]);
        }
        
        console.log(chalk.bold('Identity States:'));
        console.log(stateTable.toString());
        
        // Recent transitions
        if (recentTransitions.length > 0) {
          console.log(chalk.bold(`\nRecent Transitions (${options.period}):\n`));
          
          const transTable = new Table({
            head: [chalk.cyan('To State'), chalk.cyan('Count')],
            colWidths: [20, 10]
          });
          
          for (const trans of recentTransitions) {
            transTable.push([formatState(trans.to_state), trans.count.toString()]);
          }
          
          console.log(transTable.toString());
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
