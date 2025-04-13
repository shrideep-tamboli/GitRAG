"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import type { JSX } from "react"
import dynamic from "next/dynamic"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, Send, X, ArrowLeft, FileIcon, FolderIcon, GitBranchIcon } from "lucide-react"
import axios from "axios"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useAuth } from "@/lib/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import * as THREE from "three"

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
  isTyping?: boolean
}

// Add a new interface for the typing indicator
interface TypingIndicatorState {
  isTyping: boolean
}

// Define fixed colors for specific node types
const nodeTypeColors: Record<string, string> = {
  Dir_Url: "#FF6B6B", // Red
  File_Url: "#4ECDC4", // Teal
  Repo_Url: "#45B7D1", // Blue
}

// Fallback colors for any other node types
const fallbackColors = [
  "#96CEB4", // Green
  "#FFEEAD", // Yellow
  "#D4A5A5", // Pink
  "#9B59B6", // Purple
  "#E67E22", // Orange
  "#34495E", // Dark Blue
  "#1ABC9C", // Turquoise
]

// Add a constant for the selected node color at the top of the file, after the fallbackColors array
const SELECTED_NODE_COLOR = "#E67E22" // A darker orange that complements the theme

// Component to format and display JSON summary data
const JsonSummaryDisplay = ({ jsonString }: { jsonString: string }) => {
  try {
    const data = JSON.parse(jsonString)

    const renderValue = (value: any, level = 1): JSX.Element => {
      if (typeof value === "string") {
        return <p className="text-gray-800 mb-3 break-words">{value}</p>
      }

      if (Array.isArray(value)) {
        if (value.length === 0) return <p className="text-gray-600 italic mb-3">None</p>

        return (
          <ul className="list-disc pl-5 mb-3">
            {value.map((item, index) => (
              <li key={index} className="text-gray-800 mb-1 break-words">
                {typeof item === "object" ? renderValue(item, level + 1) : item}
              </li>
            ))}
          </ul>
        )
      }

      if (typeof value === "object" && value !== null) {
        if (Object.keys(value).length === 0) return <p className="text-gray-600 italic mb-3">None</p>

        return (
          <div className="mb-3">
            {Object.entries(value).map(([key, val], index) => (
              <div key={index} className="mb-3">
                {level === 1 ? (
                  <h3 className="text-gray-800 font-semibold text-md mb-1">{key.replace(/_/g, " ")}</h3>
                ) : (
                  <h4 className="text-gray-800 font-medium mb-1">{key.replace(/_/g, " ")}</h4>
                )}
                {renderValue(val, level + 1)}
              </div>
            ))}
          </div>
        )
      }

      return <p className="text-gray-800 mb-3 break-words">{String(value)}</p>
    }

    return (
      <div className="text-gray-800">
        {Object.entries(data).map(([key, value], index) => (
          <div key={index} className="mb-4">
            <h2 className="text-gray-800 text-lg font-bold mb-2 capitalize">{key.replace(/_/g, " ")}</h2>
            {renderValue(value)}
          </div>
        ))}
      </div>
    )
  } catch (error) {
    // If it's not valid JSON, just render it as markdown
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node, ...props }) => <p className="text-gray-800 mb-4 break-words" {...props} />,
          h1: ({ node, ...props }) => <h1 className="text-gray-800 text-xl font-bold mb-4" {...props} />,
          h2: ({ node, ...props }) => <h2 className="text-gray-800 text-lg font-bold mb-3" {...props} />,
          h3: ({ node, ...props }) => <h3 className="text-gray-800 text-md font-bold mb-2" {...props} />,
          ul: ({ node, ...props }) => <ul className="text-gray-800 list-disc pl-5 mb-4" {...props} />,
          ol: ({ node, ...props }) => <ol className="text-gray-800 list-decimal pl-5 mb-4" {...props} />,
          li: ({ node, ...props }) => <li className="text-gray-800 mb-1 break-words" {...props} />,
          code: ({ node, ...props }) => (
            <code className="bg-gray-100 text-gray-800 px-1 rounded break-words" {...props} />
          ),
          pre: ({ node, ...props }) => (
            <pre className="bg-gray-100 text-gray-800 p-2 rounded mb-4 whitespace-pre-wrap" {...props} />
          ),
        }}
      >
        {jsonString}
      </ReactMarkdown>
    )
  }
}

// Helper function to get the appropriate icon based on node type
const getNodeIcon = (nodeType: string) => {
  switch (nodeType) {
    case "Dir_Url":
      return <FolderIcon className="w-5 h-5 text-[#FF6B6B]" />
    case "File_Url":
      return <FileIcon className="w-5 h-5 text-[#4ECDC4]" />
    case "Repo_Url":
      return <GitBranchIcon className="w-5 h-5 text-[#45B7D1]" />
    default:
      return <FileIcon className="w-5 h-5 text-gray-500" />
  }
}

export default function RepoStructureSection() {
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
  const [isTyping, setIsTyping] = useState(false) // Add state for typing indicator
  const messagesStartRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [nodeTypes, setNodeTypes] = useState<string[]>([])
  const graphRef = useRef<any>(null)
  const [formattedSummary, setFormattedSummary] = useState<string>("")
  const [nodeColorMap, setNodeColorMap] = useState<Record<string, string>>({})

  const fetchGraphData = useCallback(async () => {
    if (!user?.id) {
      setError("Please sign in to view the repository structure")
      return
    }

    setLoading(true)
    setError("")

    try {
      const response = await fetch(`/api/repo-structure?userId=${user.id}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch graph data: ${response.statusText}`)
      }
      const data = await response.json()

      if (!data.nodes || data.nodes.length === 0) {
        setError("No repository data found. Please connect a repository first.")
        return
      }

      setGraphData(data)
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError("An unknown error occurred")
      }
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  const extractNodeTypes = useCallback(() => {
    if (graphData.nodes.length === 0) return

    const types = Array.from(new Set(graphData.nodes.map((node) => node.type)))
    setNodeTypes(types)

    // Create a color map for all node types
    const colorMap: Record<string, string> = {}
    types.forEach((type, index) => {
      // Use predefined color if available, otherwise use fallback colors
      colorMap[type] = nodeTypeColors[type] || fallbackColors[index % fallbackColors.length]
    })
    setNodeColorMap(colorMap)
  }, [graphData.nodes])

  // Get color for a node based on its type
  const getNodeColor = useCallback(
    (node: any) => {
      return nodeColorMap[node.type] || "#CCCCCC" // Default gray if type not found
    },
    [nodeColorMap],
  )

  // Format the JSON summary into a readable text format
  const formatJsonSummary = useCallback((jsonString: string) => {
    try {
      const data = JSON.parse(jsonString)
      let formatted = ""

      // Process overall summary
      if (data.overall_summary) {
        formatted += `## Overall Summary\n${data.overall_summary}\n\n`
      }

      // Process functions
      if (data.functions && data.functions.length > 0) {
        formatted += `## Functions\n\n`
        data.functions.forEach((func: any, index: number) => {
          formatted += `### ${func.name || `Function ${index + 1}`}\n`
          if (func.description) formatted += `${func.description}\n\n`

          if (func.parameters && func.parameters.length > 0) {
            formatted += `**Parameters:**\n`
            func.parameters.forEach((param: any) => {
              formatted += `- \`${param.name}\` (${param.type}): ${param.description || ""}\n`
            })
            formatted += "\n"
          }

          if (func.return_value) {
            formatted += `**Returns:** ${func.return_value}\n\n`
          }
        })
      }

      // Process classes
      if (data.classes && data.classes.length > 0) {
        formatted += `## Classes\n\n`
        data.classes.forEach((cls: any, index: number) => {
          formatted += `### ${cls.name || `Class ${index + 1}`}\n`
          if (cls.description) formatted += `${cls.description}\n\n`

          if (cls.methods && cls.methods.length > 0) {
            formatted += `**Methods:**\n`
            cls.methods.forEach((method: any) => {
              formatted += `- \`${method.name}\`: ${method.description || ""}\n`
            })
            formatted += "\n"
          }
        })
      } else if (data.classes && data.classes.length === 0) {
        formatted += `## Classes\nNone\n\n`
      }

      // Process variables
      if (data.variables) {
        formatted += `## Variables\n\n`
        if (Array.isArray(data.variables) && data.variables.length > 0) {
          data.variables.forEach((variable: any) => {
            formatted += `### ${variable.name}\n`
            if (variable.description) formatted += `${variable.description}\n`
            if (variable.type) formatted += `**Type:** ${variable.type}\n\n`
          })
        } else if (typeof data.variables === "object" && Object.keys(data.variables).length > 0) {
          Object.entries(data.variables).forEach(([key, value]: [string, any]) => {
            formatted += `### ${key}\n${value}\n\n`
          })
        } else {
          formatted += `None\n\n`
        }
      }

      // Process dependencies
      if (data.dependencies) {
        formatted += `## Dependencies\n\n`

        if (data.dependencies.external_libraries && data.dependencies.external_libraries.length > 0) {
          formatted += `### External Libraries\n`
          data.dependencies.external_libraries.forEach((lib: string) => {
            formatted += `- ${lib}\n`
          })
          formatted += "\n"
        }

        if (data.dependencies.file_dependencies && data.dependencies.file_dependencies.length > 0) {
          formatted += `### File Dependencies\n`
          data.dependencies.file_dependencies.forEach((file: string) => {
            formatted += `- ${file}\n`
          })
          formatted += "\n"
        }
      }

      // Process requests
      if (data.requests && data.requests.length > 0) {
        formatted += `## API Requests\n\n`
        data.requests.forEach((request: any) => {
          formatted += `- ${request.method || ""} ${request.url || ""}: ${request.description || ""}\n`
        })
        formatted += "\n"
      } else if (data.requests && data.requests.length === 0) {
        formatted += `## API Requests\nNone\n\n`
      }

      // Process file system operations
      if (data.file_system_operations && data.file_system_operations.length > 0) {
        formatted += `## File System Operations\n\n`
        data.file_system_operations.forEach((op: any) => {
          formatted += `- ${op.operation || ""}: ${op.description || ""}\n`
        })
        formatted += "\n"
      }

      // Process additional notes
      if (data.additional_notes) {
        formatted += `## Additional Notes\n${data.additional_notes}\n`
      }

      return formatted
    } catch (error) {
      console.error("Error formatting JSON summary:", error)
      return jsonString // Return the original string if parsing fails
    }
  }, [])

  useEffect(() => {
    if (selectedNode?.codeSummary) {
      setFormattedSummary(formatJsonSummary(selectedNode.codeSummary))
    }
  }, [selectedNode, formatJsonSummary])

  useEffect(() => {
    if (user?.id) {
      fetchGraphData()
    }
  }, [fetchGraphData, user?.id])

  useEffect(() => {
    extractNodeTypes()
  }, [graphData, extractNodeTypes])

  useEffect(() => {
    messagesStartRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    setWidth(window.innerWidth)
    const handleResize = () => setWidth(window.innerWidth)
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // Center the graph when it loads or when the side panel opens/closes
  useEffect(() => {
    if (graphRef.current) {
      setTimeout(() => {
        graphRef.current.zoomToFit(400, 30)
        graphRef.current.cameraPosition({ x: 0, y: 0, z: 200 }, { x: 0, y: 0, z: 0 }, 1000)
      }, 500)
    }
  }, [graphData, isSideCanvasOpen])

  const handleNodeClick = useCallback(async (node: any) => {
    const typedNode = node as Node
    setSelectedNode(typedNode)
    setIsSideCanvasOpen(true)
    setFileContent("")

    // Focus camera on the clicked node
    if (graphRef.current) {
      // First zoom out slightly to provide context
      graphRef.current.cameraPosition(
        { x: 0, y: 0, z: 200 },
        // Look at the node
        { x: node.x, y: node.y, z: node.z },
        1000,
      )

      // Then zoom in to focus on the node
      setTimeout(() => {
        graphRef.current.cameraPosition(
          { x: node.x * 0.8, y: node.y * 0.8, z: 100 },
          { x: node.x, y: node.y, z: node.z },
          800,
        )
      }, 300)
    }

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

    if (typedNode.type === "File_Url" && typedNode.id) {
      await fetchFileContent(typedNode.id)
    }
  }, [])

  const handleSend = async () => {
    if (!chatInput.trim()) return
  
    // Prepare summaries from graphData
    const summaries = graphData.nodes.map((node) => ({
      codeSummary: node.codeSummary || "",
      summaryEmbedding: node.summaryEmbedding || null,
      url: node.id,
    }))
  
    // Append user's message
    const userMessage = chatInput
    setMessages((prev) => [{ sender: "user", text: userMessage }, ...prev])
  
    // Append a new bot message that will show the thinking animation
    setMessages((prev) => [{ sender: "bot", text: "", isTyping: true }, ...prev])
    setChatInput("")
  
    const payload = {
      message: userMessage,
      summaries: summaries,
    }
  
    try {
      const response = await axios.post("/api/chat", payload)
      const fullResponse = response.data.response
  
      // Remove any <think> tags from the response
      const actualResponse = fullResponse.replace(/<think>[\s\S]*?<\/think>/, "").trim()
  
      // Update the bot message that is currently showing the thinking indicator
      setMessages((prev) => {
        // Assume the latest message (index 0) is the pending bot message
        const updatedMessages = [...prev]
        const pendingMessage = updatedMessages[0]
        if (pendingMessage && pendingMessage.sender === "bot" && pendingMessage.isTyping) {
          updatedMessages[0] = { sender: "bot", text: actualResponse }
        } else {
          // Fallback: add new message if not found (should not occur)
          updatedMessages.unshift({ sender: "bot", text: actualResponse })
        }
        return updatedMessages
      })
    } catch (err) {
      console.error("Error sending chat message:", err)
      // In case of error, update the pending message to show an error text
      setMessages((prev) => {
        const updatedMessages = [...prev]
        const pendingMessage = updatedMessages[0]
        if (pendingMessage && pendingMessage.sender === "bot" && pendingMessage.isTyping) {
          updatedMessages[0] = { sender: "bot", text: "Error: Failed to get response." }
        } else {
          updatedMessages.unshift({ sender: "bot", text: "Error: Failed to get response." })
        }
        return updatedMessages
      })
    }
  }
 
  const closeSideCanvas = () => {
    setIsSideCanvasOpen(false)
    setSelectedNode(null)
  }

  return (
    <section id="repo-structure" className="min-h-screen flex items-center justify-center p-8 bg-[#f9f9f7]">
      <div className="flex flex-col min-h-screen w-full max-w-6xl">
        <div className="flex-1 mx-auto p-4 w-full">
          <Button
            onClick={() => {
              const connectRepoSection = document.getElementById("connect-repo")
              connectRepoSection?.scrollIntoView({ behavior: "smooth" })
            }}
            variant="outline"
            className="mb-6 flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Connect Repo
          </Button>

          <Card className="mb-8 border-2 border-gray-800/20 rounded-xl bg-[#fdf6e3] overflow-hidden">
            <CardContent className="p-0">
              <div className="flex flex-col" style={{ height: "400px" }}>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col-reverse">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} mb-2`}
                  >
                    <div
                      className={`max-w-[70%] p-3 rounded-lg ${
                        msg.sender === "user"
                          ? "bg-[#f8b878] text-gray-800"
                          : "bg-white border border-gray-800/10 text-gray-800"
                      }`}
                    >
                      {msg.sender === "bot" && msg.isTyping ? (
                        <div className="flex items-center">
                          <span className="mr-2">Thinking</span>
                          <span className="w-1 h-1 bg-gray-600 rounded-full animate-pulse mx-0.5"></span>
                          <span
                            className="w-1 h-1 bg-gray-600 rounded-full animate-pulse mx-0.5"
                            style={{ animationDelay: "0.2s" }}
                          ></span>
                          <span
                            className="w-1 h-1 bg-gray-600 rounded-full animate-pulse mx-0.5"
                            style={{ animationDelay: "0.4s" }}
                          ></span>
                        </div>
                      ) : (
                        msg.text
                      )}
                    </div>
                  </div>
                ))}

                  {/* Add typing indicator */}
                  {isTyping && (
                    <div className="flex justify-start mb-2">
                      <div className="max-w-[70%] p-3 rounded-lg bg-white border border-gray-800/10 text-gray-800">
                        <div className="flex items-center">
                          <span className="mr-2">Thinking</span>
                          <span className="w-1 h-1 bg-gray-600 rounded-full animate-pulse mx-0.5"></span>
                          <span className="w-1 h-1 bg-gray-600 rounded-full animate-pulse mx-0.5" style={{ animationDelay: "0.2s" }}></span>
                          <span className="w-1 h-1 bg-gray-600 rounded-full animate-pulse mx-0.5" style={{ animationDelay: "0.4s" }}></span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesStartRef} />
                </div>
                <div className="p-3 border-t border-gray-800/10 flex items-center gap-2 bg-white">
                  <Input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleSend()
                      }
                    }}
                    placeholder="Ask about your repository..."
                    className="flex-1 border-2 border-gray-800/20 rounded-lg bg-white text-gray-800"
                  />
                  <Button onClick={handleSend} className="rounded-lg bg-[#f8b878] text-gray-800 hover:bg-[#f6a55f]">
                    <Send className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-row">
            {/* Main graph container - adjusts width based on side panel state */}
            <div className={`transition-all duration-300 ${isSideCanvasOpen ? "w-1/2" : "w-full"}`}>
              <Card className="border-2 border-gray-800/20 rounded-xl bg-[#fdf6e3] overflow-hidden h-[600px]">
                <CardContent className="p-0 h-full">
                  {loading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="w-8 h-8 animate-spin text-[#f8b878]" />
                    </div>
                  ) : error ? (
                    <div className="text-red-500 text-center p-8 h-full flex items-center justify-center">
                      <div>
                        <p className="mb-4">{error}</p>
                        <Button
                          onClick={() => {
                            const connectRepoSection = document.getElementById("connect-repo")
                            connectRepoSection?.scrollIntoView({ behavior: "smooth" })
                          }}
                          className="rounded-lg bg-[#f8b878] text-gray-800 hover:bg-[#f6a55f]"
                        >
                          Connect a Repository
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full relative">
                      <ForceGraph3D
                        ref={graphRef}
                        graphData={graphData}
                        nodeLabel="label"
                        nodeColor={getNodeColor}
                        linkColor={() => "#999"}
                        linkWidth={1}
                        linkDirectionalParticles={2}
                        linkDirectionalParticleWidth={2}
                        onNodeClick={handleNodeClick}
                        width={isSideCanvasOpen ? width / 2 - 50 : width - 100}
                        height={600}
                        backgroundColor="#fdf6e3"
                        nodeThreeObject={(node) => {
                          // Create a default sphere for all nodes
                          const defaultSize = 5
                          const geometry = new THREE.SphereGeometry(
                            selectedNode && node.id === selectedNode.id ? 7 : defaultSize,
                          )

                          const material = new THREE.MeshLambertMaterial({
                            color:
                              selectedNode && node.id === selectedNode.id ? SELECTED_NODE_COLOR : getNodeColor(node),
                            transparent: true,
                            opacity: selectedNode && node.id === selectedNode.id ? 0.8 : 0.7,
                          })

                          return new THREE.Mesh(geometry, material)
                        }}
                      />

                      {/* Legend */}
                      <div className="absolute bottom-4 left-4 bg-[#fdf6e3] border-2 border-gray-800/20 rounded-lg p-3 shadow-md z-10">
                        <h3 className="text-sm font-bold text-gray-800 mb-2">Node Types</h3>
                        <div className="flex flex-col gap-2">
                          {nodeTypes.map((type) => (
                            <div key={type} className="flex items-center gap-2">
                              <div
                                className="w-4 h-4 rounded-full"
                                style={{ backgroundColor: nodeColorMap[type] || "#CCCCCC" }}
                              ></div>
                              <span className="text-xs text-gray-800">{type.replace(/_/g, " ")}</span>
                            </div>
                          ))}
                          {/* Add Selected Node to legend */}
                          <div className="flex items-center gap-2 mt-1 pt-1 border-t border-gray-800/10">
                            <div
                              className="w-4 h-4 rounded-full"
                              style={{ backgroundColor: SELECTED_NODE_COLOR }}
                            ></div>
                            <span className="text-xs text-gray-800 font-medium">Selected Node</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Side panel - only visible when a node is selected */}
            {isSideCanvasOpen && selectedNode && (
              <div className="w-1/2 pl-4 transition-all duration-300">
                <Card className="border-2 border-gray-800/20 rounded-xl bg-[#fdf6e3] overflow-hidden h-[600px]">
                  <CardContent className="p-4 h-full overflow-y-auto relative">
                    <Button
                      onClick={closeSideCanvas}
                      variant="outline"
                      className="absolute top-4 right-4 p-2 rounded-lg hover:bg-[#f8b878] border-2 border-gray-800/20"
                    >
                      <X className="w-5 h-5" />
                    </Button>

                    <div className="flex items-center gap-2 mb-6 pr-10">
                      {getNodeIcon(selectedNode.type)}
                      <h2 className="text-xl font-bold text-gray-800">{selectedNode.label}</h2>
                    </div>

                    <Tabs defaultValue="content" className="w-full">
                      <TabsList className="w-full mb-4 bg-[#fdf6e3] border-2 border-gray-800/20 rounded-lg p-1">
                        <TabsTrigger
                          value="content"
                          className="rounded-md data-[state=active]:bg-[#f8b878] data-[state=active]:text-gray-800 text-gray-600"
                        >
                          Content
                        </TabsTrigger>
                        <TabsTrigger
                          value="summary"
                          className="rounded-md data-[state=active]:bg-[#f8b878] data-[state=active]:text-gray-800 text-gray-600"
                        >
                          Summary
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="content">
                        {isLoadingContent ? (
                          <div className="flex items-center justify-center p-8">
                            <Loader2 className="w-8 h-8 animate-spin text-[#f8b878]" />
                          </div>
                        ) : (
                          <pre className="whitespace-pre-wrap text-gray-800 overflow-x-auto break-words">
                            {fileContent}
                          </pre>
                        )}
                      </TabsContent>

                      <TabsContent value="summary">
                        {selectedNode.codeSummary ? (
                          <div className="text-gray-800">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                p: ({ node, ...props }) => <p className="text-gray-800 mb-4 break-words" {...props} />,
                                h1: ({ node, ...props }) => (
                                  <h1 className="text-gray-800 text-xl font-bold mb-4" {...props} />
                                ),
                                h2: ({ node, ...props }) => (
                                  <h2 className="text-gray-800 text-lg font-bold mb-3" {...props} />
                                ),
                                h3: ({ node, ...props }) => (
                                  <h3 className="text-gray-800 text-md font-bold mb-2" {...props} />
                                ),
                                ul: ({ node, ...props }) => (
                                  <ul className="text-gray-800 list-disc pl-5 mb-4" {...props} />
                                ),
                                ol: ({ node, ...props }) => (
                                  <ol className="text-gray-800 list-decimal pl-5 mb-4" {...props} />
                                ),
                                li: ({ node, ...props }) => (
                                  <li className="text-gray-800 mb-1 break-words" {...props} />
                                ),
                                code: ({ node, ...props }) => (
                                  <code className="bg-gray-100 text-gray-800 px-1 rounded break-words" {...props} />
                                ),
                                pre: ({ node, ...props }) => (
                                  <pre
                                    className="bg-gray-100 text-gray-800 p-2 rounded mb-4 whitespace-pre-wrap"
                                    {...props}
                                  />
                                ),
                              }}
                            >
                              {formattedSummary}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-gray-800">No summary available</p>
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
