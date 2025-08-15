"use client"

import { Network, MessageSquareCode, GitBranch, Brain, Code2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/AuthContext"
import { Card } from "@/components/ui/card"

export default function HomeSection() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-foreground font-medium">Loading...</div>
      </div>
    )
  }

  return (
    <section id="home" className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="flex flex-col gap-8 items-center max-w-4xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-accent">
            <Brain className="w-7 h-7 text-accent-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">GitRAG</h1>
        </div>

        <div className="text-center space-y-4 mb-6">
          <h2 className="text-2xl font-bold text-foreground">
            Chat with GitHub Repositories
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-4xl mb-8">
          <Card className="flex flex-col items-center gap-3 p-6 border border-border/60 bg-card text-foreground">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-accent">
              <Network className="w-7 h-7 text-accent-foreground" />
            </div>
            <h3 className="font-semibold text-lg">Knowledge Graph</h3>
            <p className="text-sm text-center text-justify text-muted">
              Visualize your repository's structure in an interactive 3D graph. Click on files to view code and summaries instantly.
            </p>
          </Card>

          <Card className="flex flex-col items-center gap-3 p-6 border border-border/60 bg-card text-foreground">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-accent">
              <MessageSquareCode className="w-7 h-7 text-accent-foreground" />
            </div>
            <h3 className="font-semibold text-lg">Smart Code Chat</h3>
            <p className="text-sm text-center text-justify text-muted">
              Ask questions about your code, request explanations, or get help with specific features directly through chat.
            </p>
          </Card>

          <Card className="flex flex-col items-center gap-3 p-6 border border-border/60 bg-card text-foreground">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-accent">
              <Code2 className="w-7 h-7 text-accent-foreground" />
            </div>
            <h3 className="font-semibold text-lg">Framework Support</h3>
            <p className="text-sm text-center text-justify text-muted">
              Generate code for newly launched frameworks and libraries, even those released after AI training cutoffs.
            </p>
          </Card>
        </div>

        <Card className="w-full max-w-4xl p-6 border border-border/60 bg-card text-foreground">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="flex-1 space-y-4">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-accent" />
                Why Choose GitRAG?
              </h3>
              <ul className="space-y-2 text-muted">
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>Understand complex codebases quickly through visual exploration</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>Get instant code summaries and documentation for any file</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>Access up-to-date knowledge about the latest frameworks and libraries</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <span>Generate code that's compatible with the newest technologies</span>
                </li>
              </ul>
            </div>
          </div>
        </Card>

        {user ? (
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            <Button
              className="rounded-lg bg-accent text-accent-foreground border-0 transition-all flex items-center justify-center hover:bg-accent/90 hover:shadow-md text-sm sm:text-base h-10 sm:h-12 px-6 sm:px-8 font-medium"
              onClick={() => {
                const connectRepoSection = document.getElementById("connect-repo")
                connectRepoSection?.scrollIntoView({ behavior: "smooth" })
              }}
            >
              <GitBranch className="w-5 h-5 mr-2" />
              Connect Your Repository
            </Button>
          </div>
        ) : (
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            <div className="text-center space-y-2">
              <p className="text-foreground font-medium">Get started by signing in to connect your repository</p>
              <a
                className="rounded-lg bg-accent text-accent-foreground border-0 transition-all flex items-center justify-center hover:bg-accent/90 hover:shadow-md text-sm sm:text-base h-10 sm:h-12 px-6 sm:px-8 font-medium"
                href="/auth/signin"
              >
                Sign In to Begin
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
