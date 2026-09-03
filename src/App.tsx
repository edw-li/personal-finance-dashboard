import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { ROUTE_CHUNKS } from './components/routeChunks'
import ThemeProvider from './components/shell/ThemeProvider'
import ToastProvider from './components/ToastProvider'
import { AuthProvider } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import LandingRedirect from './prefs/LandingRedirect'
import SessionPrefs from './prefs/SessionPrefs'

// Route-level splitting (Plans 3-5 deferred it here): echarts + each page leave the entry
// chunk; Login and the 404 stay eager (first paint must not wait on a chunk). The import
// thunks live in routeChunks.ts so hover/idle prefetch (Layout) resolves the SAME modules
// lazy() mounts.
const OverviewPage = lazy(ROUTE_CHUNKS['/'])
const MonthlyUpdatePage = lazy(ROUTE_CHUNKS['/update'])
const NetWorthPage = lazy(ROUTE_CHUNKS['/net-worth'])
const SpendingPage = lazy(ROUTE_CHUNKS['/spending'])
const PortfolioPage = lazy(ROUTE_CHUNKS['/portfolio'])
const CreditCardsPage = lazy(ROUTE_CHUNKS['/credit-cards'])
const TaxesPage = lazy(ROUTE_CHUNKS['/taxes'])
const EsppPage = lazy(ROUTE_CHUNKS['/espp'])
const PaycheckPage = lazy(ROUTE_CHUNKS['/paycheck'])
const CompPage = lazy(ROUTE_CHUNKS['/comp'])
const CalendarPage = lazy(ROUTE_CHUNKS['/calendar'])
const ProjectionPage = lazy(ROUTE_CHUNKS['/projection'])
const SettingsPage = lazy(ROUTE_CHUNKS['/settings'])

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SessionPrefs />
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<Layout />}>
                  <Route
                    path="/"
                    element={
                      <LandingRedirect>
                        <OverviewPage />
                      </LandingRedirect>
                    }
                  />
                  <Route path="/update" element={<MonthlyUpdatePage />} />
                  <Route path="/net-worth" element={<NetWorthPage />} />
                  <Route path="/spending" element={<SpendingPage />} />
                  <Route path="/portfolio" element={<PortfolioPage />} />
                  <Route path="/credit-cards" element={<CreditCardsPage />} />
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
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
