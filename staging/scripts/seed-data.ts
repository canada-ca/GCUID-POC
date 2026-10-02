#!/usr/bin/env tsx
/**
 * Seed Data Script for GCUID Staging Environment - Federal Architecture
 * 
 * Mimics federal government reality with incomplete, overlapping coverage:
 * - HR System: ~31 employees (partial coverage - ~52% of workforce)
 * - LDAP/AD: ~20 users (partial coverage - ~33% of workforce, technical staff)
 * - Engineering Dept: 35 employees (complete dept coverage)
 * - Finance Dept: 25 employees (complete dept coverage)
 * - Central Registry: 8 active GCUIDs, 4 pending approval
 * 
 * Total: 60 unique people across 4 systems (100+ total records with overlaps)
 * 
 * Notable test cases:
 *   - Near-duplicate names: ENG-026 "Thomas Martin" vs FIN-016 "Martin Thomas"
 *   - Shared family name:   ENG-002 "Maria Chen" vs FIN-024 "William Chen"
 *   - French names with accents: Gagnon, Côté, Lefebvre, Tremblay, Bergeron, etc.
 *   - Detail/secondment workers (no HR record, LDAP + dept only)
 *   - Contractors (no HR, no LDAP — dept system only)
 */

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const STAGING_ROOT = path.dirname(process.cwd());
const DATA_DIR = path.join(STAGING_ROOT, 'staging', 'data');
// Source DBs live in staging/data/sources/ (per Plan B option B1). The legacy path `connectors/` is no
// longer used — keeping this var named CONNECTORS_DIR would only invite
// the next bug. Renamed to SOURCES_DIR to match the actual filesystem.
const SOURCES_DIR = path.join(DATA_DIR, 'sources');

// Database paths
const HR_DB_PATH = path.join(SOURCES_DIR, 'conn-hr.db');
const LDAP_DB_PATH = path.join(SOURCES_DIR, 'conn-ldap.db');
const ENG_DB_PATH = path.join(SOURCES_DIR, 'conn-engineering.db');
const FIN_DB_PATH = path.join(SOURCES_DIR, 'conn-finance.db');
const REGISTRY_DB_PATH = path.join(DATA_DIR, 'registry.db');

console.log('🌱 GCUID Federal Architecture - Seed Data');
console.log('==========================================');
console.log('Mimicking federal government reality:');
console.log('- Incomplete coverage across authoritative sources');
console.log('- Department systems have complete view of their staff');
console.log('- GCUID provides coordination layer\n');

// Ensure directories exist
if (!fs.existsSync(SOURCES_DIR)) {
  console.error('❌ Error: staging/data/sources directory not found');
  console.error('   Run: mkdir -p staging/data/sources');
  process.exit(1);
}

// Clean up old databases
function cleanDatabase(dbPath: string, name: string): void {
  if (fs.existsSync(dbPath)) {
    console.log(`🗑️  Removing old ${name} database...`);
    fs.unlinkSync(dbPath);
  }
}

// ============================================================================
// Master Data: 35 Unique People with Coverage Patterns
// ============================================================================

interface Person {
  // Identifiers
  eng_id?: string;    // Engineering dept ID (if in engineering)
  fin_id?: string;    // Finance dept ID (if in finance)
  hr_id?: string;     // HR system ID (if in HR)
  ldap_username?: string;  // LDAP username (if has IT access)
  
  // Core info
  first_name: string;
  last_name: string;
  email: string;
  
  // Department-specific
  department: 'Engineering' | 'Finance';
  role: string;
  employment_type: 'FTE' | 'Contractor' | 'Detail' | 'Temp' | 'External';
  
  // For finance
  clearance_level?: string;
  
  // For engineering
  skills?: string[];
  
  // Dates
  hire_date?: string;
  start_date: string;
  end_date?: string;
  
  // GCUID status
  gcuid_status: 'active' | 'pending' | 'none';
  gcuid?: string;
}

const masterData: Person[] = [
  // ENGINEERING DEPARTMENT (20 people)
  // ENG-001: Full coverage (FTE with all access) - HAS GCUID
  {
    eng_id: 'ENG-001', hr_id: 'E10001', ldap_username: 'jsmith',
    first_name: 'John', last_name: 'Smith',
    email: 'john.smith@department.gc.ca',
    department: 'Engineering', role: 'Senior Software Engineer',
    employment_type: 'FTE',
    skills: ['TypeScript', 'React', 'Node.js'],
    hire_date: '2020-01-15', start_date: '2020-01-15',
    gcuid_status: 'active',
    gcuid: 'urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X2'
  },
  // ENG-002: Full coverage (FTE with all access) - HAS GCUID
  {
    eng_id: 'ENG-002', hr_id: 'E10002', ldap_username: 'mchen',
    first_name: 'Maria', last_name: 'Chen',
    email: 'maria.chen@department.gc.ca',
    department: 'Engineering', role: 'DevOps Engineer',
    employment_type: 'FTE',
    skills: ['Kubernetes', 'Docker', 'AWS'],
    hire_date: '2019-03-22', start_date: '2019-03-22',
    gcuid_status: 'active',
    gcuid: 'urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X3'
  },
  // ENG-003: Full coverage (FTE) - PENDING GCUID
  {
    eng_id: 'ENG-003', hr_id: 'E10003', ldap_username: 'rpatel',
    first_name: 'Raj', last_name: 'Patel',
    email: 'raj.patel@department.gc.ca',
    department: 'Engineering', role: 'Software Engineer',
    employment_type: 'FTE',
    skills: ['Java', 'Spring Boot', 'PostgreSQL'],
    hire_date: '2021-06-10', start_date: '2021-06-10',
    gcuid_status: 'pending'
  },
  // ENG-004: Dept + HR only (new hire, pending LDAP access)
  {
    eng_id: 'ENG-004', hr_id: 'E10004',
    first_name: 'Sarah', last_name: 'Johnson',
    email: 'sarah.johnson@department.gc.ca',
    department: 'Engineering', role: 'Junior Developer',
    employment_type: 'FTE',
    skills: ['Python', 'Django'],
    hire_date: '2026-04-01', start_date: '2026-04-01',
    gcuid_status: 'none'
  },
  // ENG-005: Dept + HR only (new hire)
  {
    eng_id: 'ENG-005', hr_id: 'E10005',
    first_name: 'David', last_name: 'Lee',
    email: 'david.lee@department.gc.ca',
    department: 'Engineering', role: 'QA Engineer',
    employment_type: 'FTE',
    skills: ['Selenium', 'Jest', 'Cypress'],
    hire_date: '2026-03-15', start_date: '2026-03-15',
    gcuid_status: 'none'
  },
  // ENG-006: Dept + LDAP only (inter-agency detail)
  {
    eng_id: 'ENG-006', ldap_username: 'awong',
    first_name: 'Alice', last_name: 'Wong',
    email: 'alice.wong@department.gc.ca',
    department: 'Engineering', role: 'Security Engineer (Detail)',
    employment_type: 'Detail',
    skills: ['Cybersecurity', 'Penetration Testing'],
    start_date: '2026-01-01', end_date: '2026-12-31',
    gcuid_status: 'none'
  },
  // ENG-007: Dept + LDAP only (inter-agency detail)
  {
    eng_id: 'ENG-007', ldap_username: 'bthompson',
    first_name: 'Bob', last_name: 'Thompson',
    email: 'bob.thompson@partner.gov',
    department: 'Engineering', role: 'Cloud Architect (Detail)',
    employment_type: 'Detail',
    skills: ['Azure', 'Architecture', 'Terraform'],
    start_date: '2025-10-01', end_date: '2026-09-30',
    gcuid_status: 'none'
  },
  // ENG-008 to ENG-010: Dept only (contractors, no HR or LDAP)
  {
    eng_id: 'ENG-008',
    first_name: 'Carlos', last_name: 'Martinez',
    email: 'carlos.martinez@contractor.com',
    department: 'Engineering', role: 'Frontend Developer (Contractor)',
    employment_type: 'Contractor',
    skills: ['React', 'Vue.js', 'CSS'],
    start_date: '2025-09-01', end_date: '2027-08-31',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-009',
    first_name: 'Diana', last_name: 'Kumar',
    email: 'diana.kumar@contractor.com',
    department: 'Engineering', role: 'Backend Developer (Contractor)',
    employment_type: 'Contractor',
    skills: ['Node.js', 'Express', 'MongoDB'],
    start_date: '2025-11-15', end_date: '2027-11-14',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-010',
    first_name: 'Eric', last_name: 'Brown',
    email: 'eric.brown@contractor.com',
    department: 'Engineering', role: 'Database Admin (Contractor)',
    employment_type: 'Contractor',
    skills: ['PostgreSQL', 'MySQL', 'Redis'],
    start_date: '2026-01-10', end_date: '2027-01-09',
    gcuid_status: 'none'
  },
  // ENG-011 to ENG-012: Full coverage (FTE) - NO GCUID YET
  {
    eng_id: 'ENG-011', hr_id: 'E10006', ldap_username: 'fgarcia',
    first_name: 'Frank', last_name: 'Garcia',
    email: 'frank.garcia@department.gc.ca',
    department: 'Engineering', role: 'Full Stack Developer',
    employment_type: 'FTE',
    skills: ['React', 'Node.js', 'Docker'],
    hire_date: '2022-02-14', start_date: '2022-02-14',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-012', hr_id: 'E10007', ldap_username: 'gwilson',
    first_name: 'Grace', last_name: 'Wilson',
    email: 'grace.wilson@department.gc.ca',
    department: 'Engineering', role: 'Site Reliability Engineer',
    employment_type: 'FTE',
    skills: ['Kubernetes', 'Prometheus', 'Grafana'],
    hire_date: '2021-08-30', start_date: '2021-08-30',
    gcuid_status: 'none'
  },
  // ENG-013 to ENG-014: Dept + HR only - NO GCUID YET
  {
    eng_id: 'ENG-013', hr_id: 'E10008',
    first_name: 'Henry', last_name: 'Taylor',
    email: 'henry.taylor@department.gc.ca',
    department: 'Engineering', role: 'Systems Analyst',
    employment_type: 'FTE',
    skills: ['Systems Design', 'UML'],
    hire_date: '2023-05-20', start_date: '2023-05-20',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-014', hr_id: 'E10009',
    first_name: 'Isabel', last_name: 'Anderson',
    email: 'isabel.anderson@department.gc.ca',
    department: 'Engineering', role: 'Technical Writer',
    employment_type: 'FTE',
    hire_date: '2024-01-08', start_date: '2024-01-08',
    gcuid_status: 'none'
  },
  // ENG-015: Dept + LDAP only (no HR)
  {
    eng_id: 'ENG-015', ldap_username: 'jmorris',
    first_name: 'James', last_name: 'Morris',
    email: 'james.morris@partner.gov',
    department: 'Engineering', role: 'Network Engineer (Detail)',
    employment_type: 'Detail',
    skills: ['Networking', 'Cisco', 'Firewall'],
    start_date: '2025-07-01', end_date: '2026-06-30',
    gcuid_status: 'none'
  },
  // ENG-016 to ENG-017: Dept only (more contractors)
  {
    eng_id: 'ENG-016',
    first_name: 'Karen', last_name: 'White',
    email: 'karen.white@contractor.com',
    department: 'Engineering', role: 'UI/UX Designer (Contractor)',
    employment_type: 'Contractor',
    skills: ['Figma', 'User Research', 'Prototyping'],
    start_date: '2026-02-01', end_date: '2027-01-31',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-017',
    first_name: 'Leo', last_name: 'Rodriguez',
    email: 'leo.rodriguez@contractor.com',
    department: 'Engineering', role: 'Mobile Developer (Contractor)',
    employment_type: 'Contractor',
    skills: ['React Native', 'iOS', 'Android'],
    start_date: '2025-12-01', end_date: '2026-11-30',
    gcuid_status: 'none'
  },
  // ENG-018 to ENG-020: Mix of coverage patterns
  {
    eng_id: 'ENG-018', hr_id: 'E10010', ldap_username: 'mgreen',
    first_name: 'Michael', last_name: 'Green',
    email: 'michael.green@department.gc.ca',
    department: 'Engineering', role: 'Engineering Manager',
    employment_type: 'FTE',
    skills: ['Leadership', 'Agile', 'Architecture'],
    hire_date: '2018-11-05', start_date: '2018-11-05',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-019', hr_id: 'E10011',
    first_name: 'Nancy', last_name: 'Adams',
    email: 'nancy.adams@department.gc.ca',
    department: 'Engineering', role: 'Product Owner',
    employment_type: 'FTE',
    hire_date: '2023-03-14', start_date: '2023-03-14',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-020',
    first_name: 'Oscar', last_name: 'Clark',
    email: 'oscar.clark@temp.com',
    department: 'Engineering', role: 'Intern',
    employment_type: 'Temp',
    skills: ['Learning', 'Python', 'Git'],
    start_date: '2026-06-01', end_date: '2026-08-31',
    gcuid_status: 'none'
  },

  // FINANCE DEPARTMENT (15 people)
  // FIN-001: Full coverage (director) - HAS GCUID
  {
    fin_id: 'FIN-001', hr_id: 'E20001', ldap_username: 'pjones',
    first_name: 'Patricia', last_name: 'Jones',
    email: 'patricia.jones@department.gc.ca',
    department: 'Finance', role: 'Finance Director',
    employment_type: 'FTE',
    clearance_level: 'Secret',
    hire_date: '2015-04-10', start_date: '2015-04-10',
    gcuid_status: 'active',
    gcuid: 'urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X4'
  },
  // FIN-002: Dept + HR only (typical finance staff) - HAS GCUID
  {
    fin_id: 'FIN-002', hr_id: 'E20002',
    first_name: 'Quinn', last_name: 'Miller',
    email: 'quinn.miller@department.gc.ca',
    department: 'Finance', role: 'Budget Analyst',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2020-07-20', start_date: '2020-07-20',
    gcuid_status: 'active',
    gcuid: 'urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X5'
  },
  // FIN-003: Dept + HR only - PENDING GCUID
  {
    fin_id: 'FIN-003', hr_id: 'E20003',
    first_name: 'Rachel', last_name: 'Davis',
    email: 'rachel.davis@department.gc.ca',
    department: 'Finance', role: 'Accountant',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2021-09-12', start_date: '2021-09-12',
    gcuid_status: 'pending'
  },
  // FIN-004 to FIN-005: Dept + HR only
  {
    fin_id: 'FIN-004', hr_id: 'E20004',
    first_name: 'Steven', last_name: 'Martinez',
    email: 'steven.martinez@department.gc.ca',
    department: 'Finance', role: 'Financial Analyst',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2022-11-01', start_date: '2022-11-01',
    gcuid_status: 'none'
  },
  {
    fin_id: 'FIN-005', hr_id: 'E20005',
    first_name: 'Tina', last_name: 'Hernandez',
    email: 'tina.hernandez@department.gc.ca',
    department: 'Finance', role: 'Payroll Specialist',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2023-02-14', start_date: '2023-02-14',
    gcuid_status: 'none'
  },
  // FIN-006 to FIN-008: Dept only (external auditors, contractors)
  {
    fin_id: 'FIN-006',
    first_name: 'Uma', last_name: 'Patel',
    email: 'uma.patel@audit-firm.com',
    department: 'Finance', role: 'External Auditor',
    employment_type: 'External',
    clearance_level: 'Public Trust',
    start_date: '2026-01-15', end_date: '2026-06-30',
    gcuid_status: 'none'
  },
  {
    fin_id: 'FIN-007',
    first_name: 'Victor', last_name: 'Lopez',
    email: 'victor.lopez@audit-firm.com',
    department: 'Finance', role: 'External Auditor',
    employment_type: 'External',
    clearance_level: 'Public Trust',
    start_date: '2026-01-15', end_date: '2026-06-30',
    gcuid_status: 'none'
  },
  {
    fin_id: 'FIN-008',
    first_name: 'Wendy', last_name: 'Scott',
    email: 'wendy.scott@contractor.com',
    department: 'Finance', role: 'Financial Systems Contractor',
    employment_type: 'Contractor',
    start_date: '2025-10-01', end_date: '2026-09-30',
    gcuid_status: 'none'
  },
  // FIN-009: Full coverage (budget analyst with systems access)
  {
    fin_id: 'FIN-009', hr_id: 'E20006', ldap_username: 'xturner',
    first_name: 'Xavier', last_name: 'Turner',
    email: 'xavier.turner@department.gc.ca',
    department: 'Finance', role: 'Senior Budget Analyst',
    employment_type: 'FTE',
    clearance_level: 'Secret',
    hire_date: '2019-05-30', start_date: '2019-05-30',
    gcuid_status: 'none'
  },
  // FIN-010 to FIN-012: Dept + HR only
  {
    fin_id: 'FIN-010', hr_id: 'E20007',
    first_name: 'Yolanda', last_name: 'King',
    email: 'yolanda.king@department.gc.ca',
    department: 'Finance', role: 'Grants Specialist',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2021-03-22', start_date: '2021-03-22',
    gcuid_status: 'none'
  },
  {
    fin_id: 'FIN-011', hr_id: 'E20008',
    first_name: 'Zachary', last_name: 'Wright',
    email: 'zachary.wright@department.gc.ca',
    department: 'Finance', role: 'Procurement Officer',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2022-08-15', start_date: '2022-08-15',
    gcuid_status: 'none'
  },
  {
    fin_id: 'FIN-012', hr_id: 'E20009',
    first_name: 'Amy', last_name: 'Young',
    email: 'amy.young@department.gc.ca',
    department: 'Finance', role: 'Cost Analyst',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2023-10-01', start_date: '2023-10-01',
    gcuid_status: 'none'
  },
  // FIN-013: Dept only (temp auditor)
  {
    fin_id: 'FIN-013',
    first_name: 'Brian', last_name: 'Hill',
    email: 'brian.hill@temp.com',
    department: 'Finance', role: 'Temporary Auditor',
    employment_type: 'Temp',
    start_date: '2026-04-01', end_date: '2026-07-31',
    gcuid_status: 'none'
  },
  // FIN-014 to FIN-015: Dept + HR / Full coverage
  {
    fin_id: 'FIN-014', hr_id: 'E20010',
    first_name: 'Catherine', last_name: 'Allen',
    email: 'catherine.allen@department.gc.ca',
    department: 'Finance', role: 'Fiscal Officer',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2024-01-22', start_date: '2024-01-22',
    gcuid_status: 'none'
  },
  {
    fin_id: 'FIN-015', hr_id: 'E20011', ldap_username: 'dmoore',
    first_name: 'Daniel', last_name: 'Moore',
    email: 'daniel.moore@department.gc.ca',
    department: 'Finance', role: 'IT Finance Liaison',
    employment_type: 'FTE',
    clearance_level: 'Secret',
    hire_date: '2020-12-07', start_date: '2020-12-07',
    gcuid_status: 'none'
  },

  // ── Additional Engineering employees (ENG-021 to ENG-035) ──────────────────
  // French-Canadian names, varied coverage, more active GCUIDs for richer testing
  {
    eng_id: 'ENG-021', hr_id: 'E10012', ldap_username: 'stremblay',
    first_name: 'Sophie', last_name: 'Tremblay',
    email: 'sophie.tremblay@department.gc.ca',
    department: 'Engineering', role: 'Software Architect',
    employment_type: 'FTE',
    skills: ['Java', 'Microservices', 'AWS'],
    hire_date: '2017-09-18', start_date: '2017-09-18',
    gcuid_status: 'active',
    gcuid: 'urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X6'
  },
  {
    eng_id: 'ENG-022', hr_id: 'E10013',
    first_name: 'Jean-François', last_name: 'Gagnon',
    email: 'jean-francois.gagnon@department.gc.ca',
    department: 'Engineering', role: 'Backend Developer',
    employment_type: 'FTE',
    skills: ['Go', 'gRPC', 'Kafka'],
    hire_date: '2022-04-04', start_date: '2022-04-04',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-023',
    first_name: 'Mei-Lin', last_name: 'Zhao',
    email: 'meilin.zhao@contractor.com',
    department: 'Engineering', role: 'Data Engineer (Contractor)',
    employment_type: 'Contractor',
    skills: ['Spark', 'Python', 'Databricks'],
    start_date: '2026-02-15', end_date: '2027-02-14',
    gcuid_status: 'none'
  },
  // ENG-024: Full coverage, pending GCUID (matched in CAES but awaiting approval)
  {
    eng_id: 'ENG-024', hr_id: 'E10014', ldap_username: 'ahassan',
    first_name: 'Amir', last_name: 'Hassan',
    email: 'amir.hassan@department.gc.ca',
    department: 'Engineering', role: 'Cloud Security Engineer',
    employment_type: 'FTE',
    skills: ['AWS Security', 'IAM', 'SIEM'],
    hire_date: '2023-08-21', start_date: '2023-08-21',
    gcuid_status: 'pending'
  },
  {
    eng_id: 'ENG-025', hr_id: 'E10015',
    first_name: "Bridget", last_name: "O'Brien",
    email: 'bridget.obrien@department.gc.ca',
    department: 'Engineering', role: 'Platform Engineer',
    employment_type: 'FTE',
    skills: ['Terraform', 'Ansible', 'Linux'],
    hire_date: '2021-11-01', start_date: '2021-11-01',
    gcuid_status: 'none'
  },
  // ENG-026: "Thomas Martin" — intentionally similar name to Finance "Martin Thomas" for matching edge-case testing
  {
    eng_id: 'ENG-026', hr_id: 'E10016', ldap_username: 'tmartin',
    first_name: 'Thomas', last_name: 'Martin',
    email: 'thomas.martin@department.gc.ca',
    department: 'Engineering', role: 'DevSecOps Engineer',
    employment_type: 'FTE',
    skills: ['GitHub Actions', 'Snyk', 'Docker'],
    hire_date: '2020-05-11', start_date: '2020-05-11',
    gcuid_status: 'none'
  },
  // ENG-027: Detail worker — department + LDAP only, no HR
  {
    eng_id: 'ENG-027', ldap_username: 'icote',
    first_name: 'Isabelle', last_name: 'Côté',
    email: 'isabelle.cote@partner.gc.ca',
    department: 'Engineering', role: 'Accessibility Specialist (Detail)',
    employment_type: 'Detail',
    skills: ['WCAG', 'ARIA', 'Assistive Technology'],
    start_date: '2026-01-06', end_date: '2026-12-31',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-028', hr_id: 'E10017',
    first_name: 'DeShawn', last_name: 'Williams',
    email: 'deshawn.williams@department.gc.ca',
    department: 'Engineering', role: 'Integration Engineer',
    employment_type: 'FTE',
    skills: ['REST', 'OpenAPI', 'API Gateway'],
    hire_date: '2024-03-01', start_date: '2024-03-01',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-029', hr_id: 'E10018', ldap_username: 'psharma',
    first_name: 'Priya', last_name: 'Sharma',
    email: 'priya.sharma@department.gc.ca',
    department: 'Engineering', role: 'Data Scientist',
    employment_type: 'FTE',
    skills: ['Python', 'TensorFlow', 'SQL'],
    hire_date: '2023-01-16', start_date: '2023-01-16',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-030',
    first_name: 'Nikolai', last_name: 'Petrov',
    email: 'n.petrov@contractor.com',
    department: 'Engineering', role: 'Embedded Systems Contractor',
    employment_type: 'Contractor',
    skills: ['C', 'C++', 'RTOS'],
    start_date: '2026-03-01', end_date: '2027-02-28',
    gcuid_status: 'none'
  },
  // ENG-031: Full coverage — active GCUID
  {
    eng_id: 'ENG-031', hr_id: 'E10019', ldap_username: 'clefebvre',
    first_name: 'Camille', last_name: 'Lefebvre',
    email: 'camille.lefebvre@department.gc.ca',
    department: 'Engineering', role: 'Principal Engineer',
    employment_type: 'FTE',
    skills: ['Architecture', 'TypeScript', 'Azure'],
    hire_date: '2016-06-06', start_date: '2016-06-06',
    gcuid_status: 'active',
    gcuid: 'urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X7'
  },
  {
    eng_id: 'ENG-032',
    first_name: 'Tyler', last_name: 'Hughes',
    email: 'tyler.hughes@temp.com',
    department: 'Engineering', role: 'Co-op Student',
    employment_type: 'Temp',
    skills: ['Python', 'Git', 'HTML'],
    start_date: '2026-05-01', end_date: '2026-08-29',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-033', hr_id: 'E10020',
    first_name: 'Fatima', last_name: 'Al-Rashid',
    email: 'fatima.al-rashid@department.gc.ca',
    department: 'Engineering', role: 'Test Automation Engineer',
    employment_type: 'FTE',
    skills: ['Playwright', 'Jest', 'Python'],
    hire_date: '2024-09-09', start_date: '2024-09-09',
    gcuid_status: 'none'
  },
  // ENG-034: Department + LDAP only (secondment from another agency)
  {
    eng_id: 'ENG-034', ldap_username: 'amacdonald',
    first_name: 'Andrew', last_name: 'MacDonald',
    email: 'andrew.macdonald@partner.gc.ca',
    department: 'Engineering', role: 'Solutions Architect (Secondment)',
    employment_type: 'Detail',
    skills: ['GCP', 'Networking', 'Zero Trust'],
    start_date: '2025-08-01', end_date: '2026-07-31',
    gcuid_status: 'none'
  },
  {
    eng_id: 'ENG-035', hr_id: 'E10021', ldap_username: 'lkovacs',
    first_name: 'Lena', last_name: 'Kovacs',
    email: 'lena.kovacs@department.gc.ca',
    department: 'Engineering', role: 'Software Engineer',
    employment_type: 'FTE',
    skills: ['Kotlin', 'Spring', 'Kubernetes'],
    hire_date: '2025-02-03', start_date: '2025-02-03',
    gcuid_status: 'none'
  },

  // ── Additional Finance employees (FIN-016 to FIN-025) ──────────────────────
  // "Martin Thomas" (Finance) vs "Thomas Martin" (Engineering) — near-duplicate name test
  {
    fin_id: 'FIN-016', hr_id: 'E20012', ldap_username: 'mthomas',
    first_name: 'Martin', last_name: 'Thomas',
    email: 'martin.thomas@department.gc.ca',
    department: 'Finance', role: 'Senior Financial Systems Analyst',
    employment_type: 'FTE',
    clearance_level: 'Secret',
    hire_date: '2019-10-14', start_date: '2019-10-14',
    gcuid_status: 'none'
  },
  // FIN-017: Active GCUID
  {
    fin_id: 'FIN-017', hr_id: 'E20013',
    first_name: 'Nadia', last_name: 'Beausoleil',
    email: 'nadia.beausoleil@department.gc.ca',
    department: 'Finance', role: 'Budget Officer',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2018-07-23', start_date: '2018-07-23',
    gcuid_status: 'active',
    gcuid: 'urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X8'
  },
  {
    fin_id: 'FIN-018',
    first_name: 'Roberto', last_name: 'Esposito',
    email: 'r.esposito@audit-firm.com',
    department: 'Finance', role: 'External IT Auditor',
    employment_type: 'External',
    clearance_level: 'Public Trust',
    start_date: '2026-03-01', end_date: '2026-09-30',
    gcuid_status: 'none'
  },
  {
    fin_id: 'FIN-019', hr_id: 'E20014', ldap_username: 'hschmidt',
    first_name: 'Hannah', last_name: 'Schmidt',
    email: 'hannah.schmidt@department.gc.ca',
    department: 'Finance', role: 'Treasury Analyst',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2021-05-03', start_date: '2021-05-03',
    gcuid_status: 'none'
  },
  {
    fin_id: 'FIN-020', hr_id: 'E20015',
    first_name: 'Kevin', last_name: 'Okafor',
    email: 'kevin.okafor@department.gc.ca',
    department: 'Finance', role: 'Expenditure Management Analyst',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2022-10-17', start_date: '2022-10-17',
    gcuid_status: 'none'
  },
  // FIN-021: Active GCUID
  {
    fin_id: 'FIN-021', hr_id: 'E20016', ldap_username: 'sbergeron',
    first_name: 'Stéphanie', last_name: 'Bergeron',
    email: 'stephanie.bergeron@department.gc.ca',
    department: 'Finance', role: 'Chief Financial Analyst',
    employment_type: 'FTE',
    clearance_level: 'Secret',
    hire_date: '2015-11-30', start_date: '2015-11-30',
    gcuid_status: 'active',
    gcuid: 'urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X9'
  },
  {
    fin_id: 'FIN-022',
    first_name: 'Tariq', last_name: 'Ibrahim',
    email: 'tariq.ibrahim@contractor.com',
    department: 'Finance', role: 'Financial Systems Integrator (Contractor)',
    employment_type: 'Contractor',
    start_date: '2026-01-20', end_date: '2026-12-19',
    gcuid_status: 'none'
  },
  {
    fin_id: 'FIN-023', hr_id: 'E20017',
    first_name: 'Juliette', last_name: 'Marchand',
    email: 'juliette.marchand@department.gc.ca',
    department: 'Finance', role: 'Internal Controls Specialist',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2023-06-12', start_date: '2023-06-12',
    gcuid_status: 'none'
  },
  // FIN-024: "William Chen" — same family name as ENG-002 "Maria Chen", tests false-positive matching
  {
    fin_id: 'FIN-024', hr_id: 'E20018',
    first_name: 'William', last_name: 'Chen',
    email: 'william.chen@department.gc.ca',
    department: 'Finance', role: 'Risk Analyst',
    employment_type: 'FTE',
    clearance_level: 'Public Trust',
    hire_date: '2024-02-05', start_date: '2024-02-05',
    gcuid_status: 'none'
  },
  // FIN-025: Pending GCUID
  {
    fin_id: 'FIN-025', hr_id: 'E20019', ldap_username: 'afontaine',
    first_name: 'Alexandra', last_name: 'Fontaine',
    email: 'alexandra.fontaine@department.gc.ca',
    department: 'Finance', role: 'Deputy Director, Financial Planning',
    employment_type: 'FTE',
    clearance_level: 'Secret',
    hire_date: '2014-03-17', start_date: '2014-03-17',
    gcuid_status: 'pending'
  }
];

// ============================================================================
// Database Creation Functions
// ============================================================================

function initializeCentralRegistry(): void {
  console.log('\n📊 Initializing Central Registry Database...');
  cleanDatabase(REGISTRY_DB_PATH, 'Central Registry');
  
  const db = new Database(REGISTRY_DB_PATH);
  
  // Create tables
  db.exec(`
    CREATE TABLE identities (
      gcuid TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'provisional',
      entity_type TEXT NOT NULL DEFAULT 'person',
      entity_id TEXT,
      namespace TEXT DEFAULT 'gc',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT
    );
    
    CREATE TABLE state_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gcuid TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      transition_type TEXT NOT NULL,
      reason TEXT,
      actor TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (gcuid) REFERENCES identities(gcuid)
    );
    
    CREATE TABLE aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gcuid TEXT NOT NULL,
      alias_type TEXT NOT NULL,
      alias_value TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'enabled',
      created_at TEXT NOT NULL,
      metadata TEXT,
      UNIQUE(gcuid, alias_type, alias_value),
      FOREIGN KEY (gcuid) REFERENCES identities(gcuid)
    );
    
    CREATE TABLE source_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gcuid TEXT NOT NULL,
      source_system TEXT NOT NULL,
      source_id TEXT NOT NULL,
      is_primary BOOLEAN DEFAULT FALSE,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(source_system, source_id),
      FOREIGN KEY (gcuid) REFERENCES identities(gcuid)
    );
    
    CREATE INDEX idx_identities_state ON identities(state);
    CREATE INDEX idx_identities_entity ON identities(entity_type, entity_id);
    CREATE INDEX idx_history_gcuid ON state_history(gcuid);
    CREATE INDEX idx_aliases_gcuid ON aliases(gcuid);
    CREATE INDEX idx_aliases_value ON aliases(alias_value);
    CREATE INDEX idx_source_mappings_gcuid ON source_mappings(gcuid);
    CREATE INDEX idx_source_mappings_source ON source_mappings(source_system, source_id);
  `);
  
  // Insert GCUIDs for people with active/pending status
  const now = new Date().toISOString();
  
  masterData.filter(p => p.gcuid_status !== 'none').forEach(person => {
    const state = person.gcuid_status === 'active' ? 'active' : 'provisional';
    const gcuid = person.gcuid || `urn:gcuid:01PENDING${Math.random().toString(36).substring(2, 15).toUpperCase()}`;
    
    // Determine primary entity_id
    const entity_id = person.eng_id || person.fin_id || person.hr_id || null;
    
    // Insert identity
    db.prepare(`
      INSERT INTO identities (gcuid, state, entity_type, entity_id, namespace, created_at, updated_at, metadata)
      VALUES (?, ?, 'person', ?, 'gc', ?, ?, ?)
    `).run(gcuid, state, entity_id, now, now, JSON.stringify({
      name: `${person.first_name} ${person.last_name}`,
      email: person.email
    }));
    
    // Insert state history
    db.prepare(`
      INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
      VALUES (?, NULL, ?, 'mint', 'Initial identity creation', 'system', ?)
    `).run(gcuid, state === 'active' ? 'provisional' : state, now);
    
    if (state === 'active') {
      db.prepare(`
        INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
        VALUES (?, 'provisional', 'active', 'activate', 'Approved by admin', 'admin@department.gc.ca', ?)
      `).run(gcuid, now);
    }
    
    // Insert source mappings (SQLite uses 1/0 for boolean)
    let isPrimary = 1;
    if (person.eng_id) {
      db.prepare(`
        INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, verified_at, created_at)
        VALUES (?, 'engineering', ?, ?, ?, ?)
      `).run(gcuid, person.eng_id, isPrimary, now, now);
      isPrimary = 0;
    }
    if (person.fin_id) {
      db.prepare(`
        INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, verified_at, created_at)
        VALUES (?, 'finance', ?, ?, ?, ?)
      `).run(gcuid, person.fin_id, isPrimary, now, now);
      isPrimary = 0;
    }
    if (person.hr_id) {
      db.prepare(`
        INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, verified_at, created_at)
        VALUES (?, 'hr', ?, ?, ?, ?)
      `).run(gcuid, person.hr_id, isPrimary, now, now);
      isPrimary = 0;
    }
    if (person.ldap_username) {
      db.prepare(`
        INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, verified_at, created_at)
        VALUES (?, 'ldap', ?, ?, ?, ?)
      `).run(gcuid, person.ldap_username, isPrimary, now, now);
    }
    
    // Insert email alias
    db.prepare(`
      INSERT INTO aliases (gcuid, alias_type, alias_value, status, created_at)
      VALUES (?, 'email', ?, 'enabled', ?)
    `).run(gcuid, person.email, now);
  });
  
  db.close();
  
  const activeCount = masterData.filter(p => p.gcuid_status === 'active').length;
  const pendingCount = masterData.filter(p => p.gcuid_status === 'pending').length;
  console.log(`✅ Central Registry initialized`);
  console.log(`   - ${activeCount} active GCUIDs`);
  console.log(`   - ${pendingCount} pending GCUIDs`);
  console.log(`   - Path: ${REGISTRY_DB_PATH}`);
}

function seedHRSystem(): void {
  console.log('\n👔 Seeding HR System (Authoritative Source)...');
  cleanDatabase(HR_DB_PATH, 'HR System');
  
  const db = new Database(HR_DB_PATH);
  
  // Create HR table
  db.exec(`
    CREATE TABLE employees (
      employee_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      department TEXT NOT NULL,
      job_title TEXT NOT NULL,
      employment_type TEXT NOT NULL,
      hire_date TEXT NOT NULL,
      salary INTEGER,
      manager_id TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    CREATE INDEX idx_employees_dept ON employees(department);
    CREATE INDEX idx_employees_email ON employees(email);
  `);
  
  // Insert employees from master data (only those with hr_id)
  const hrPeople = masterData.filter(p => p.hr_id);
  const now = new Date().toISOString();
  
  hrPeople.forEach(person => {
    const salary = person.employment_type === 'FTE' ? 
      (person.role.includes('Director') ? 150000 : 
       person.role.includes('Senior') || person.role.includes('Manager') ? 120000 : 
       85000) : null;
    
    db.prepare(`
      INSERT INTO employees (
        employee_id, first_name, last_name, email, department,
        job_title, employment_type, hire_date, salary, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      person.hr_id,
      person.first_name,
      person.last_name,
      person.email,
      person.department,
      person.role,
      person.employment_type,
      person.hire_date || person.start_date,
      salary,
      now,
      now
    );
  });
  
  db.close();
  console.log(`✅ HR System seeded with ${hrPeople.length} employees`);
  console.log(`   - Coverage: ~${Math.round((hrPeople.length / masterData.length) * 100)}% of workforce`);
  console.log(`   - Path: ${HR_DB_PATH}`);
}

function seedLDAPDirectory(): void {
  console.log('\n🔐 Seeding LDAP/AD (Authoritative Source)...');
  cleanDatabase(LDAP_DB_PATH, 'LDAP/AD');
  
  const db = new Database(LDAP_DB_PATH);
  
  // Create LDAP table
  db.exec(`
    CREATE TABLE users (
      username TEXT PRIMARY KEY,
      distinguished_name TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      department TEXT NOT NULL,
      title TEXT,
      account_enabled BOOLEAN DEFAULT TRUE,
      groups TEXT,
      last_logon TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    CREATE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_users_dept ON users(department);
  `);
  
  // Insert users from master data (only those with ldap_username)
  const ldapPeople = masterData.filter(p => p.ldap_username);
  const now = new Date().toISOString();
  
  ldapPeople.forEach(person => {
    const dn = `CN=${person.first_name} ${person.last_name},OU=${person.department},DC=agency,DC=gov`;
    const groups = person.department === 'Engineering' ? 
      '["Developers", "VPN Users", "GitHub Access"]' :
      '["Finance Staff", "Budget Systems"]';
    
    db.prepare(`
      INSERT INTO users (
        username, distinguished_name, email, first_name, last_name,
        department, title, account_enabled, groups, last_logon,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      person.ldap_username,
      dn,
      person.email,
      person.first_name,
      person.last_name,
      person.department,
      person.role,
      groups,
      now,
      now,
      now
    );
  });
  
  db.close();
  console.log(`✅ LDAP Directory seeded with ${ldapPeople.length} accounts`);
  console.log(`   - Coverage: ~${Math.round((ldapPeople.length / masterData.length) * 100)}% of workforce`);
  console.log(`   - Path: ${LDAP_DB_PATH}`);
}

function seedEngineeringDepartment(): void {
  console.log('\n⚙️  Seeding Engineering Department System...');
  cleanDatabase(ENG_DB_PATH, 'Engineering Department');
  
  const db = new Database(ENG_DB_PATH);
  
  // Create Engineering table
  db.exec(`
    CREATE TABLE employees (
      dept_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      employment_type TEXT NOT NULL,
      hr_employee_id TEXT,
      ldap_username TEXT,
      skills TEXT,
      manager_dept_id TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      gcuid TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    CREATE INDEX idx_eng_email ON employees(email);
    CREATE INDEX idx_eng_hr_id ON employees(hr_employee_id);
    CREATE INDEX idx_eng_gcuid ON employees(gcuid);
  `);
  
  // Insert all Engineering people
  const engPeople = masterData.filter(p => p.eng_id);
  const now = new Date().toISOString();
  
  engPeople.forEach(person => {
    const gcuid = person.gcuid_status === 'active' ? person.gcuid : null;
    
    db.prepare(`
      INSERT INTO employees (
        dept_id, first_name, last_name, email, role, employment_type,
        hr_employee_id, ldap_username, skills, start_date, end_date,
        gcuid, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      person.eng_id,
      person.first_name,
      person.last_name,
      person.email,
      person.role,
      person.employment_type,
      person.hr_id || null,
      person.ldap_username || null,
      person.skills ? JSON.stringify(person.skills) : null,
      person.start_date,
      person.end_date || null,
      gcuid,
      now,
      now
    );
  });
  
  db.close();
  console.log(`✅ Engineering Department seeded with ${engPeople.length} employees`);
  console.log(`   - Complete department coverage: 100%`);
  console.log(`   - Path: ${ENG_DB_PATH}`);
}

function seedFinanceDepartment(): void {
  console.log('\n💰 Seeding Finance Department System...');
  cleanDatabase(FIN_DB_PATH, 'Finance Department');
  
  const db = new Database(FIN_DB_PATH);
  
  // Create Finance table
  db.exec(`
    CREATE TABLE employees (
      dept_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      employment_type TEXT NOT NULL,
      hr_employee_id TEXT,
      ldap_username TEXT,
      clearance_level TEXT,
      manager_dept_id TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      gcuid TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    CREATE INDEX idx_fin_email ON employees(email);
    CREATE INDEX idx_fin_hr_id ON employees(hr_employee_id);
    CREATE INDEX idx_fin_gcuid ON employees(gcuid);
    CREATE INDEX idx_fin_clearance ON employees(clearance_level);
  `);
  
  // Insert all Finance people
  const finPeople = masterData.filter(p => p.fin_id);
  const now = new Date().toISOString();
  
  finPeople.forEach(person => {
    const gcuid = person.gcuid_status === 'active' ? person.gcuid : null;
    
    db.prepare(`
      INSERT INTO employees (
        dept_id, first_name, last_name, email, role, employment_type,
        hr_employee_id, ldap_username, clearance_level, start_date, end_date,
        gcuid, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      person.fin_id,
      person.first_name,
      person.last_name,
      person.email,
      person.role,
      person.employment_type,
      person.hr_id || null,
      person.ldap_username || null,
      person.clearance_level || null,
      person.start_date,
      person.end_date || null,
      gcuid,
      now,
      now
    );
  });
  
  db.close();
  console.log(`✅ Finance Department seeded with ${finPeople.length} employees`);
  console.log(`   - Complete department coverage: 100%`);
  console.log(`   - Path: ${FIN_DB_PATH}`);
}

// ============================================================================
// Main Execution
// ============================================================================

function main() {
  try {
    // CLI flags (sub-phase 3.1): each source server can self-bootstrap by
    // invoking this script with --source=<name>. The default (no flag)
    // preserves the legacy "seed everything" behavior.
    //
    //   tsx seed-data.ts                      seed everything (legacy default)
    //   tsx seed-data.ts --source=hr          seed only conn-hr.db
    //   tsx seed-data.ts --source=ldap        seed only conn-ldap.db
    //   tsx seed-data.ts --source=engineering seed only conn-engineering.db
    //   tsx seed-data.ts --source=finance     seed only conn-finance.db
    //   tsx seed-data.ts --registry           seed only the central registry
    //   tsx seed-data.ts --all                seed everything (explicit)
    const args = process.argv.slice(2);
    const flag = args.find((a) => a.startsWith('--')) ?? null;

    if (flag === '--registry') {
      initializeCentralRegistry();
      return;
    }

    if (flag?.startsWith('--source=')) {
      const name = flag.split('=')[1];
      switch (name) {
        case 'hr':          return seedHRSystem();
        case 'ldap':        return seedLDAPDirectory();
        case 'engineering': return seedEngineeringDepartment();
        case 'finance':     return seedFinanceDepartment();
        default:
          console.error(`❌ Unknown --source value: ${name}. Expected hr|ldap|engineering|finance.`);
          process.exit(1);
      }
    }

    // Default (legacy) — seed everything.
    // Initialize all databases
    initializeCentralRegistry();
    seedHRSystem();
    seedLDAPDirectory();
    seedEngineeringDepartment();
    seedFinanceDepartment();

    console.log('\n' + '='.repeat(60));
    console.log('✨ Federal Architecture Seed Data Complete!');
    console.log('='.repeat(60));
    console.log('\n📊 Coverage Summary:');
    console.log(`   Total Unique People: ${masterData.length}`);
    console.log(`   - Engineering: ${masterData.filter(p => p.eng_id).length} employees`);
    console.log(`   - Finance: ${masterData.filter(p => p.fin_id).length} employees`);
    console.log('\n📦 Authoritative Sources (Partial Coverage):');
    console.log(`   - HR System: ${masterData.filter(p => p.hr_id).length} records (~${Math.round(masterData.filter(p => p.hr_id).length / masterData.length * 100)}%)`);
    console.log(`   - LDAP/AD: ${masterData.filter(p => p.ldap_username).length} records (~${Math.round(masterData.filter(p => p.ldap_username).length / masterData.length * 100)}%)`);
    console.log('\n🏢 Department Systems (Complete Coverage):');
    console.log(`   - Engineering Dept: ${masterData.filter(p => p.eng_id).length} employees (100%)`);
    console.log(`   - Finance Dept: ${masterData.filter(p => p.fin_id).length} employees (100%)`);
    console.log('\n🆔 GCUID Status:');
    console.log(`   - Active: ${masterData.filter(p => p.gcuid_status === 'active').length}`);
    console.log(`   - Pending: ${masterData.filter(p => p.gcuid_status === 'pending').length}`);
    console.log(`   - Not Yet Requested: ${masterData.filter(p => p.gcuid_status === 'none').length}`);
    console.log('\n🧪 Notable Test Cases:');
    console.log('   - Near-duplicate names: ENG-026 "Thomas Martin" vs FIN-016 "Martin Thomas"');
    console.log('   - Shared family name: ENG-002 "Maria Chen" vs FIN-024 "William Chen"');
    console.log('   - French names with accents: Gagnon, Côté, Lefebvre, Tremblay, etc.');
    console.log('   - Detail/secondment workers: no HR record, LDAP + dept only');
    console.log('\n📂 Database Files:');
    console.log(`   - Registry: ${REGISTRY_DB_PATH}`);
    console.log(`   - HR System: ${HR_DB_PATH}`);
    console.log(`   - LDAP/AD: ${LDAP_DB_PATH}`);
    console.log(`   - Engineering: ${ENG_DB_PATH}`);
    console.log(`   - Finance: ${FIN_DB_PATH}`);
    console.log('\nNext Steps:');
    console.log('   1. Start all services (from repo root): ./start-dev.sh');
    console.log('      or: ./start-dev.ps1 / start-dev.bat');
    console.log('      or (from staging/): npm run start-all');
    console.log('   2. View architecture: docs/guidebook-architect.md (the canonical reference)');
    console.log('   3. Open Web UI: http://localhost:5181');
    console.log('');

  } catch (error) {
    console.error('\n❌ Error seeding data:', error);
    process.exit(1);
  }
}

main();
