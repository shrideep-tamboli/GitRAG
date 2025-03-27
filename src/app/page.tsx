"use client"
import { Network, Database, GitBranch, Brain, Linkedin, Github } from "lucide-react"
import Button from "@/components/ui/button"
import { useAuth } from '@/lib/AuthContext'

export default function Home() {
  const { user, loading, signOut } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center max-w-3xl">
        <div className="flex items-center gap-3 mb-4">
          <Brain className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Code Knowledge Graph</h1>
        </div>

        <p className="text-center text-lg mb-6 text-muted-foreground">
          Enhancing AI coding assistants by building a knowledge graph from GitHub repositories that contain solutions
          to similar problems.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl mb-8">
          <div className="flex flex-col items-center gap-3 p-6 rounded-lg border bg-card text-card-foreground shadow-sm">
            <Network className="w-8 h-8 text-primary" />
            <h3 className="font-semibold">Knowledge Graph</h3>
            <p className="text-sm text-center text-muted-foreground">
              Creates connections between code repositories based on problem-solving patterns and solutions
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 p-6 rounded-lg border bg-card text-card-foreground shadow-sm">
            <Database className="w-8 h-8 text-primary" />
            <h3 className="font-semibold">Smart Context</h3>
            <p className="text-sm text-center text-muted-foreground">
              Provides AI with relevant code examples from similar projects and solutions
            </p>
          </div>
        </div>

        {user ? (
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            <Button
              className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] bg-black transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5"
              onClick={() => (window.location.href = "/connect-repo")}
            >
              <GitBranch className="w-5 h-5" />
              Connect Git Repository
            </Button>

            <a
              className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5"
              href="https://github.com/shrideep-tamboli/GitRAG"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn more about the project
            </a>

            <Button
              className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] bg-black transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5"
              onClick={signOut}
            >
              Sign Out
            </Button>
          </div>
        ) : (
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            <p className="text-red-500">Please sign in to connect your Git repository.</p>
            <a
              className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5"
              href="/auth/signin"
            >
              Sign In
            </a>
          </div>
        )}

        <div className="mt-8 p-6 rounded-lg border bg-card text-card-foreground">
          <h3 className="font-semibold mb-4">How it works</h3>
          <ol className="list-decimal list-inside space-y-3 text-sm text-muted-foreground">
            <li>Connect your GitHub repository to start building the knowledge graph</li>
            <li>Our system analyzes code patterns and solutions across repositories</li>
            <li>AI assistants use this graph to provide more contextual and accurate suggestions</li>
            <li>Continuously improves as more repositories are connected and analyzed</li>
          </ol>
        </div>
      </main>

      <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center text-sm text-muted-foreground">
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://www.linkedin.com/in/shrideep-tamboli/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="LinkedIn Profile"
        >
          <Linkedin className="w-4 h-4" />
          LinkedIn
        </a>
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://github.com/shrideep-tamboli"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub Repository"
        >
          <Github className="w-4 h-4" />
          GitHub
        </a>
      </footer>
    </div>
  )
}

