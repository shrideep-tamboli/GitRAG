"use client"

import { Network, Database, GitBranch, Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/AuthContext"
import { Card } from "@/components/ui/card"

export default function HomeSection() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f9f9f7]">
        <div className="animate-pulse text-gray-800 font-medium">Loading...</div>
      </div>
    )
  }

  return (
    <section id="home" className="min-h-screen flex items-center justify-center p-8 bg-[#f9f9f7]">
      <div className="flex flex-col gap-8 items-center max-w-3xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#f8b878]">
            <Brain className="w-7 h-7 text-gray-800" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800">GitRAG</h1>
        </div>

        <p className="text-center text-lg mb-6 text-gray-600">
          Enhancing AI coding assistants by building a knowledge graph from GitHub repositories that contain solutions
          to similar problems.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl mb-8">
          <Card className="flex flex-col items-center gap-3 p-6 border-2 border-gray-800/20 bg-[#fdf6e3] text-gray-800">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#f8b878]">
              <Network className="w-7 h-7 text-gray-800" />
            </div>
            <h3 className="font-semibold text-lg">Knowledge Graph</h3>
            <p className="text-sm text-center text-gray-600">
              Creates connections between code repositories based on problem-solving patterns and solutions
            </p>
          </Card>

          <Card className="flex flex-col items-center gap-3 p-6 border-2 border-gray-800/20 bg-[#fdf6e3] text-gray-800">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#f8b878]">
              <Database className="w-7 h-7 text-gray-800" />
            </div>
            <h3 className="font-semibold text-lg">Smart Context</h3>
            <p className="text-sm text-center text-gray-600">
              Provides AI with relevant code examples from similar projects and solutions
            </p>
          </Card>
        </div>

        {user ? (
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            <Button
              className="rounded-lg bg-[#f8b878] text-gray-800 border-0 transition-all flex items-center justify-center hover:bg-[#f6a55f] hover:shadow-md text-sm sm:text-base h-10 sm:h-12 px-6 sm:px-8 font-medium"
              onClick={() => {
                const connectRepoSection = document.getElementById("connect-repo")
                connectRepoSection?.scrollIntoView({ behavior: "smooth" })
              }}
            >
              <GitBranch className="w-5 h-5 mr-2" />
              Connect Git Repository
            </Button>
          </div>
        ) : (
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            <p className="text-red-500 font-medium">Please sign in to connect your Git repository.</p>
            <a
              className="rounded-lg bg-[#f8b878] text-gray-800 border-0 transition-all flex items-center justify-center hover:bg-[#f6a55f] hover:shadow-md text-sm sm:text-base h-10 sm:h-12 px-6 sm:px-8 font-medium"
              href="/auth/signin"
            >
              Sign In
            </a>
          </div>
        )}
      </div>
    </section>
  )
}
