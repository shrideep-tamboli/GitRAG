"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, Send, X, Copy } from 'lucide-react'
import axios from "axios"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useAuth } from '@/lib/AuthContext'
import { formatCodeSummary } from "../../utils/jsonToMarkdown"
import { Highlight, themes } from 'prism-react-renderer'

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

interface SourceFile {
  url: string
  score: number
  codeSummary?: string
  summaryEmbedding?: number[] | null
}

interface ChatMessage {
  sender: "user" | "bot"
  text: string
  id?: string
  isRetrieving?: boolean
  sourceFiles?: SourceFile[]
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

  // NEW: State for source-click dialog
  const [isSourceDialogOpen, setIsSourceDialogOpen] = useState(false)
  const [sourceDialogContent, setSourceDialogContent] = useState<string>("")
  const [sourceDialogTitle, setSourceDialogTitle] = useState<string>("")
  const [isLoadingSourceContent, setIsLoadingSourceContent] = useState(false)

  const [chatInput, setChatInput] = useState("")
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const messagesStartRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [threadId, setThreadId] = useState<string | null>(null);

  // --- Dynamic suggestions: use URLs from all bot responses ---
  // Collect all unique source file URLs from all bot messages
  const suggestions: string[] = Array.from(
    new Set(
      messages
        .filter(m => m.sender === 'bot' && m.sourceFiles)
        .flatMap(m => m.sourceFiles?.map(f => f.url) || [])
        .concat(graphData.nodes.map(node => node.id))
    )
  ) as string[]
  
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([])
  const [selectedContext, setSelectedContext] = useState<string[]>([])

  // --- Filter logic: uses dynamic suggestions ---
  const handleChatInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setChatInput(value)

    const lastAtIndex = value.lastIndexOf('@') // find last '@'
    const hasAt = lastAtIndex !== -1
    const query = hasAt ? value.slice(lastAtIndex + 1).split(/\s/)[0] : '' // text after '@'

    if (hasAt) {
      const filtered = suggestions.filter(url =>
        url.toLowerCase().includes(query.toLowerCase()) // filter URLs
      )
      setFilteredSuggestions(filtered)
      setShowSuggestions(filtered.length > 0)
    } else {
      setShowSuggestions(false)
    }

    // auto-grow textarea
    const textarea = chatInputRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      const maxRows = 8
      const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight || '20', 10)
      const maxHeight = maxRows * lineHeight
      textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px'
    }
  }

  const handleSelectSuggestion = (option: string) => {
    const atIndex = chatInput.lastIndexOf('@')
    const mentionText = chatInput.slice(atIndex).split(/\s/)[0]
    // remove @mention text from input
    const newValue = chatInput.replace(`@${mentionText}`, '')
    setChatInput(newValue.trimStart()) // clean up space
    setShowSuggestions(false)
    // Add selected item if not already added
    if (!selectedContext.includes(option)) {
      setSelectedContext(prev => [...prev, option])
    }
    chatInputRef.current?.focus()
  }

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

  useEffect(() => {
    messagesStartRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

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

  // NEW: Handler for clicking a source file in chat
  const handleSourceClick = async (file: SourceFile) => {
    setIsSourceDialogOpen(true)
    setSourceDialogContent("")
    // Compute displayTitle from URL (drop username)
    const parts = file.url.split('/')
    const displayTitle = parts.slice(4).join('/')
    setSourceDialogTitle(displayTitle)
    setIsLoadingSourceContent(true)

    try {
      console.log("Fetching source file content from URL:", file.url)

      let response;
      if (file.url.includes("raw.githubusercontent.com")) {
        response = await axios.get(file.url)
      } else if (file.url.includes("api.github.com/repos")) {
        const parts = file.url.split('/repos/')[1].split('/contents/')
        const repoPath = parts[0]
        const filePath = parts.length > 1 ? parts[1] : ''
        const rawUrl = `https://raw.githubusercontent.com/${repoPath}/main/${filePath}`
        console.log("Transformed source URL:", rawUrl)
        response = await axios.get(rawUrl)
      } else {
        response = await axios.get(file.url)
      }

      setSourceDialogContent(response.data)
      console.log("Source content fetched successfully")
    } catch (err) {
      console.error("Error fetching source file content:", err)
      if (axios.isAxiosError(err)) {
        setSourceDialogContent(
          `Failed to load source content: ${err.message}. Status: ${err.response?.status || 'unknown'}.`
        )
      } else {
        setSourceDialogContent("Failed to load source content.")
      }
    } finally {
      setIsLoadingSourceContent(false)
    }
  }

  // NEW: Close handler for source dialog
  const closeSourceDialog = () => {
    setIsSourceDialogOpen(false)
    setSourceDialogContent("")
    setSourceDialogTitle("")
  }

  const handleSend = async () => {
    if (!chatInput.trim()) return;

    // Prepare the payload for retrieving relevant sources
    const retrievePayload = {
      message: chatInput,
      summaries: graphData.nodes.map((node) => ({
        codeSummary: node.codeSummary || "",
        summaryEmbedding: node.summaryEmbedding || null,
        url: node.id,
      })),
    };
  
    // Add user message to chat
    const userMessage: ChatMessage = { sender: "user", text: chatInput };
    setMessages(prev => [userMessage, ...prev]);
    setChatInput("");
    
    // Show loading state for retrieval
    const retrievalId = Date.now().toString();
    setMessages(prev => [
      { 
        sender: "bot", 
        text: "🔍 Retrieving relevant code files...",
        isRetrieving: true,
        id: retrievalId
      },
      ...prev
    ]);
    
    try {
      // Step 1: Retrieve relevant sources
      const retrieveResponse = await axios.post("/api/retrieve", retrievePayload);
      const { sources } = retrieveResponse.data;
      
      // Update the retrieval message with the found sources
      setMessages(prev => {
        const newMessages = [...prev];
        const retrievalIndex = newMessages.findIndex(m => m.id === retrievalId);
        if (retrievalIndex !== -1) {
          newMessages[retrievalIndex] = {
            ...newMessages[retrievalIndex],
            text: "🔍 Found relevant code files. Generating response...",
            sourceFiles: sources.map((s: SourceFile) => ({
              url: s.url,
              score: s.score,
              codeSummary: s.codeSummary,
              summaryEmbedding: s.summaryEmbedding
            }))
          };
        }
        return newMessages;
      });
      
      // Step 2: Get LLM response with the retrieved sources
      const chatPayload = {
        message: chatInput,
        sources: sources,
        threadId: threadId,
        context: selectedContext
      };
      
      const chatResponse = await axios.post("/api/chat", chatPayload);
      
      // Save the threadId if returned
      if (chatResponse.data.threadId) {
        setThreadId(chatResponse.data.threadId);
      }
      
      // Replace the retrieval message with the final response
      setMessages(prev => {
        const newMessages = prev.filter(m => m.id !== retrievalId);
        return [
          {
            sender: "bot",
            text: chatResponse.data.response,
            sourceFiles: sources.map((s: SourceFile) => ({
              url: s.url,
              score: s.score,
              codeSummary: s.codeSummary,
              summaryEmbedding: s.summaryEmbedding
            }))
          },
          ...newMessages
        ];
      });
      
      console.log("Chat completed with sources:", sources);
      
    } catch (err) {
      console.error("Error in chat flow:", err);
      setMessages(prev => [
        { 
          sender: "bot", 
          text: "Error: Failed to process your request. Please try again." 
        },
        ...prev.filter(m => m.id !== retrievalId)
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const closeSideCanvas = () => {
    setIsSideCanvasOpen(false)
    setSelectedNode(null)
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#ffffff]">
      <div className="flex-1 container mx-auto p-8">
        {/* Chat + Source Dialog Section */}
        <div className="flex gap-4 mb-8">
          {/* Chat Container */}
          <div className={`transition-all duration-300 ${isSourceDialogOpen ? "w-1/2" : "w-full"}`}>
            <div className="h-full border-2 border-gray-800/20 rounded-lg mb-8 flex flex-col bg-[#fdf6e3] overflow-hidden" style={{ maxHeight: "640px" }}>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col-reverse [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-gray-300/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                {isTyping && (
                  <div className="flex justify-start mb-2">
                    <div className="max-w-[70%] p-3 rounded-lg bg-white text-gray-800">
                      <div className="flex items-center space-x-2">
                        <span>Typing</span>
                        <span className="animate-pulse">.</span>
                        <span className="animate-pulse animation-delay-200">.</span>
                        <span className="animate-pulse animation-delay-400">.</span>
                      </div>
                    </div>
                  </div>
                )}
                
                {messages.length === 0 ? (
                  <div className="text-gray-800">
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center">
                      Chat with <svg className="w-6 h-6 mx-1" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                      </svg> Repository
                    </h1>
                    <ul className="list-disc pl-5 mt-2">
                      <li>Curious about how something works in the codebase?</li>
                      <li>Need details on how a feature is built?</li>
                      <li>Ask about the implementation of any feature...</li>
                    </ul>
                  </div>
                ) : (
                  messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} mb-2`}>
                      <div
                        className={`max-w-[70%] p-3 rounded-lg ${
                          msg.sender === "user"
                            ? "bg-[#f8b878] text-gray-800"
                            : "bg-white text-gray-800"
                        }`}
                      >
                        {msg.sender === "bot" ? (
                          <div className={msg.isRetrieving ? "opacity-70" : ""}>
                            <div className="flex items-start">
                              {msg.isRetrieving && (
                                <div className="mr-2 mt-0.5">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                              )}
                              <div className="flex-1">
                                <ReactMarkdown 
                                  className="prose max-w-none text-gray-800" 
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    h1: ({children, ...props}) => (
                                      <h1 className="text-xl font-bold mt-4 mb-2" {...props}>{children}</h1>
                                    ),
                                    h2: ({children, ...props}) => (
                                      <h2 className="text-lg font-semibold mt-3 mb-2" {...props}>{children}</h2>
                                    ),
                                    h3: ({children, ...props}) => (
                                      <h3 className="text-base font-medium mt-2 mb-1" {...props}>{children}</h3>
                                    ),
                                    p: ({children, ...props}) => (
                                      <p className="mb-2" {...props}>{children}</p>
                                    ),
                                    ul: ({children, ...props}) => (
                                      <ul className="list-disc pl-4 mb-2" {...props}>{children}</ul>
                                    ),
                                    li: ({children, ...props}) => (
                                      <li className="mb-1" {...props}>{children}</li>
                                    ),
                                    strong: ({children, ...props}) => (
                                      <strong className="font-bold" {...props}>{children}</strong>
                                    ),
                                    code: (props) => {
                                      const { children, className } = props;
                                      const isCodeBlock = className?.includes('language-');
                                      const language = className?.replace('language-', '') || 'typescript';

                                      const handleCopy = () => {
                                        navigator.clipboard.writeText(children as string).then(() => {
                                        }).catch(err => {
                                          console.error("Failed to copy: ", err);
                                        });
                                      };

                                      if (!isCodeBlock) {
                                        return <code className="px-1 py-0.5 bg-gray-100 rounded text-sm">{children}</code>;
                                      }

                                      return (
                                        <div className="relative bg-gray-100 rounded-md p-4 overflow-auto">
                                          <button 
                                            onClick={handleCopy} 
                                            className="absolute top-2 right-2 p-1 bg-white rounded shadow hover:bg-gray-200"
                                            aria-label="Copy code"
                                          >
                                            <Copy className="h-4 w-4 text-gray-800" />
                                          </button>
                                          <Highlight
                                            theme={themes.vsLight}
                                            code={children as string}
                                            language={language}
                                          >
                                            {({ className, style, tokens, getLineProps, getTokenProps }) => (
                                              <pre className={className} style={{ ...style, background: 'transparent', margin: 0, padding: 0 }}>
                                                {tokens.map((line, i) => (
                                                  <div key={i} {...getLineProps({ line })}>
                                                    {line.map((token, key) => (
                                                      <span key={key} {...getTokenProps({ token })} />
                                                    ))}
                                                  </div>
                                                ))}
                                              </pre>
                                            )}
                                          </Highlight>
                                        </div>
                                      );
                                    }
                                  }}
                                >
                                  {msg.text}
                                </ReactMarkdown>
                                
                                {msg.sourceFiles && msg.sourceFiles.length > 0 && (
                                  <div className="mt-2 text-xs text-gray-500">
                                    <div className="font-medium mb-1">Sources:</div>
                                    <div className="space-y-2">
                                      {msg.sourceFiles.map((file, idx) => {
                                        // display path starting with repo name (dropping the username)
                                        const parts = file.url.split('/');
                                        const displayPath = parts.slice(4).join('/');  
                                        return (
                                          <div key={idx} className="flex flex-wrap items-baseline gap-x-1.5">
                                            <button
                                              className="text-left font-medium underline break-all"
                                              title={file.url}
                                              onClick={() => handleSourceClick(file)}
                                            >
                                              {displayPath}
                                            </button>
                                            <span className="text-gray-500 whitespace-nowrap">({(file.score * 100).toFixed(1)}%)</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          msg.text
                        )}
                      </div>
                    </div>
                  ))
                )}
                
                <div ref={messagesStartRef} />
              </div>
              <div className="p-2 border-t border-gray-800/20 flex items-center space-x-2 relative">
                {showSuggestions && (
                  <ul className={`absolute bottom-full mb-1 left-2 bg-white border rounded-md shadow-lg w-64 z-10 max-h-40 overflow-y-auto 
                  [&::-webkit-scrollbar]:w-2 
                  [&::-webkit-scrollbar-thumb]:bg-gray-300/50 
                  [&::-webkit-scrollbar-thumb]:rounded-full 
                  [&::-webkit-scrollbar-track]:bg-transparent`}
                  >
                    {filteredSuggestions.map((url, idx) => (
                      <li key={idx} className="px-3 py-1 hover:bg-gray-100 cursor-pointer" 
                      onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(url) }}
                      >
                      {url}
                      </li>
                      ))}
                    </ul> 
                  )}
                  {/* Pills + Input in Flexbox */}
                    {/* Elliptical Pills for Selected Context */}
                    {selectedContext.map((ctx, idx) => (
                      <div
                        key={idx}
                        className="px-2 py-1 bg-gray-200 text-sm rounded-full flex items-center space-x-1"
                      >
                        <span className="text-gray-800">@{ctx}</span>
                        <X
                          className="w-3 h-3 text-gray-600 cursor-pointer"
                          onClick={() =>
                            setSelectedContext((prev) => prev.filter((_, i) => i !== idx))
                          }
                        />
                      </div>
                    ))}
                  <textarea
                    ref={chatInputRef}
                    rows={1}
                    value={chatInput}
                    onChange={handleChatInputChange}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                    placeholder="Type a message or use @ to mention files"
                    style={{ minHeight: '2.5rem', maxHeight: '22.5rem', overflowY: 'auto' }}
                    className="flex-1 p-2 border-2 border-gray-800/20 rounded-md outline-none focus:ring-2 focus:ring-[#f8b878] text-gray-800 bg-white resize-none custom-chat-scrollbar"
                  />
                  <button onClick={handleSend} className="p-2 bg-[#f8b878] text-gray-800 rounded-md hover:bg-[#f6a55f] transition-colors" aria-label="Send message">
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

          {/* Source Dialog */}
          {isSourceDialogOpen && (
            <div className="w-1/2 bg-[#fdf6e3] border-2 border-gray-800/20 rounded-lg mb-8 flex flex-col overflow-hidden relative" style={{ maxHeight: "640px" }}>
              {/* Floating close button */}
              <div className="absolute top-2 right-2 z-10 flex gap-2">
                {!isLoadingSourceContent && (
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(sourceDialogContent).catch(err => {
                        console.error("Failed to copy: ", err);
                      });
                    }}
                    className="p-2 hover:bg-white/50 rounded-full transition-colors"
                    aria-label="Copy code"
                    title="Copy to clipboard"
                  >
                    <Copy className="h-5 w-5 text-gray-800" />
                  </button>
                )}
                <button 
                  onClick={closeSourceDialog} 
                  className="p-2 hover:bg-white/50 rounded-full transition-colors" 
                  aria-label="Close"
                >
                  <X className="h-5 w-5 text-gray-800" />
                </button>
              </div>
              
              <div className="p-8 flex-1 overflow-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-gray-300/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                <h2 className="text-xl font-bold text-gray-800 break-words pr-16 mb-4">
                  <span className="truncate block" title={sourceDialogTitle}>
                    {sourceDialogTitle}
                  </span>
                </h2>
                <div className="flex-1 overflow-auto">
                  {isLoadingSourceContent ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-6 w-6 animate-spin text-[#f8b878]" />
                    </div>
                  ) : (
                    <div className="relative bg-gray-100 rounded-md p-4 overflow-auto">
                      <Highlight
                        theme={themes.vsLight}
                        code={sourceDialogContent}
                        language={sourceDialogTitle.split('.').pop() || 'text'}
                      >
                        {({ className, style, tokens, getLineProps, getTokenProps }) => (
                          <pre className={className} style={{ ...style, background: 'transparent', margin: 0, padding: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {tokens.map((line, i) => (
                              <div key={i} {...getLineProps({ line })}>
                                {line.map((token, key) => (
                                  <span key={key} {...getTokenProps({ token })} />
                                ))}
                              </div>
                            ))}
                          </pre>
                        )}
                      </Highlight>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Repository Knowledge Graph Section */}
        <Card className="p-6 mb-10 border-2 border-gray-800/20 rounded-xl bg-[#fdf6e3] shadow-lg w-[90%] mx-auto">
          <h1 className="text-3xl font-bold mb-2 text-gray-800">Repository Knowledge Graph</h1>
          <p className="text-gray-700">
            Explore your repository structure in 3D. Click on nodes to view details.
          </p>
        </Card>

        {loading && (
          <div className="flex items-center justify-center h-[600px]">
            <Loader2 className="h-8 w-8 animate-spin text-[#f8b878]" />
          </div>
        )}

        {error && <div className="p-4 bg-red-100 text-red-700 rounded-md border-2 border-red-300">{error}</div>}

        {!loading && !error && (
          <div className="flex h-[800px]">
            <div
              className={`bg-[#fdf6e3] rounded-lg shadow-xl mx-auto overflow-hidden relative transition-all duration-300 ease-in-out border-2 border-gray-800/20 ${
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
                  backgroundColor="#fdf6e3"
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
                <div className="absolute bottom-4 left-4 bg-[#fdf6e3] text-gray-800 rounded-lg shadow-lg p-4 border-2 border-gray-800/20">
                  <h3 className="font-semibold">Node Color Legend</h3>
                  <div className="flex flex-col mt-2">
                    <div className="flex items-center">
                      <div className="w-4 h-4 bg-[#f98b85] rounded-full mr-2"></div>
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
                      <div className="w-4 h-4 bg-[#f8b878] rounded-full mr-2"></div>
                      <span>File</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Side Canvas for Graph Node */}
            {isSideCanvasOpen && selectedNode && (
              <div className="w-1/2 bg-[#fdf6e3] rounded-lg shadow-xl ml-4 overflow-hidden flex flex-col border-2 border-gray-800/20">
                <div className="p-4 border-b border-gray-800/20 flex justify-between items-center">
                  <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800">
                    {selectedNode?.type === "File_Url" && "📄"}
                    {selectedNode?.type === "Dir_Url" && "📁"}
                    {selectedNode?.type === "Repo_Url" && "📦"}
                    {selectedNode?.url ? selectedNode.url.split('/').slice(5).join('/') : selectedNode?.label}
                  </h2>
                  <button onClick={closeSideCanvas} className="p-1 hover:bg-white rounded-full" aria-label="Close">
                    <X className="h-5 w-5 text-gray-800" />
                  </button>
                </div>

                <div className="flex-1 p-4">
                  <Tabs defaultValue="codeSummary" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="codeSummary" className="text-gray-800">Code Summary</TabsTrigger>
                      <TabsTrigger value="content" className="text-gray-800">Content</TabsTrigger>
                    </TabsList>

                    <TabsContent value="codeSummary" className="mt-4">
                      <div className="custom-scrollbar h-[600px]" style={{ overflowY: 'auto' }}>
                        <div className="p-6 bg-white rounded-md border-2 border-gray-800/20" style={{ 
                          width: '100%',
                          maxWidth: '100%'
                        }}>
                          {selectedNode?.codeSummary ? (
                            <div className="prose prose-sm" style={{ 
                              maxWidth: '100%',
                              width: '100%'
                            }}>
                              {typeof selectedNode.codeSummary === "string" ? (
                                <ReactMarkdown 
                                  className="prose max-w-none text-gray-800" 
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    code: ({children, ...props}) => (
                                      <code className="text-gray-600" style={{
                                        display: 'block',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        width: '100%',
                                        maxWidth: '100%',
                                        overflow: 'visible'
                                      }} {...props}>{children}</code>
                                    ),
                                    p: ({children, ...props}) => (
                                      <p className="text-gray-600 mb-2" style={{
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
                                <p className="text-gray-700">Summary format not recognized</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-gray-700">No summary available</p>
                          )}
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="content" className="mt-4">
                      {isLoadingContent ? (
                        <div className="flex items-center justify-center p-4">
                          <Loader2 className="h-6 w-6 animate-spin text-[#f8b878]" />
                        </div>
                      ) : (
                        <div className="custom-scrollbar h-[600px]" style={{ overflowY: 'auto', overflowX: 'auto' }}>
                          <pre className="bg-white p-4 rounded-md border-2 border-gray-800/20" style={{ maxWidth: '100%' }}>
                            <code className="text-gray-600 font-normal" style={{ 
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
      </div>

      {/* Add custom scrollbar styles */}
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
    </div>
  )
}
