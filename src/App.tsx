import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'

// Route-level splitting (Plans 3-5 deferred it here): echarts + each page leave the entry
// chunk; Login and the 404 stay eager (first paint must not wait on a chunk).
const OverviewPage = lazy(() => import('./pages/OverviewPage'))
const MonthlyUpdatePage = lazy(() => import('./pages/MonthlyUpdatePage'))
const NetWorthPage = lazy(() => import('./pages/NetWorthPage'))
const SpendingPage = lazy(() => import('./pages/SpendingPage'))
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'))
const TaxesPage = lazy(() => import('./pages/TaxesPage'))
const EsppPage = lazy(() => import('./pages/EsppPage'))
const PaycheckPage = lazy(() => import('./pages/PaycheckPage'))
const CompPage = lazy(() => import('./pages/CompPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const ProjectionPage = lazy(() => import('./pages/ProjectionPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/update" element={<MonthlyUpdatePage />} />
              <Route path="/net-worth" element={<NetWorthPage />} />
              <Route path="/spending" element={<SpendingPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/taxes" element={<TaxesPage />} />
              <Route path="/espp" element={<EsppPage />} />
              <Route path="/paycheck" element={<PaycheckPage />} />
              <Route path="/comp" element={<CompPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/projection" element={<ProjectionPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
