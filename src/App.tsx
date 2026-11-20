import { useCallback, useEffect, useState } from 'react'
import { AdminPage } from './pages/AdminPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { PatientPage } from './pages/PatientPage.tsx'

function getPathname(): string {
  return window.location.pathname.replace(/\/+$/, '') || '/'
}

export function App() {
  const [pathname, setPathname] = useState<string>(getPathname)

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, '', nextPath)
    setPathname(getPathname())
  }, [])

  useEffect(() => {
    const onPopState = () => setPathname(getPathname())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (pathname === '/admin') {
    return <AdminPage onNavigate={navigate} />
  }

  const clinicMatch = pathname.match(/^\/c\/([^/]+)$/)
  if (clinicMatch) {
    return <PatientPage slug={decodeURIComponent(clinicMatch[1])} />
  }

  return <HomePage onNavigate={navigate} />
}
