
import { Card } from "@/components/ui/card"
import { Loader2, X } from "lucide-react"
import { useAuth } from '@/lib/AuthContext'
import dynamic from "next/dynamic"
import { useState, useEffect, useCallback } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCodeSummary } from "../../utils/jsonToMarkdown"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import axios from "axios"

// Dynamically import the force-graph component with A-Frame
const ForceGraph3D = dynamic(() => {
  // Import A-Frame first
  return import('aframe').then(() => {
    // Then import the force graph
    return import('react-force-graph').then(mod => mod.ForceGraph3D);
  });
}, {
  ssr: false,
  loading: () => <div>Loading 3D visualization...</div>
});

export interface Node {
  id: string
  label: string
  type: string
  url: string
  codeSummary?: string
  contentEmbedding?: number[] | null
  summaryEmbedding?: number[] | null
}

export interface Link {
  source: string
  target: string
  relationship: string
}

export interface GraphData {
  nodes: Node[] 
  links: Link[]
}



export default function KnowledgeGraph() {

const { user } = useAuth()
const [loading, setLoading] = useState(false);
const [error, setError] = useState("");
const [graphData, setGraphData] = useState({ nodes: [], links: [] });
const [selectedNode, setSelectedNode] = useState<Node | null>(null);
const [isSideCanvasOpen, setIsSideCanvasOpen] = useState(false);
const [width, setWidth] = useState(0);
const [fileContent, setFileContent] = useState<string>("")
const [isLoadingContent, setIsLoadingContent] = useState(false)

const closeSideCanvas = () => {
  setSelectedNode(null);
  setIsSideCanvasOpen(false);
};

const handleResize = () => {
  setWidth(window.innerWidth);
};

useEffect(() => {
  handleResize();
  window.addEventListener('resize', handleResize);
  return () => {
    window.removeEventListener('resize', handleResize);
  };
}, []);

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
      const data = await response.json()
      
      if (!response.ok) {
        console.error("Graph data fetch failed:", {
          status: response.status,
          statusText: response.statusText,
          data: data
        })
        throw new Error(`Failed to fetch graph data: ${response.statusText}. ${data.error || ''}`)
      }
      
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
          console.log("Fetching content from URL:", url)
          
          let response;
          if (url.includes("raw.githubusercontent.com")) {
            response = await axios.get(url)
          } else if (url.includes("api.github.com/repos")) {
            // For GitHub API URLs, transform to raw content URL
            const parts = url.split('/repos/')[1].split('/contents/')
            const repoPath = parts[0] // owner/repo
            const filePath = parts.length > 1 ? parts[1] : ''
            const rawUrl = `https://raw.githubusercontent.com/${repoPath}/main/${filePath}`
            
            console.log("Transformed URL:", rawUrl)
            response = await axios.get(rawUrl)
          } else {
            // Try direct fetch for other URLs
            response = await axios.get(url)
          }
          
          setFileContent(response.data)
          console.log("Content fetched successfully")
        } catch (err) {
          console.error("Error fetching file content:", err)
          if (axios.isAxiosError(err)) {
            setFileContent(
              `Failed to load file content: ${err.message}. Status: ${err.response?.status || 'unknown'}. This might be due to file size limitations, access restrictions, or the file being binary content.`
            )
          } else {
            setFileContent(
              "Failed to load file content. This might be due to file size limitations or access restrictions."
            )
          }
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

  return (
    <>
      <Card className="p-6 mb-10 border border-border/60 rounded-xl bg-card shadow-lg w-[90%] mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-foreground">Repository Knowledge Graph</h1>
        <p className="text-muted">
          Explore your repository structure in 3D. Click on nodes to view details.
        </p>
      </Card>

      {loading && (
        <div className="flex items-center justify-center h-[600px]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      )}

      {error && <div className="p-4 bg-red-900/20 text-red-400 rounded-md border border-red-500/30">{error}</div>}

      {!loading && !error && (
        <div className="flex h-[800px]">
          <div
            className={`bg-surface rounded-lg shadow-xl mx-auto overflow-hidden relative transition-all duration-300 ease-in-out border border-border/60 ${
              isSideCanvasOpen ? "w-1/2" : "w-[90%]"
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
                    ? "#f98b85"
                    : typedNode.type === "Repo_Url"
                      ? "#003366"
                      : typedNode.type === "Dir_Url"
                        ? "#4CAF50"
                        : typedNode.type === "File_Url"
                          ? "#f8b878"
                          : "#003366"
                }}
                nodeRelSize={6}
                linkWidth={1}
                linkColor={() => "#2a4858"}
                linkOpacity={0.8}
                linkDirectionalParticles={4}
                linkDirectionalParticleWidth={3}
                linkDirectionalParticleSpeed={0.006}
                backgroundColor="transparent"
                onNodeClick={(node) => handleNodeClick(node as Node)}
                width={isSideCanvasOpen ? width / 2 : width}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
                warmupTicks={100}
                cooldownTicks={50}
                nodeId="id"
                linkSource="source"
                linkTarget="target"
                enableNodeDrag={true}
                linkLabel={link => link.relationship}
              />
              <div className="absolute bottom-4 left-4 bg-card text-foreground rounded-lg shadow-lg p-4 border border-border/60">
                <h3 className="font-semibold">Node Color Legend</h3>
                <div className="flex flex-col mt-2">

                  <div className="flex items-center">
                    <div className="w-4 h-4 bg-[#f98b85] rounded-full mr-2"></div>
                    <span>Selected Node</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-4 h-4 bg-[#003366] rounded-full mr-2"></div>
                    <span>Root Folder</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-4 h-4 bg-[#4CAF50] rounded-full mr-2"></div>
                    <span>Folder</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-4 h-4 bg-[#f8b878] rounded-full mr-2"></div>
                    <span>File</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Side Canvas for Graph Node */}
          {isSideCanvasOpen && selectedNode && (
            <div className="w-1/2 bg-surface rounded-lg shadow-xl ml-4 overflow-hidden flex flex-col border border-border/60">
              <div className="p-4 border-b border-border flex justify-between items-center">
                <h2 className="text-xl font-bold flex items-center gap-2 text-foreground">
                  {selectedNode?.type === "File_Url" && "📄"}
                  {selectedNode?.type === "Dir_Url" && "📁"}
                  {selectedNode?.type === "Repo_Url" && "📦"}
                  {selectedNode?.url ? selectedNode.url.split('/').slice(5).join('/') : selectedNode?.label}
                </h2>
                <button onClick={closeSideCanvas} className="p-1 hover:bg-card rounded-full" aria-label="Close">
                  <X className="h-5 w-5 text-foreground" />
                </button>
              </div>

              <div className="flex-1 p-4">
                <Tabs defaultValue="codeSummary" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="codeSummary" className="text-foreground">Code Summary</TabsTrigger>
                    <TabsTrigger value="content" className="text-foreground">Content</TabsTrigger>
                  </TabsList>

                  <TabsContent value="codeSummary" className="mt-4">
                    <div className="custom-scrollbar h-[600px]" style={{ overflowY: 'auto' }}>
                      <div className="p-6 bg-card rounded-md border border-border/60" style={{ 
                        width: '100%',
                        maxWidth: '100%'
                      }}>
                        {selectedNode?.codeSummary ? (
                          <div className="prose prose-sm prose-invert" style={{ 
                            maxWidth: '100%',
                            width: '100%'
                          }}>
                            {typeof selectedNode.codeSummary === "string" ? (
                              <ReactMarkdown 
                                className="prose prose-invert max-w-none text-foreground" 
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  code: ({children, ...props}) => (
                                    <code className="text-muted" style={{
                                      display: 'block',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                      width: '100%',
                                      maxWidth: '100%',
                                      overflow: 'visible'
                                    }} {...props}>{children}</code>
                                  ),
                                  p: ({children, ...props}) => (
                                    <p className="text-muted mb-2" style={{
                                      display: 'block',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                      width: '100%',
                                      maxWidth: '100%',
                                      overflow: 'visible'
                                    }} {...props}>{children}</p>
                                  ),
                                  h1: ({children, ...props}) => (
                                    <h1 className="text-xl font-bold mt-4 mb-2" {...props}>{children}</h1>
                                  ),
                                  h2: ({children, ...props}) => (
                                    <h2 className="text-lg font-semibold mt-3 mb-2" {...props}>{children}</h2>
                                  ),
                                  h3: ({children, ...props}) => (
                                    <h3 className="text-base font-medium mt-2 mb-1" {...props}>{children}</h3>
                                  ),
                                  ul: ({children, ...props}) => (
                                    <ul className="list-disc pl-4 mb-2" {...props}>{children}</ul>
                                  ),
                                  li: ({children, ...props}) => (
                                    <li className="mb-1" {...props}>{children}</li>
                                  )
                                }}
                              >
                                {(() => {
                                  let summary = selectedNode.codeSummary;
                                  
                                  // Clean up the summary string - handle various formats
                                  summary = summary.trim();
                                  
                                  // Remove extra quotes at the beginning and end if present
                                  if (summary.startsWith('""') && summary.endsWith('""')) {
                                    summary = summary.substring(2, summary.length - 2).trim();
                                  } else if (summary.startsWith('"') && summary.endsWith('"')) {
                                    summary = summary.substring(1, summary.length - 1).trim();
                                  }
                                  
                                  // Handle code blocks with backticks
                                  if (summary.startsWith("```json") && summary.includes("```")) {
                                    // Extract content between ```json and the last ```
                                    const startIndex = summary.indexOf("```json") + 7;
                                    const endIndex = summary.lastIndexOf("```");
                                    if (endIndex > startIndex) {
                                      summary = summary.substring(startIndex, endIndex).trim();
                                    }
                                  }
                                  
                                  // Handle plain JSON strings
                                  try {
                                    // Try to parse it as JSON to validate
                                    JSON.parse(summary);
                                    // If it's valid JSON, process it
                                    return formatCodeSummary(summary);
                                  } catch {
                                    // If not valid JSON, try to clean up further
                                    if (summary.startsWith("{") && summary.endsWith("}")) {
                                      // It looks like JSON but couldn't be parsed, use as is
                                      return formatCodeSummary(summary);
                                    } else {
                                      // Not JSON format, return as plain text
                                      return summary;
                                    }
                                  }
                                })()}
                              </ReactMarkdown>
                            ) : (
                              <p className="text-muted">Summary format not recognized</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-muted">No summary available</p>
                        )}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="content" className="mt-4">
                    {isLoadingContent ? (
                      <div className="flex items-center justify-center p-4">
                        <Loader2 className="h-6 w-6 animate-spin text-accent" />
                      </div>
                    ) : (
                      <div className="custom-scrollbar h-[600px]" style={{ overflowY: 'auto', overflowX: 'auto' }}>
                        <pre className="bg-card p-4 rounded-md border border-border/60" style={{ maxWidth: '100%' }}>
                          <code className="text-muted font-normal" style={{ 
                            wordBreak: 'break-word', 
                            whiteSpace: 'pre-wrap', 
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            lineHeight: '1.5',
                            display: 'block',
                          }}>{fileContent}</code>
                        </pre>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          )}
        </div>
      )}
      <style jsx global>{`
        .custom-chat-scrollbar {
        scrollbar-width: thin;
        scrollbar-color: rgba(155, 155, 155, 0.4) transparent;
        border: transparent;
        }
        .custom-chat-scrollbar::-webkit-scrollbar {
        width: 5px;
        }
        .custom-chat-scrollbar::-webkit-scrollbar-track {
        background: transparent;
        border: transparent;
        }
        .custom-chat-scrollbar::-webkit-scrollbar-thumb {
        background-color: rgba(155, 155, 155, 0.4);
        border-radius: 20px;
        border: transparent;
        }
        .custom-chat-scrollbar::-webkit-scrollbar-thumb:hover {
        background-color: rgba(155, 155, 155, 0.4);
        border: transparent;
        }
        .custom-chat-scrollbar::-webkit-scrollbar-button {
        height: 0;
        display: none;
        background: none;
        border: transparent;
        }

        .custom-scrollbar {
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(155, 155, 155, 0.5) transparent;
        border: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
        border: transparent;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
        background-color: rgba(155, 155, 155, 0.5);
        border-radius: 20px;
        border: transparent;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background-color: rgba(155, 155, 155, 0.7);
        border: transparent;
        }

        .animation-delay-200 {
        animation-delay: 200ms;
        }
        .animation-delay-400 {
        animation-delay: 400ms;
        }
      `}</style>
    </>
  )
}