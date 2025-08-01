"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Loader2, Send, X, Copy } from 'lucide-react'
import axios from "axios"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Highlight, themes } from 'prism-react-renderer'
import { useAuth } from '@/lib/AuthContext'
import type { GraphData } from './KnowledgeGraph'
interface SourceFile {
  url: string;
  score: number;
  codeSummary?: string;
  summaryEmbedding?: number[] | null;
  reasoning?: string;
}

interface ChatMessage {
  sender: "user" | "bot"
  text: string
  id?: string
  isRetrieving?: boolean
  sourceFiles?: SourceFile[]
}

interface ChatComponentProps {
  threadId?: string;
}

export default function ChatComponent({ threadId: propThreadId }: ChatComponentProps) {
  const [internalThreadId, setInternalThreadId] = useState(propThreadId || `thread_${Math.random().toString(36).substr(2, 9)}`)
  const { user } = useAuth()
  
  // Update internal threadId if prop changes
  useEffect(() => {
    if (propThreadId) {
      setInternalThreadId(propThreadId)
    }
  }, [propThreadId])
  const [isSourceDialogOpen, setIsSourceDialogOpen] = useState(false)
  const [sourceDialogContent, setSourceDialogContent] = useState<string>("")
  const [sourceDialogTitle, setSourceDialogTitle] = useState<string>("")
  const [isLoadingSourceContent, setIsLoadingSourceContent] = useState(false)

  const [chatInput, setChatInput] = useState("")
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const messagesStartRef = useRef<HTMLDivElement>(null)
  const [, setError] = useState("");
  const [, setLoading] = useState(false);
  const [, setWidth] = useState(0)
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    links: []
  });

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
    const value = e.target.value;
    const caret = e.target.selectionStart || 0;
    setChatInput(value);
  
    // Check if cursor is right after "@" or an in-progress mention
    const mentionMatch = value.slice(0, caret).match(/@([^\s@]*)$/);
    if (mentionMatch) {
      const query = mentionMatch[1]; // may be empty if user just typed '@'
      const filtered = suggestions.filter(url =>
        url.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  
    // Auto-grow textarea
    const textarea = chatInputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const maxRows = 8;
      const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight || '20', 10);
      const maxHeight = maxRows * lineHeight;
      textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
    }
  };  

  const handleSelectSuggestion = (option: string) => {
    const lastAt = chatInput.lastIndexOf('@');
    const before = chatInput.slice(0, lastAt);
    const afterParts = chatInput.slice(lastAt + 1).split(/\s/);
    const after = afterParts.slice(1).join(' ');
    const newValue = `${before}@${option}${after ? ' ' + after : ''}`;
  
    setChatInput(newValue);
    setSelectedContext(prev => {
      // avoid duplicates
      if (prev.includes(option)) return prev;
      return [...prev, option];
    });
    setShowSuggestions(false);
    chatInputRef.current?.focus();
  };

  useEffect(() => {
    messagesStartRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    setWidth(window.innerWidth)
    const handleResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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
      const { sources, reasoning: retrievalReasoning } = retrieveResponse.data;
      
      // Update the retrieval message with the found sources
      const updatedMessages = [...messages];
      const retrievalIndex = updatedMessages.findIndex(m => m.id === retrievalId);
      if (retrievalIndex !== -1) {
        updatedMessages[retrievalIndex] = {
          ...updatedMessages[retrievalIndex],
          text: "🔍 Found relevant code files. Generating response...",
          sourceFiles: sources.map((s: any) => ({
            url: s.url,
            score: s.score,
            codeSummary: s.codeSummary,
            summaryEmbedding: s.summaryEmbedding,
            reasoning: s.reasoning
          }))
        };
        setMessages(updatedMessages);
      }
      
      // Step 2: Get LLM response with the retrieved sources and reasoning
      const chatPayload = {
        message: chatInput,
        sources: sources.map((s: any) => ({
          ...s,
          reasoning: s.reasoning || `Selected based on relevance score of ${s.score?.toFixed(2) || 'high'}.`
        })),
        threadId: internalThreadId,
        context: selectedContext,
        retrievalReasoning: retrievalReasoning || 'The system selected these files based on relevance to your question.'
      };
      
      const chatResponse = await axios.post("/api/chat", chatPayload);
      
      // Update the threadId if a new one is returned
      if (chatResponse.data.threadId && chatResponse.data.threadId !== internalThreadId) {
        setInternalThreadId(chatResponse.data.threadId);
      }
      
      // Replace the retrieval message with the final response
      setMessages(prevMessages => [
        {
          sender: "bot" as const,
          text: chatResponse.data.response,
          sourceFiles: sources.map((s: any) => ({
            url: s.url,
            score: s.score,
            codeSummary: s.codeSummary,
            summaryEmbedding: s.summaryEmbedding,
            reasoning: s.reasoning
          }))
        },
        ...prevMessages.filter(m => m.id !== retrievalId)
      ]);
      
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

  return (
    <div className="flex flex-col h-[70vh] bg-[#ffffff] w-full max-h-[70vh]">
      <div className="flex-1 w-full h-full p-2 m-0">
        {/* Chat + Source Dialog Section */}
        <div className="flex gap-4 h-full w-full">
          {/* Chat Container */}
          <div className={`transition-all duration-300 h-full flex flex-col ${isSourceDialogOpen ? "w-1/2" : "w-full"}`}>
            <div className="flex-1 border-2 border-gray-800/20 rounded-lg flex flex-col bg-[#fdf6e3] overflow-hidden h-full max-h-full">
              <div className="flex-1 overflow-y-auto p-4 flex flex-col-reverse scrollbar-thin scrollbar-thumb-gray-300/50 scrollbar-track-transparent">
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
                  <textarea
                    ref={chatInputRef}
                    rows={1}
                    value={chatInput}
                    onChange={handleChatInputChange}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                    placeholder="Type a message and use @ to mention files"
                    className="flex-1 p-2 border-2 border-gray-800/20 rounded-md outline-none focus:ring-2 focus:ring-[#f8b878] text-gray-800 bg-white resize-none custom-chat-scrollbar"
                    style={{ minHeight: '2.5rem', maxHeight: '22.5rem', overflowY: 'auto' }}
                  />
                  <button onClick={handleSend} className="p-2 ml-2 bg-[#f8b878] text-gray-800 rounded-md hover:bg-[#f6a55f] transition-colors" aria-label="Send message">
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

          {/* Source Dialog */}
          {isSourceDialogOpen && (
            <div className="w-1/2 bg-[#fdf6e3] border-2 border-gray-800/20 rounded-lg flex flex-col overflow-hidden relative h-full">
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
      </div>
    </div>
  )
}
