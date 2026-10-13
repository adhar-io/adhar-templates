import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// TanStack Start looks for this factory by name.
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  })
}
