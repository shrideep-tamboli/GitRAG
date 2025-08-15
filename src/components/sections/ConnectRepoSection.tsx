"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/lib/AuthContext"
import { useRepo } from "@/contexts/RepoContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Copy, Link as LinkIcon, Github, GitBranch, GitFork, ExternalLink, MessageSquare, Search, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Header } from "./Header"
import { Footer } from "./Footer"
import { CardFooter } from "@/components/ui/card"

interface RepoItem {
  name: string
  path: string
  type: string
  download_url: string | null
  codeSummary?: string | null
  metadata?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  } | null
}

interface ConnectRepoSectionProps {
  onRepoConnected: () => void
  isLoggedIn?: boolean
}

export default function ConnectRepoSection({ onRepoConnected, isLoggedIn = true }: ConnectRepoSectionProps) {
  const { setIsRepoConnected } = useRepo()
  const { user } = useAuth()
  const [repoUrl, setRepoUrl] = useState("")
  const [inputRepoUrl, setInputRepoUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [contents, setContents] = useState<RepoItem[]>([])
  const [vectorizing, setVectorizing] = useState(false)
  const [vectorizeMessage, setVectorizeMessage] = useState("")
  const [activeTab, setActiveTab] = useState("connect")
  const [statusMessage, setStatusMessage] = useState("")

  // Progress tracking states
  const [showProgress, setShowProgress] = useState(false)
  const [progressPhase, setProgressPhase] = useState<"processing" | "vectorizing">("processing")
  const [currentFile, setCurrentFile] = useState("")
  const [processedFiles, setProcessedFiles] = useState(0)
  const [totalFiles, setTotalFiles] = useState(0)
  const [progressPercentage, setProgressPercentage] = useState(0)

  // Extract repo name from URL for display purposes
  const getRepoNameFromUrl = (url: string) => {
    try {
      const urlObj = new URL(url)
      const pathParts = urlObj.pathname.split("/").filter(Boolean)
      if (pathParts.length >= 2) {
        return `${pathParts[0]}/${pathParts[1]}`
      }
      return url
    } catch {
      return url
    }
  }

  useEffect(() => {
    const fetchConnectedRepo = async () => {
      try {
        const response = await fetch(`/api/get-repo-url?userId=${user?.id}`)
        if (!response.ok) {
          throw new Error("Failed to fetch connected repository")
        }
        const data = await response.json()
        if (data.repoUrl) {
          setRepoUrl(data.repoUrl)
          setIsRepoConnected(true)
          setActiveTab("connected")
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          console.error("Error fetching connected repository:", err.message)
        }
      }
    }

    if (user) {
      fetchConnectedRepo()
    }
  }, [user])

  const handleConnect = async (url = inputRepoUrl) => {
    setLoading(true)
    setError("")
    setContents([])
    setShowProgress(true)
    setProgressPhase("processing")
    setCurrentFile("")
    setProcessedFiles(0)
    setTotalFiles(0)
    setProgressPercentage(0)

    const startTime = performance.now() // Start time

    try {
      // Set up EventSource for processing progress updates
      const eventSource = new EventSource(`/api/connect-repo/progress?userId=${user?.id}`)
      
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.totalFiles > 0) {
          setTotalFiles(data.totalFiles)
          setProcessedFiles(data.processedFiles)
          setCurrentFile(data.currentFile || "")
          setProgressPercentage(Math.floor((data.processedFiles / data.totalFiles) * 100))
        }
      }
      
      eventSource.onerror = () => {
        eventSource.close()
      }
      
      const response = await fetch("/api/connect-repo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          userId: user?.id,
        }),
      })
      
      // Close the event source when processing is done
      eventSource.close()

      const endTime = performance.now() // End time
      const duration = endTime - startTime // Calculate duration
      console.log(`Request to /api/connect-repo took ${duration.toFixed(2)} ms`)

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to connect to the repository")
      }

      if (data.message) {
        setError(data.message)
        setStatusMessage("")
      } else {
        setContents(data.contents)
        setRepoUrl(url)
        setIsRepoConnected(true)
        setInputRepoUrl("")
        setActiveTab("connected")
        setActiveTab("connected")

        await fetch("/api/repo-structure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repoUrl: url,
            repoStructure: data.contents,
            userId: user?.id,
          }),
        })

        setVectorizing(true)
        setProgressPhase("vectorizing")
        setProcessedFiles(0)
        setProgressPercentage(0)

        // Set up EventSource for vectorizing progress updates
        const vectorizeEventSource = new EventSource(`/api/vectorize/progress?userId=${user?.id}`)
        
        vectorizeEventSource.onmessage = (event) => {
          const data = JSON.parse(event.data)
          if (data.totalFiles > 0) {
            setTotalFiles(data.totalFiles)
            setProcessedFiles(data.processedFiles)
            setCurrentFile(data.currentFile || "")
            setProgressPercentage(Math.floor((data.processedFiles / data.totalFiles) * 100))
          }
        }
        
        vectorizeEventSource.onerror = () => {
          vectorizeEventSource.close()
        }

        try {
          const startTime = performance.now() // Start time for vectorize request
          await fetch("/api/vectorize", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ userId: user?.id }),
          })
          const endTime = performance.now() // End time for vectorize request
          const duration = endTime - startTime // Calculate duration
          console.log(`Request to /api/vectorize took ${duration.toFixed(2)} ms`)
          setStatusMessage(`${getRepoNameFromUrl(url)} is ready to use`)
          onRepoConnected()
        } catch (vectorizeError: unknown) {
          console.error("Error vectorizing graph:", vectorizeError)
          setVectorizeMessage("Error vectorizing graph")
          setStatusMessage(`Error vectorizing ${getRepoNameFromUrl(url)}`)
        } finally {
          setVectorizing(false)
          setShowProgress(false)
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
        setStatusMessage("")
      } else {
        setError("An unexpected error occurred.")
        setStatusMessage("")
      }
    } finally {
      setLoading(false)
    }
  }

  const handleExampleClick = (repoUrl: string) => {
    setInputRepoUrl(repoUrl)
    handleConnect(repoUrl)
  }

  const exampleRepos = [{ name: "GitRAG", url: "https://github.com/shrideep-tamboli/GitRAG" }]

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <section id="connect-repo" className="py-12 px-4 max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="flex flex-col justify-center space-y-6">

              {/* Main heading with gradient */}
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
                <span className="text-foreground">Chat with</span>
                <br />
                <span className="bg-gradient-to-r from-accent to-accent/60 bg-clip-text text-transparent">
                  Github Repository
                </span>
              </h1>

              {/* Feature list */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3">
                  <div className="bg-accent/15 p-2 rounded-full">
                    <MessageSquare className="h-5 w-5 text-accent" />
                  </div>
                  <span className="text-muted">Ask questions about your code</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-accent/15 p-2 rounded-full">
                    <Search className="h-5 w-5 text-accent" />
                  </div>
                  <span className="text-muted">Search through repository content</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-accent/15 p-2 rounded-full">
                    <Sparkles className="h-5 w-5 text-accent" />
                  </div>
                  <span className="text-muted">Get AI-powered code explanations</span>
                </div>
              </div>

            </div>

            <Card className="border border-border/60 rounded-xl bg-card shadow-lg overflow-hidden">
              <CardHeader className="pb-2 border-b border-border/60">
                <CardTitle className="text-2xl font-bold flex items-center gap-2 text-foreground">
                  <GitBranch className="h-6 w-6" />
                  Repository Connection
                </CardTitle>
                <CardDescription className="text-muted">
                  {isLoggedIn 
                    ? "Connect to a Git repository to chat with it" 
                    : "Login to Chat with Github repository"}
                </CardDescription>
              </CardHeader>

              {isLoggedIn ? (
                <>
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <div className="px-6 pt-4">
                      <TabsList className="grid w-full grid-cols-2 bg-surface p-1 rounded-lg border border-border/60">
                        <TabsTrigger
                          value="connect"
                          className="rounded-md data-[state=active]:bg-accent data-[state=active]:text-accent-foreground text-muted"
                        >
                          Connect Repository
                        </TabsTrigger>
                        <TabsTrigger
                          value="connected"
                          disabled={!repoUrl}
                          className="rounded-md data-[state=active]:bg-accent data-[state=active]:text-accent-foreground text-muted"
                        >
                          Connected Repository
                          {repoUrl && (
                            <Badge variant="outline" className="ml-2 bg-accent/20 text-accent border-accent/30">
                              1
                            </Badge>
                          )}
                        </TabsTrigger>
                      </TabsList>
                    </div>

                    <TabsContent value="connect" className="p-6 pt-4">
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <label htmlFor="repo-url" className="text-sm font-medium text-muted">
                            Repository URL
                          </label>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Github className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted h-4 w-4" />
                              <Input
                                id="repo-url"
                                type="text"
                                value={inputRepoUrl}
                                onChange={(e) => setInputRepoUrl(e.target.value)}
                                placeholder="   https://github.com/username/repository"
                                className="pl-10 border border-border/60 rounded-lg p-3 bg-surface text-foreground focus:ring-2 focus:ring-accent"
                              />
                            </div>
                            <Button
                              onClick={() => handleConnect()}
                              disabled={loading || vectorizing || !inputRepoUrl}
                              className="whitespace-nowrap rounded-lg border-0 transition-all bg-accent text-accent-foreground font-medium px-6 hover:bg-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px]"
                            >
                              {loading ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Connecting...
                                </>
                              ) : vectorizing ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Vectorizing...
                                </>
                              ) : (
                                "Connect"
                              )}
                            </Button>
                          </div>
                          {error && <div className="text-sm text-red-500 mt-1">{error}</div>}
                          {statusMessage && !error && (
                            <div className="text-sm text-muted mt-2 font-medium py-1">{statusMessage}</div>
                          )}
                          {vectorizeMessage && (
                            <div className="text-sm text-muted mt-2 font-medium py-1">{vectorizeMessage}</div>
                          )}
                        </div>
                        
                        <div>
                          {/* Progress bar */}
                          {showProgress && (
                            <div className="px-6 py-4 border-b border-border/60">
                              <div className="mb-2 flex justify-between items-center">
                                <span className="text-sm font-medium text-muted">
                                  {progressPhase === "processing" ? "Processing" : "Vectorizing"}: {processedFiles}/{totalFiles} files
                                </span>
                                <span className="text-sm text-muted">{progressPercentage}%</span>
                              </div>
                              <div className="w-full bg-muted/30 rounded-full h-2.5">
                                <div 
                                  className="bg-accent h-2.5 rounded-full transition-all duration-300 ease-in-out" 
                                  style={{ width: `${progressPercentage}%` }}
                                ></div>
                              </div>
                              {currentFile && (
                                <div className="mt-2 text-xs text-muted truncate" title={currentFile}>
                                  {progressPhase === "processing" ? "Processing" : "Vectorizing"}: {currentFile}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div>
                          <h3 className="text-sm font-medium mb-3 text-muted">Quick Connect Examples</h3>
                          <div className="flex flex-wrap gap-2">
                            {exampleRepos.map((repo) => (
                              <Button
                                key={repo.name}
                                variant="outline"
                                size="sm"
                                onClick={() => handleExampleClick(repo.url)}
                                disabled={loading || vectorizing}
                                className="flex items-center gap-1.5 bg-card border border-border/60 text-foreground px-4 py-2 rounded-lg hover:border-accent disabled:opacity-50"
                              >
                                <GitFork className="h-3.5 w-3.5" />
                                {repo.name}
                              </Button>
                            ))}
                          </div>
                        </div>

                        {contents.length > 0 && (
                          <div className="space-y-3 pt-2">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-medium text-muted">Repository Contents</h3>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-muted hover:bg-accent/10 hover:text-foreground"
                              >
                                <Copy className="h-3.5 w-3.5 mr-1.5" />
                                Copy
                              </Button>
                            </div>
                            <Card className="border border-border/60 rounded-lg bg-card">
                              <CardContent className="p-3">
                                <div className="max-h-[240px] overflow-y-auto pr-2 space-y-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                                  {contents.map((item, index) => (
                                    <div
                                      key={index}
                                      className="flex items-start py-1 border-b border-border/60 last:border-0"
                                    >
                                      <div className="text-xs text-muted mr-2 mt-0.5">
                                        {item.type === "dir" ? "📁" : "📄"}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate text-foreground">{item.name}</div>
                                        <div className="text-xs text-muted">{item.path}</div>
                                      </div>
                                      {item.download_url && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2 text-accent hover:bg-accent/10 hover:text-accent"
                                          asChild
                                        >
                                          <a href={item.download_url} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            <span className="sr-only">View</span>
                                          </a>
                                        </Button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="connected" className="p-6 pt-4">
                      {repoUrl ? (
                        <div className="space-y-6">
                          <div className="space-y-2">
                            <h3 className="text-sm font-medium text-muted">Connected Repository URL</h3>
                            <Card className="border border-border/60 rounded-lg bg-card">
                              <CardContent className="p-4 flex items-center gap-2">
                                <Github className="h-5 w-5 text-muted" />
                                <div className="flex-1 font-mono text-sm break-all text-foreground">{repoUrl}</div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-muted hover:bg-accent/10 hover:text-foreground"
                                  onClick={() => navigator.clipboard.writeText(repoUrl)}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  <span className="sr-only">Copy URL</span>
                                </Button>
                              </CardContent>
                            </Card>
                          </div>

                          <div className="pt-2">
                            <Button
                              onClick={() => {
                                onRepoConnected()
                                const chatSection = document.getElementById("chat-section")
                                chatSection?.scrollIntoView({ behavior: "smooth" })
                              }}
                              className="w-full rounded-lg border-0 transition-all bg-accent text-accent-foreground font-medium h-12 px-6 hover:bg-accent/90 hover:shadow-md"
                            >
                              <LinkIcon className="mr-2 h-4 w-4" />
                              Chat
                            </Button>
                          </div>

                          <div className="pt-2">
                            <Button
                              variant="outline"
                              onClick={() => setActiveTab("connect")}
                              className="w-full bg-card border border-border/60 text-foreground px-4 py-2 rounded-lg hover:border-accent"
                            >
                              Connect to a Different Repository
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="py-8 text-center">
                          <div className="text-muted mb-4">No repository connected yet</div>
                          <Button
                            onClick={() => setActiveTab("connect")}
                            className="rounded-lg border-0 transition-all bg-accent text-accent-foreground font-medium h-12 px-6 hover:bg-accent/90 hover:shadow-md"
                          >
                            Connect a Repository
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>

                  <CardFooter className="flex justify-between border-t border-border/60 p-4 bg-surface/60">
                    <div className="text-xs text-muted">Connected as: {user?.email || "Guest"}</div>
                    {statusMessage && (
                      <div className="text-xs font-medium text-muted max-w-[60%] truncate" title={statusMessage}>
                        {statusMessage}
                      </div>
                    )}
                  </CardFooter>
                </>
              ) : (
                <div className="p-8 flex flex-col items-center justify-center">
                  <div className="text-center mb-6">
                    <Github className="h-12 w-12 mx-auto mb-4 text-muted" />
                    <h3 className="text-xl font-semibold text-foreground mb-2">Sign in to get started</h3>
                    <p className="text-muted max-w-md mx-auto">
                      Login to connect your Github repositories and start chatting with your codebase using AI.
                    </p>
                  </div>
                  <Button 
                    className="w-full max-w-sm rounded-lg border-0 transition-all bg-accent text-accent-foreground font-medium h-12 px-6 hover:bg-accent/90 hover:shadow-md"
                    onClick={() => window.location.href = '/auth/signin'}
                  >
                    Sign in to continue
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
