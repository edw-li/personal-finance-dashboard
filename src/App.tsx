import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import MonthlyUpdatePage from './pages/MonthlyUpdatePage'
import NetWorthPage from './pages/NetWorthPage'
import PlaceholderPage from './pages/PlaceholderPage'
import PortfolioPage from './pages/PortfolioPage'
import SpendingPage from './pages/SpendingPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<PlaceholderPage title="Overview" />} />
              <Route path="/update" element={<MonthlyUpdatePage />} />
              <Route path="/net-worth" element={<NetWorthPage />} />
              <Route path="/spending" element={<SpendingPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/taxes" element={<PlaceholderPage title="Taxes" />} />
              <Route path="/espp" element={<PlaceholderPage title="ESPP" />} />
              <Route path="/paycheck" element={<PlaceholderPage title="Paycheck" />} />
              <Route path="/comp" element={<PlaceholderPage title="Comp" />} />
              <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
              <Route path="*" element={<PlaceholderPage title="Not Found" />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
