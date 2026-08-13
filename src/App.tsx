import { BrowserRouter, Route, Routes } from 'react-router-dom'
import PlaceholderPage from './pages/PlaceholderPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<PlaceholderPage title="Finance Dashboard" />} />
      </Routes>
    </BrowserRouter>
  )
}
