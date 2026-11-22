import type { RouteObject } from 'react-router'
import { AppLayout } from './AppLayout'
import { HomePage } from './HomePage'
import { NotFoundPage } from './NotFoundPage'

// Route table shared by the browser router (App.tsx) and the memory router in tests.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
