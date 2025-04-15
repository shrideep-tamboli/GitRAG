"use client"

import { Network, MessageSquareCode, GitBranch, Brain, Code2, Sparkles } from "lucide-react"
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
      <div className="flex flex-col gap-8 items-center max-w-4xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#f8b878]">
            <Brain className="w-7 h-7 text-gray-800" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800">GitRAG</h1>
        </div>

        <div className="text-center space-y-4 mb-6">
          <h2 className="text-2xl font-bold text-gray-800">
            Chat with GitHub Repositories
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-4xl mb-8">
          <Card className="flex flex-col items-center gap-3 p-6 border-2 border-gray-800/20 bg-[#fdf6e3] text-gray-800">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#f8b878]">
              <Network className="w-7 h-7 text-gray-800" />
            </div>
            <h3 className="font-semibold text-lg">Knowledge Graph</h3>
            <p className="text-sm text-center text-justify text-gray-600">
              Visualize your repository&apos;s structure in an interactive 3D graph. Click on files to view code and summaries instantly.
            </p>
          </Card>

          <Card className="flex flex-col items-center gap-3 p-6 border-2 border-gray-800/20 bg-[#fdf6e3] text-gray-800">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#f8b878]">
              <MessageSquareCode className="w-7 h-7 text-gray-800" />
            </div>
            <h3 className="font-semibold text-lg">Smart Code Chat</h3>
            <p className="text-sm text-center text-justify text-gray-600">
              Ask questions about your code, request explanations, or get help with specific features directly through chat.
            </p>
          </Card>

          <Card className="flex flex-col items-center gap-3 p-6 border-2 border-gray-800/20 bg-[#fdf6e3] text-gray-800">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#f8b878]">
              <Code2 className="w-7 h-7 text-gray-800" />
            </div>
            <h3 className="font-semibold text-lg">Framework Support</h3>
            <p className="text-sm text-center text-justify text-gray-600">
              Generate code for newly launched frameworks and libraries, even those released after AI training cutoffs.
            </p>
          </Card>
        </div>

        <Card className="w-full max-w-4xl p-6 border-2 border-gray-800/20 bg-[#fdf6e3] text-gray-800">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="flex-1 space-y-4">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-[#f8b878]" />
                Why Choose GitRAG?
              </h3>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-[#f8b878]">•</span>
                  <span>Understand complex codebases quickly through visual exploration</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#f8b878]">•</span>
                  <span>Get instant code summaries and documentation for any file</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#f8b878]">•</span>
                  <span>Access up-to-date knowledge about the latest frameworks and libraries</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#f8b878]">•</span>
                  <span>Generate code that&apos;s compatible with the newest technologies</span>
                </li>
              </ul>
            </div>
          </div>
        </Card>

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
              Connect Your Repository
            </Button>
          </div>
        ) : (
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            <div className="text-center space-y-2">
              <p className="text-gray-800 font-medium">Get started by signing in to connect your repository</p>
              <a
                className="rounded-lg bg-[#f8b878] text-gray-800 border-0 transition-all flex items-center justify-center hover:bg-[#f6a55f] hover:shadow-md text-sm sm:text-base h-10 sm:h-12 px-6 sm:px-8 font-medium"
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
