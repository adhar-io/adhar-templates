import { Button, buttonVariants } from '@adhar-ui/react'
import { cn } from '@adhar-ui/utils'

export default function App() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background text-foreground">
      <h1 className="text-4xl font-bold tracking-tight">${{ values.name }}</h1>
      <p className="text-muted-foreground max-w-md text-center">
        ${{ values.description }}
      </p>
      <p className="text-sm text-muted-foreground">
        Built with <strong>Adhar UI</strong> on the Adhar platform.
      </p>
      <div className="flex gap-3">
        <Button>Get started</Button>
        <Button className={cn(buttonVariants({ variant: 'outline' }))}>
          Learn more
        </Button>
      </div>
    </main>
  )
}
