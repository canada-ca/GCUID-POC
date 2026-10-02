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
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import PortalLayout from './components/PortalLayout';
import PortalIndexPage from './pages/PortalIndexPage';
import UserPortal from './pages/UserPortal';
import RegistrationPortal from './pages/RegistrationPortal';
import HelpDeskPortal from './pages/HelpDeskPortal';
import HelpDeskRegistrationPortal from './pages/HelpDeskRegistrationPortal';
import HRPortal from './pages/HRPortal';
import LDAPPortal from './pages/LDAPPortal';
import EngineeringPortal from './pages/EngineeringPortal';
import FinancePortal from './pages/FinancePortal';
import GCUIDPortal from './pages/GCUIDPortal';
import CAESPortal from './pages/CAESPortal';
import SourceSystemsPortal from './pages/SourceSystemsPortal';
import OptionsPortal from './pages/OptionsPortal';
import LogsPortal from './pages/LogsPortal';
import DashboardPortal from './pages/DashboardPortal';
import TestingPortal from './pages/TestingPortal';
import DatabasesPortal from './pages/DatabasesPortal';
import ToolsPortal from './pages/ToolsPortal';
import UXPortal from './pages/UXPortal';
import SystemPortal from './pages/SystemPortal';
import CorporateAppPortal from './pages/CorporateAppPortal';
import PolicyPortal from './pages/PolicyPortal';
import AboutPortal from './pages/AboutPortal';
import { usePortalModeContext } from './context/PortalModeContext';

function App() {
  const { mode } = usePortalModeContext();

  if (mode === 'separate') {
    return (
      <Routes>
        {/* Root shows the portal launcher */}
        <Route path="/" element={<PortalIndexPage />} />
        {/* Each portal route uses the per-portal header */}
        <Route element={<PortalLayout />}>
          <Route path="user"        element={<UserPortal />} />
          <Route path="register"    element={<RegistrationPortal />} />
          <Route path="helpdesk"          element={<HelpDeskPortal />} />
          <Route path="helpdesk/register" element={<HelpDeskRegistrationPortal />} />
          <Route path="hr"          element={<HRPortal />} />
          <Route path="ldap"        element={<LDAPPortal />} />
          <Route path="engineering" element={<EngineeringPortal />} />
          <Route path="finance"     element={<FinancePortal />} />
          <Route path="gcuid"       element={<GCUIDPortal />} />
          <Route path="caes"        element={<CAESPortal />} />
          <Route path="sources"     element={<SourceSystemsPortal />} />
          <Route path="options"     element={<OptionsPortal />} />
          <Route path="logs"        element={<LogsPortal />} />
          <Route path="dashboard"   element={<DashboardPortal />} />
          <Route path="testing"     element={<TestingPortal />} />
          <Route path="databases"   element={<DatabasesPortal />} />
          <Route path="tools"       element={<ToolsPortal />} />
          <Route path="ux"          element={<UXPortal />} />
          <Route path="system"      element={<SystemPortal />} />
          <Route path="apps"        element={<CorporateAppPortal />} />
          <Route path="apps/:appId" element={<CorporateAppPortal />} />
          <Route path="policies"    element={<PolicyPortal />} />
          <Route path="about"       element={<AboutPortal />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/user" replace />} />
        <Route path="user"        element={<UserPortal />} />
        <Route path="register"    element={<RegistrationPortal />} />
        <Route path="helpdesk"          element={<HelpDeskPortal />} />
        <Route path="helpdesk/register" element={<HelpDeskRegistrationPortal />} />
        <Route path="hr"          element={<HRPortal />} />
        <Route path="ldap"        element={<LDAPPortal />} />
        <Route path="engineering" element={<EngineeringPortal />} />
        <Route path="finance"     element={<FinancePortal />} />
        <Route path="gcuid"       element={<GCUIDPortal />} />
        <Route path="caes"        element={<CAESPortal />} />
        <Route path="sources"     element={<SourceSystemsPortal />} />
        <Route path="options"     element={<OptionsPortal />} />
        <Route path="logs"        element={<LogsPortal />} />
        <Route path="dashboard"   element={<DashboardPortal />} />
        <Route path="testing"     element={<TestingPortal />} />
        <Route path="databases"   element={<DatabasesPortal />} />
        <Route path="tools"       element={<ToolsPortal />} />
        <Route path="ux"          element={<UXPortal />} />
        <Route path="system"      element={<SystemPortal />} />
        <Route path="apps"        element={<CorporateAppPortal />} />
        <Route path="apps/:appId" element={<CorporateAppPortal />} />
        <Route path="policies"    element={<PolicyPortal />} />
        <Route path="about"       element={<AboutPortal />} />
      </Route>
    </Routes>
  );
}

export default App;
