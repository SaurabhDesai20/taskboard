import { useHealth } from '../api/health'

export function HomePage() {
  return (
    <section aria-labelledby="home-title">
      <h1 id="home-title">Welcome to TaskBoard</h1>
      <ApiStatus />
    </section>
  )
}

function ApiStatus() {
  const health = useHealth()

  let text: string
  if (health.isPending) {
    text = 'Checking API...'
  } else if (health.isError) {
    text = 'API unavailable'
  } else {
    text = `API ${health.data.status}, database ${health.data.database}`
  }

  return (
    <p className="api-status" role="status">
      {text}
    </p>
  )
}
