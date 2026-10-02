#!/usr/bin/env node
/*!
 * GCUID Staging Environment CLI
 * 
 * Provides commands for three user personas:
 * - user: End users querying identity information
 * - dept: Departmental operators managing their systems
 * - admin: Central administrators managing the registry
 */

import { Command } from 'commander';
import chalk from 'chalk';

// Import command groups
import { registerUserCommands } from './commands/user';
import { registerDeptCommands } from './commands/dept';
import { registerAdminCommands } from './commands/admin';

const program = new Command();

program
  .name('gcuid-staging')
  .description('GCUID Staging Environment CLI - Identity Management Demonstrations')
  .version('1.0.0');

// Register command groups
registerUserCommands(program);
registerDeptCommands(program);
registerAdminCommands(program);

// Help examples
program.addHelpText('after', `

${chalk.bold('Examples:')}
  ${chalk.cyan('User Commands (End Users):')}
    $ gcuid-staging user lookup EMP001
    $ gcuid-staging user search "john doe"
    $ gcuid-staging user history urn:gcuid:01ARZ3NDEKTSV4RRFFQ69G5FAV

  ${chalk.cyan('Department Commands (HR/IT Operators):')}
    $ gcuid-staging dept data list
    $ gcuid-staging dept data view EMP001
    $ gcuid-staging dept connector status
    $ gcuid-staging dept monitor dashboard

  ${chalk.cyan('Admin Commands (Central Registry):')}
    $ gcuid-staging admin list --state active
    $ gcuid-staging admin approve urn:gcuid:01ARZ3NDEKTSV4RRFFQ69G5FAV
    $ gcuid-staging admin detect-duplicates
    $ gcuid-staging admin stats

${chalk.bold('Documentation:')}
  Full documentation: docs/guidebook-developer.md §1.5 (The staging CLI)
  Use cases: docs/guidebook-user.md §2.3 (Full use-case catalog)
`);

program.parse(process.argv);
