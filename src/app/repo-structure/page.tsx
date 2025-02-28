"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, Send } from "lucide-react"
import axios from "axios"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

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
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [fileContent, setFileContent] = useState<string>("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [chatInput, setChatInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesStartRef = useRef<HTMLDivElement>(null)

  const fetchGraphData = useCallback(async () => {
    setLoading(true)
    setError("")

    try {
      const response = await fetch("/api/repo-structure")
      if (!response.ok) {
        throw new Error(`Failed to fetch graph data: ${response.statusText}`)
      }
      const data = await response.json()
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
  }, [])

  useEffect(() => {
    fetchGraphData()
  }, [fetchGraphData])

  useEffect(() => {
    messagesStartRef.current?.scrollIntoView({ behavior: "smooth" })
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
      setIsDialogOpen(true)
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
      url: node.id
    }))

    // Log the list of URLs
    //const urls = summaries.map((summary) => summary.url)
    //console.log("List of URLs:", urls)

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

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="flex-1 container mx-auto p-8">
        <button
          onClick={() => router.push("/pages/connect-repo")}
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
          <div className="h-[800px] bg-card rounded-lg shadow-xl overflow-hidden relative">
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
              linkWidth={2}
              linkDirectionalParticles={4}
              linkDirectionalParticleWidth={2}
              linkDirectionalParticleSpeed={0.005}
              backgroundColor="#f8f9fa"
              onNodeClick={(node) => handleNodeClick(node as Node)}
              linkColor={() => "#94a3b8"}
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
        )}

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                {selectedNode?.type === "File_Url" && "📄"}
                {selectedNode?.type === "Dir_Url" && "📁"}
                {selectedNode?.type === "Repo_Url" && "📦"}
                {selectedNode?.label}
              </DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="details" className="mt-4">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="details">Details</TabsTrigger>
                {selectedNode?.type === "File_Url" && <TabsTrigger value="content">Content</TabsTrigger>}
                <TabsTrigger value="codeSummary">Code Summary</TabsTrigger>
                {selectedNode?.type === "File_Url" && <TabsTrigger value="contentVector">Content Vector</TabsTrigger>}
                {selectedNode?.type === "File_Url" && <TabsTrigger value="summaryVector">Summary Vector</TabsTrigger>}
              </TabsList>

              <TabsContent value="details" className="mt-4">
                <div className="space-y-4">
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
                    <pre className="bg-muted p-4 rounded-md overflow-x-auto max-h-[500px] overflow-y-auto">
                      <code>{fileContent}</code>
                    </pre>
                  )}
                </TabsContent>
              )}

              <TabsContent value="codeSummary" className="mt-4">
                <div className="p-4 bg-muted rounded-md overflow-y-auto max-h-[500px]">
                  <ReactMarkdown className="prose max-w-none" remarkPlugins={[remarkGfm]}>
                    {selectedNode?.codeSummary || "No summary available"}
                  </ReactMarkdown>
                </div>
              </TabsContent>

              {selectedNode?.type === "File_Url" && (
                <>
                  <TabsContent value="contentVector" className="mt-4">
                    {selectedNode?.contentEmbedding ? (
                      <pre className="bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(selectedNode.contentEmbedding, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-muted-foreground">No content vector available.</p>
                    )}
                  </TabsContent>
                  <TabsContent value="summaryVector" className="mt-4">
                    {selectedNode?.summaryEmbedding ? (
                      <pre className="bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(selectedNode.summaryEmbedding, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-muted-foreground">No summary vector available.</p>
                    )}
                  </TabsContent>
                </>
              )}
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

