"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, Send, X } from "lucide-react"
import axios from "axios"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useAuth } from '@/lib/AuthContext'

// Dynamically import the force-graph component
const ForceGraph3D = dynamic(() => import("react-force-graph").then((mod) => mod.ForceGraph3D), { ssr: false })

interface Node {
  id: string
  label: string
  type: string
  url: string
  codeSummary?: string
  contentEmbedding?: number[] | null
  summaryEmbedding?: number[] | null
}

interface Link {
  source: string
  target: string
  relationship: string
}

interface GraphData {
  nodes: Node[]
  links: Link[]
}

interface ChatMessage {
  sender: "user" | "bot"
  text: string
}

export default function RepoStructure() {
  const router = useRouter()
  const { user } = useAuth()
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [fileContent, setFileContent] = useState<string>("")
  const [isSideCanvasOpen, setIsSideCanvasOpen] = useState(false)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [chatInput, setChatInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesStartRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  const fetchGraphData = useCallback(async () => {
    if (!user?.id) {
      console.error("No user ID available")
      setError("Please sign in to view the repository structure")
      return
    }

    setLoading(true)
    setError("")

    try {
      console.log(`Fetching graph data for user ID: ${user.id}`)
      const response = await fetch(`/api/repo-structure?userId=${user.id}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch graph data: ${response.statusText}`)
      }
      const data = await response.json()
      console.log("Received graph data:", data)
      
      if (!data.nodes || data.nodes.length === 0) {
        setError("No repository data found. Please connect a repository first.")
        return
      }
      
      console.log("Graph data details:", {
        nodes: data.nodes.length,
        links: data.links ? data.links.length : 0,
        sampleNode: data.nodes[0],
        sampleLink: data.links && data.links.length > 0 ? data.links[0] : null
      })
      
      setGraphData(data)
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error("Error fetching graph data:", err.message)
        setError(err.message)
      } else {
        console.error("An unknown error occurred:", err)
        setError("An unknown error occurred")
      }
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (user?.id) {
      fetchGraphData()
    }
  }, [fetchGraphData, user?.id])

  useEffect(() => {
    messagesStartRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    setWidth(window.innerWidth)
    const handleResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const printNodeDetails = useCallback((node: Node) => {
    console.log("Node Details:")
    console.log(`ID: ${node.id}`)
    console.log(`Label: ${node.label}`)
    console.log(`Type: ${node.type}`)
    console.log(`URL: ${node.url}`)
  }, [])

  const handleNodeClick = useCallback(
    async (node: Node) => {
      setSelectedNode(node)
      setIsSideCanvasOpen(true)
      setFileContent("")

      printNodeDetails(node)

      const fetchFileContent = async (url: string) => {
        setIsLoadingContent(true)
        try {
          if (url.includes("raw.githubusercontent.com")) {
            const response = await axios.get(url)
            setFileContent(response.data)
          } else {
            const rawUrl = url.replace("api.github.com/repos", "raw.githubusercontent.com").replace("/contents/", "/")
            const response = await axios.get(rawUrl)
            setFileContent(response.data)
          }
        } catch (err) {
          console.error("Error fetching file content:", err)
          setFileContent(
            "Failed to load file content. This might be due to file size limitations or access restrictions.",
          )
        } finally {
          setIsLoadingContent(false)
        }
      }

      if (node.type === "File_Url" && node.id) {
        await fetchFileContent(node.id)
      }
    },
    [printNodeDetails],
  )

  const handleSend = async () => {
    if (!chatInput.trim()) return

    const summaries = graphData.nodes.map((node) => ({
      codeSummary: node.codeSummary || "",
      summaryEmbedding: node.summaryEmbedding || null,
      url: node.id,
    }))

    const userMessage = chatInput
    setMessages((prev) => [{ sender: "user", text: userMessage }, ...prev])

    const payload = {
      message: userMessage,
      summaries: summaries,
    }

    setChatInput("")

    try {
      const response = await axios.post("/api/chat", payload)
      console.log("Chat response:", response.data)
      const botReply = response.data.response
      setMessages((prev) => [{ sender: "bot", text: botReply }, ...prev])
    } catch (err) {
      console.error("Error sending chat message:", err)
      setMessages((prev) => [{ sender: "bot", text: "Error: Failed to get response." }, ...prev])
    }
  }

  const closeSideCanvas = () => {
    setIsSideCanvasOpen(false)
    setSelectedNode(null)
  }

  // Function to format JSON for better readability
  const formatCodeSummary = (summary: string) => {
    try {
      // Try to parse as JSON if it's in JSON format
      const jsonObj = JSON.parse(summary)
      return jsonObj
    } catch {
      return summary
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="flex-1 container mx-auto p-8">
        <button
          onClick={() => router.push("/connect-repo")}
          className="mb-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          ← Back to Connect Repo
        </button>

        <div className="border rounded mb-8 flex flex-col" style={{ maxHeight: "640px" }}>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col-reverse">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} mb-2`}>
                <div
                  className={`max-w-[70%] p-3 rounded-lg ${
                    msg.sender === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={messagesStartRef} />
          </div>
          <div className="p-2 border-t flex items-center space-x-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSend()
                }
              }}
              placeholder="Enter your message..."
              className="flex-1 p-2 border rounded-md outline-none focus:ring-2 focus:ring-primary text-black"
            />
            <button
              onClick={handleSend}
              className="p-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              aria-label="Send message"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>

        <Card className="p-6 mb-8">
          <h1 className="text-3xl font-bold mb-2">Repository Knowledge Graph</h1>
          <p className="text-muted-foreground">
            Explore your repository structure in 3D. Click on nodes to view details.
          </p>
        </Card>

        {loading && (
          <div className="flex items-center justify-center h-[600px]">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}

        {error && <div className="p-4 bg-destructive/10 text-destructive rounded-md">{error}</div>}

        {!loading && !error && (
          <div className="flex h-[800px]">
            {/* Graph container - shrinks to 50% width when side canvas is open */}
            <div
              className={`bg-card rounded-lg shadow-xl overflow-hidden relative transition-all duration-300 ease-in-out ${
                isSideCanvasOpen ? "w-1/2" : "w-full"
              }`}
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <div className="w-full h-full">
                <ForceGraph3D
                  graphData={graphData}
                  nodeLabel={(node) => (node as Node).label}
                  nodeColor={(node) => {
                    const typedNode = node as Node
                    return selectedNode?.id === typedNode.id
                      ? "#ff0000"
                      : typedNode.type === "Repo_Url"
                        ? "#003366"
                        : typedNode.type === "Dir_Url"
                          ? "#4CAF50"
                          : typedNode.type === "File_Url"
                            ? "#FF9800"
                            : "#003366"
                  }}
                  nodeRelSize={6}
                  linkWidth={1}
                  linkColor={() => "#2a4858"}
                  linkOpacity={0.8}
                  linkDirectionalParticles={4}
                  linkDirectionalParticleWidth={3}
                  linkDirectionalParticleSpeed={0.006}
                  backgroundColor="#f8f9fa"
                  onNodeClick={(node) => handleNodeClick(node as Node)}
                  width={isSideCanvasOpen ? width / 2 : width}
                  d3AlphaDecay={0.02}
                  d3VelocityDecay={0.3}
                  warmupTicks={100}
                  cooldownTicks={50}
                  nodeId="id"
                  linkSource="source"
                  linkTarget="target"
                />
                <div className="absolute top-4 right-4 bg-white text-black rounded-lg shadow-lg p-4">
                  <h3 className="font-semibold">Node Color Legend</h3>
                  <div className="flex flex-col mt-2">
                    <div className="flex items-center">
                      <div className="w-4 h-4 bg-red-500 rounded-full mr-2"></div>
                      <span>Selected Node</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-4 h-4 bg-blue-800 rounded-full mr-2"></div>
                      <span>Root Folder</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-4 h-4 bg-green-500 rounded-full mr-2"></div>
                      <span>Folder</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-4 h-4 bg-orange-500 rounded-full mr-2"></div>
                      <span>File</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Side Canvas */}
            {isSideCanvasOpen && selectedNode && (
              <div className="w-1/2 bg-card rounded-lg shadow-xl ml-4 overflow-hidden flex flex-col">
                <div className="p-4 border-b flex justify-between items-center">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    {selectedNode?.type === "File_Url" && "📄"}
                    {selectedNode?.type === "Dir_Url" && "📁"}
                    {selectedNode?.type === "Repo_Url" && "📦"}
                    {selectedNode?.label}
                  </h2>
                  <button onClick={closeSideCanvas} className="p-1 hover:bg-muted rounded-full" aria-label="Close">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex-1 p-4">
                  <Tabs defaultValue="details" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="details">Details</TabsTrigger>
                      {selectedNode?.type === "File_Url" && <TabsTrigger value="content">Content</TabsTrigger>}
                      <TabsTrigger value="codeSummary">Code Summary</TabsTrigger>
                    </TabsList>

                    <TabsContent value="details" className="mt-4">
                      <div className="custom-scrollbar h-[600px] p-4 space-y-4">
                        <div>
                          <h3 className="font-semibold mb-1">Type</h3>
                          <p className="text-muted-foreground">
                            {selectedNode?.type === "File_Url" && "File"}
                            {selectedNode?.type === "Dir_Url" && "Directory"}
                            {selectedNode?.type === "Repo_Url" && "Repository"}
                          </p>
                        </div>
                        <div>
                          <h3 className="font-semibold mb-1">Path</h3>
                          <p>{selectedNode?.url}</p>
                        </div>
                        {selectedNode?.type === "File_Url" && (
                          <div>
                            <a
                              href={selectedNode.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              Open in GitHub ↗
                            </a>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {selectedNode?.type === "File_Url" && (
                      <TabsContent value="content" className="mt-4">
                        {isLoadingContent ? (
                          <div className="flex items-center justify-center p-4">
                            <Loader2 className="h-6 w-6 animate-spin" />
                          </div>
                        ) : (
                          <div className="custom-scrollbar h-[600px]">
                            <pre className="bg-muted p-4 rounded-md">
                              <code>{fileContent}</code>
                            </pre>
                          </div>
                        )}
                      </TabsContent>
                    )}

                    <TabsContent value="codeSummary" className="mt-4">
                      <div className="custom-scrollbar h-[600px]">
                        <div className="p-6 bg-muted rounded-md">
                          {selectedNode?.codeSummary ? (
                            <div className="prose prose-sm max-w-none dark:prose-invert">
                              {typeof selectedNode.codeSummary === "string" &&
                              selectedNode.codeSummary.startsWith("{") ? (
                                <pre className="text-sm font-mono bg-black/5 dark:bg-white/5 p-4 rounded-lg">
                                  {JSON.stringify(formatCodeSummary(selectedNode.codeSummary), null, 2)}
                                </pre>
                              ) : (
                                <ReactMarkdown className="prose max-w-none" remarkPlugins={[remarkGfm]}>
                                  {selectedNode.codeSummary}
                                </ReactMarkdown>
                              )}
                            </div>
                          ) : (
                            <p className="text-muted-foreground">No summary available</p>
                          )}
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add custom scrollbar styles */}
      <style jsx global>{`
        .custom-scrollbar {
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(155, 155, 155, 0.5) transparent;
        }
        
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(155, 155, 155, 0.5);
          border-radius: 20px;
          border: transparent;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(155, 155, 155, 0.7);
        }
      `}</style>
    </div>
  )
}

