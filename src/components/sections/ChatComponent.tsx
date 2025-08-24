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
  shortUrl?: string;
  score?: number;
  codeSummary?: string;
  reasoning?: string;
  relevantCodeBlocks?: string[];
}

interface SourceResult extends Omit<SourceFile, 'shortUrl'> {
  isFromContext?: boolean;
  isFromFrequencyList?: boolean;
  needed?: boolean;
  enough?: boolean;
}

interface FinalSource extends Pick<SourceFile, 'url' | 'reasoning' | 'relevantCodeBlocks' | 'score'> {
  shortUrl?: string;
}

interface ChatMessage {
  sender: "user" | "bot";
  text: string;
  id?: string;
  isRetrieving?: boolean;
  expandedThoughts?: boolean;
  expandedSources?: boolean;
  sourceFiles?: {
    url: string;
    shortUrl?: string;
    score?: number;
    codeSummary?: string;
    reasoning?: string;
    relevantCodeBlocks?: string[];
  }[];
  thoughtDuration?: string; // seconds string like "3.2"
  finalAnswer?: string;
  sourcesList?: {
    url: string;
    shortUrl?: string;
  }[];
  structuredResponse?: {
    textResponse: string;
    codeBlock?: string;
    language?: string;
  };
  rewriteQuery?: string; // populated when server streams a rewrite event
}

interface ChatComponentProps {
  threadId?: string;
}

function toShortUrl(raw: string) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const p = u.pathname.split('/'); // ['', owner, repo, branch, ...] for raw.githubusercontent
    if (host === 'raw.githubusercontent.com' && p.length >= 4) {
      // raw.githubusercontent.com/{owner}/{repo}/{branch}/path...
      const repo = p[2];
      const branch = p[3];
      const rest = p.slice(4).join('/');
      return `${repo}/${branch}/${rest}`;
    }

    if (host === 'github.com') {
      // github.com/{owner}/{repo}/blob/{branch}/path...
      const blobIdx = p.indexOf('blob');
      if (blobIdx > -1 && p.length > blobIdx + 2) {
        const repo = p[2];
        const branch = p[blobIdx + 1];
        const rest = p.slice(blobIdx + 2).join('/');
        return `${repo}/${branch}/${rest}`;
      }
    }

    if (host === 'api.github.com') {
      // /repos/{owner}/{repo}/contents/{path...}
      const reposIdx = p.indexOf('repos');
      const contentsIdx = p.indexOf('contents');
      if (reposIdx > -1 && p.length > reposIdx + 2) {
        const repoName = p[reposIdx + 2]; // repo
        if (contentsIdx > -1) {
          const filePath = p.slice(contentsIdx + 1).join('/');
          return `${repoName}/main/${filePath}`;
        }
        return repoName;
      }
    }

    // fallback: return last up-to-5 path segments or full path if short
    const segs = p.filter(Boolean);
    if (segs.length >= 3) return segs.slice(-5).join('/');
    return u.pathname.replace(/^\//, '');
  } catch {
    // invalid url — return original
    return raw;
  }
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [urlFrequencies, setUrlFrequencies] = useState<Record<string, number>>({});
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrollingUp = useRef(false)
  const lastScrollTop = useRef(0)
  const [, setError] = useState("");
  const [, setLoading] = useState(false);
  const [, setWidth] = useState(0)
  // Thinking animation state
  const [thinkingText, setThinkingText] = useState("")
  const thinkingFrames = [
    "T","Th","Thi","Thin","Think","Thinki","Thinkin","Thinking","Thinking.","Thinking..","Thinking..."
  ]
  useEffect(() => {
    const anyRetrieving = messages.some(m => m.isRetrieving)
    let interval: number | undefined
    if (anyRetrieving) {
      let idx = 0
      setThinkingText(thinkingFrames[0])
      interval = window.setInterval(() => {
        idx = (idx + 1) % thinkingFrames.length
        setThinkingText(thinkingFrames[idx])
      }, 200)
    } else {
      setThinkingText("")
    }
    return () => {
      if (interval) window.clearInterval(interval)
    }
  }, [messages])
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

  // Smart scroll: track user scroll direction
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop } = container;
      // User is scrolling up if current scrollTop is less than the last recorded
      isUserScrollingUp.current = scrollTop < lastScrollTop.current;
      lastScrollTop.current = scrollTop;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [])

  // Auto-scroll when messages update:
  // With flex-col-reverse layout, newest content is at the top, so we keep scrollTop near 0
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    const shouldAutoScroll = !isUserScrollingUp.current || lastMessage?.sender === 'bot';
    if (shouldAutoScroll) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
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

  // inside ChatComponent.tsx — replace the handleSend function with this:

  const handleSend = async () => {
    if (!chatInput.trim()) return;
  
    const retrievePayload = {
      message: chatInput,
      threadId: internalThreadId,
      summaries: graphData.nodes.map((node) => ({
        codeSummary: node.codeSummary || "",
        summaryEmbedding: node.summaryEmbedding || null,
        url: node.id,
      })),
      urlFrequencyList: Object.entries(urlFrequencies)
        .map(([url, frequency]) => ({ url, frequency }))
        .sort((a, b) => b.frequency - a.frequency),
    };
  
    // Add user message
    const userMessage: ChatMessage = { sender: "user", text: chatInput };
    setMessages((prev) => [userMessage, ...prev]);
    setChatInput("");
  
    // Single retrieval message (collapsible)
    const retrievalId = Date.now().toString();
    const retrieveStart = Date.now();
    setMessages((prev) => [
      {
        sender: "bot",
        text: "",
        isRetrieving: true,
        id: retrievalId,
        expanded: true,
        sourceFiles: [],
      },
      ...prev,
    ]);
  
    try {
      const res = await fetch("/api/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retrievePayload),
      });
  
      if (!res.ok || !res.body) {
        throw new Error(`Retrieve failed: ${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Track all seen files to prevent duplicates
      const seenFiles = new Map<string, boolean>();
      
      const updateMessageWithSources = (sources: SourceResult[]) => {
        if (!sources || !sources.length) return;
        
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== retrievalId) return m;
            
            // Create a map of existing sources by URL
            const existingSources = new Map(
              (m.sourceFiles || []).map(s => [s.url, s])
            );
            
            // Add or update sources from the batch
            sources.forEach(source => {
              if (!source?.url || seenFiles.has(source.url)) return;
              
              seenFiles.set(source.url, true);
              existingSources.set(source.url, {
                url: source.url,
                shortUrl: toShortUrl(source.url),
                score: source.score ?? 0,
                codeSummary: source.codeSummary,
                reasoning: source.reasoning,
                relevantCodeBlocks: source.relevantCodeBlocks || [],
              });
            });
            
            return {
              ...m,
              sourceFiles: Array.from(existingSources.values())
            };
          })
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const raw of lines) {
          if (!raw.trim()) continue;
          try {
            const obj = JSON.parse(raw);

            if (obj.type === "batch") {
              // Process batch of files
              const d = obj.data;
              if (d.results && d.results.length > 0) {
                updateMessageWithSources(d.results);
              }
              
              // Do not break here on d.isFinal; allow the rest of the lines in this chunk
              // to be processed (the server may send the 'final' event in the same chunk).
              // We'll naturally stop when the stream ends.
            } else if (obj.type === "final") {
              const finalSources = obj.data.sources || [];
              const finalQuery = obj.data.finalQuery || chatInput;
              const retrieveDuration = (
                (Date.now() - retrieveStart) /
                1000
              ).toFixed(1);
  
              setUrlFrequencies((prev) => {
                const copy = { ...prev };
                finalSources.forEach((s: FinalSource) => {
                  copy[s.url] = (copy[s.url] || 0) + 1;
                });
                return copy;
              });
  
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === retrievalId
                    ? {
                        ...m,
                        isRetrieving: false,
                        thoughtDuration: retrieveDuration,
                        sourceFiles: (m.sourceFiles || []).concat(
                          finalSources.map((s: FinalSource) => ({
                            url: s.url,
                            shortUrl: toShortUrl(s.url),
                            score: s.score,
                            reasoning: s.reasoning,
                            relevantCodeBlocks: s.relevantCodeBlocks || [],
                          }))
                        ),
                      }
                    : m
                )
              );
  
              const chatPayload = {
                message: finalQuery || chatInput,
                originalMessage: chatInput,
                sources: finalSources.map((s: FinalSource) => ({
                  url: s.url,
                  reasoning:
                    s.reasoning ||
                    `Selected based on relevance score ${
                      s.score?.toFixed?.(2) ?? ""
                    }.`,
                  relevantCodeBlocks: s.relevantCodeBlocks || [],
                })),
                threadId: internalThreadId,
                context: selectedContext,
              };
  
              const chatResp = await axios.post("/api/chat", chatPayload);
  
              if (
                chatResp.data.threadId &&
                chatResp.data.threadId !== internalThreadId
              ) {
                setInternalThreadId(chatResp.data.threadId);
              }
  
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === retrievalId
                    ? {
                        ...m,
                        finalAnswer: chatResp.data.response,
                        structuredResponse: chatResp.data.structuredResponse,
                        sourcesList: finalSources.map((s: FinalSource) => ({
                          url: s.url,
                          shortUrl: toShortUrl(s.url),
                        })),
                        expandedThoughts: false,
                        expandedSources: false,
                      }
                    : m
                )
              );
            } else if (obj.type === "rewrite") {
              // Show the rewritten query immediately in the reasoning panel
              const rewrittenQuery: string | undefined = obj.data?.rewrittenQuery;
              if (rewrittenQuery) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === retrievalId
                      ? {
                          ...m,
                          rewriteQuery: rewrittenQuery,
                        }
                      : m
                  )
                );
              }
            } else if (obj.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === retrievalId
                    ? {
                        ...m,
                        text: `Error: ${
                          obj.data?.message || "Unknown error"
                        }`,
                        isRetrieving: false,
                      }
                    : m
                )
              );
            }
          } catch (e) {
            console.error("Stream parse error", e, raw);
          }
        }
      }
    } catch (err) {
      console.error("Error in streaming retrieve:", err);
      setMessages((prev) => [
        {
          sender: "bot",
          text: "Error: Failed to process your request. Please try again.",
        },
        ...prev.filter((m) => m.id !== retrievalId),
      ]);
    } finally {
      setIsTyping(false);
    }
  };


  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState('auto');

  // Update height when messages change or side panel is toggled
  useEffect(() => {
    if (containerRef.current) {
      const height = containerRef.current.offsetHeight;
      setContainerHeight(`${height}px`);
    }
  }, [messages, isSourceDialogOpen]);

  return (
    <div className="flex flex-col bg-background text-foreground w-full min-h-[calc(100vh-200px)] mb-10">
      <div className="w-full h-full p-2 m-0">
        {/* Chat + Source Dialog Section */}
        <div className="flex gap-4 w-full h-full">
          {/* Chat Container */}
          <div ref={containerRef} className={`transition-all duration-300 flex flex-col ${isSourceDialogOpen ? "w-1/2" : "w-full"}`}>
            <div className="border border-border/60 rounded-lg flex flex-col bg-surface h-full">
              <div ref={messagesContainerRef} className="flex-1 p-4 flex flex-col-reverse overflow-y-auto overflow-x-hidden">
                {isTyping && (
                  <div className="flex justify-start mb-2">
                    <div className="max-w-[90%] p-3 rounded-lg bg-card text-foreground">
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
                  <div className="text-foreground">
                    <h1 className="text-2xl font-bold text-foreground flex items-center">
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
                        className={`max-w-[90%] p-3 rounded-lg break-words overflow-x-auto ${
                          msg.sender === "user"
                            ? "bg-accent text-accent-foreground"
                            : "bg-card text-foreground"
                        }`}
                      >
                        {msg.sender === "bot" ? (
                          <div className={msg.isRetrieving ? "opacity-70" : ""}>
                            <div className="flex items-start">
                              <div className="flex-1">
                                <ReactMarkdown 
                                  className="prose prose-sm prose-invert max-w-none break-words text-foreground" 
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
                                        return <code className="px-1 py-0.5 bg-border/30 rounded text-sm text-foreground">{children}</code>;
                                      }

                                      return (
                                        <div className="relative bg-card rounded-md p-4 overflow-x-auto max-w-full z-10">
                                          <button 
                                            onClick={handleCopy} 
                                            className="absolute top-2 right-2 p-1 bg-surface rounded shadow hover:bg-card"
                                            aria-label="Copy code"
                                          >
                                            <Copy className="h-4 w-4 text-foreground" />
                                          </button>
                                          <Highlight
                                            theme={themes.vsDark}
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
                                
                                {(msg.isRetrieving || (msg.sourceFiles && msg.sourceFiles.length > 0)) && (
                                  <div className="text-xs text-muted bg-surface">
                                    <div className="flex items-center justify-between mb-1 bg-card p-2">
                                      <button
                                        type="button"
                                        className="font-medium flex items-center underline-offset-2 hover:underline"
                                        onClick={() => {
                                          setMessages((prev) =>
                                            prev.map((mm) =>
                                              mm.id === msg.id ? { ...mm, expandedThoughts: !mm.expandedThoughts } : mm
                                            )
                                          );
                                        }}
                                      >
                                        {msg.isRetrieving ? (
                                          <span>{thinkingText || "Thinking..."}</span>
                                        ) : (
                                          <>
                                            <span>Thought for {msg.thoughtDuration || "?"}s</span>
                                            <svg
                                              className="w-3 h-3 ml-1 transition-transform"
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              stroke="currentColor"
                                              style={{
                                                transform: msg.expandedThoughts ? 'rotate(180deg)' : 'none',
                                                transition: 'transform 200ms ease-in-out'
                                              }}
                                            >
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                          </>
                                        )}
                                      </button>
                                    </div>

                                    {msg.expandedThoughts && (
                                      <div className="space-y-3 mt-2 max-h-48 overflow-y-auto overflow-x-hidden break-words scrollbar-hide">
                                        {msg.rewriteQuery && (
                                          <div className="p-2 rounded w-[98%] mx-auto">
                                            <div className="text-xs text-muted">Rewriting query:</div>
                                            <div className="text-xs text-muted break-words whitespace-pre-wrap">{msg.rewriteQuery}</div>
                                          </div>
                                        )}
                                         {(msg.sourceFiles && msg.sourceFiles.length > 0) ? msg.sourceFiles.map((file, idx) => (
                                           <div key={file.url + idx} className="p-2 rounded w-[98%] mx-auto mb-4">
                                             <button 
                                               onClick={() => handleSourceClick(file)}
                                               className="text-xs text-muted underline hover:text-blue-500 transition-colors cursor-pointer text-left w-full"
                                             >
                                               {file.shortUrl || toShortUrl(file.url)}
                                             </button>
                                             <div className="whitespace-pre-wrap text-xs mt-1 text-muted">
                                               {file.reasoning}
                                             </div>
                                           </div>
                                         )) : (<></>)}
                                       </div>
                                     )}
                                  </div>
                                )}

                                {!msg.isRetrieving && msg.finalAnswer && (
                                  <>
                                    {msg.structuredResponse ? (
                                      <div className="mt-4 space-y-3">
                                        {msg.structuredResponse.textResponse && (
                                          <div className="whitespace-pre-wrap">
                                            {msg.structuredResponse.textResponse}
                                          </div>
                                        )}
                                        {msg.structuredResponse.codeBlock && (
                                          <div className="relative bg-surface rounded-md p-4 overflow-auto z-10">
                                            <button
                                              onClick={() => navigator.clipboard.writeText(msg.structuredResponse!.codeBlock || "")}
                                              className="absolute top-2 right-2 p-1 bg-surface rounded shadow hover:bg-card"
                                              aria-label="Copy code"
                                            >
                                              <Copy className="h-4 w-4 text-foreground" />
                                            </button>
                                            <Highlight
                                              theme={themes.vsDark}
                                              code={msg.structuredResponse.codeBlock}
                                              language={msg.structuredResponse.language || 'typescript'}
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
                                        )}
                                      </div>
                                    ) : (
                                      <div className="mt-20 whitespace-pre-wrap">{msg.finalAnswer}</div>
                                    )}
                                     {msg.sourcesList && msg.sourcesList.length > 0 && (
                                      <div className="mt-3">
                                        <button
                                          className="flex items-center text-xs text-muted hover:text-foreground transition-colors"
                                          onClick={() => {
                                            setMessages((prev) =>
                                              prev.map((m) =>
                                                m.id === msg.id ? { ...m, expandedSources: !m.expandedSources } : m
                                              )
                                            );
                                          }}
                                        >
                                          <span className="font-medium text-muted">
                                            Sources ({msg.sourcesList.length})
                                          </span>
                                          <svg
                                            className="w-3 h-3 ml-1 transition-transform"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            style={{
                                              transform: msg.expandedSources ? 'rotate(180deg)' : 'none',
                                              transition: 'transform 200ms ease-in-out'
                                            }}
                                          >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                        {msg.expandedSources && (
                                          <div className="mt-1 text-xs text-muted pl-2 border-l-2 border-muted">
                                            {msg.sourcesList.map((s) => (
                                              <div key={s.url} className="py-1">
                                                <button
                                                  onClick={() => handleSourceClick(s)}
                                                  className="hover:underline hover:text-blue-500 break-all text-left"
                                                >
                                                  {s.shortUrl}
                                                </button>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                     )}
                                   </>
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
                
                <div ref={messagesEndRef} />
              </div>
              <div className="p-2 border-t border-border/60 flex items-center space-x-2 relative">
                {showSuggestions && (
                  <ul className={`absolute bottom-full mb-1 left-2 bg-surface border border-border/60 rounded-md shadow-lg w-64 z-10 max-h-40 overflow-y-auto 
                  [&::-webkit-scrollbar]:w-2 
                  [&::-webkit-scrollbar-thumb]:bg-muted/30 
                  [&::-webkit-scrollbar-thumb]:rounded-full 
                  [&::-webkit-scrollbar-track]:bg-transparent`}
                  >
                    {filteredSuggestions.map((url, idx) => (
                      <li key={idx} className="px-3 py-1 hover:bg-card cursor-pointer" 
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
                    className="flex-1 p-2 border border-border/60 rounded-md outline-none focus:ring-2 focus:ring-accent text-foreground bg-surface resize-none custom-chat-scrollbar"
                    style={{ minHeight: '2.5rem', maxHeight: '22.5rem', overflowY: 'auto' }}
                  />
                  <button onClick={handleSend} className="p-2 ml-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 transition-colors" aria-label="Send message">
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

          {/* Source Dialog */}
          <div 
            className={`transition-all duration-300 ${isSourceDialogOpen ? 'w-1/2' : 'w-0'} overflow-hidden relative`}
            style={{ height: containerHeight }}
          >
            <div className="border border-border/60 rounded-lg flex flex-col bg-surface w-full h-full">
              <div className="flex justify-between items-center p-2 border-b border-border/60">
                <h3 className="text-sm font-medium px-2 truncate max-w-[80%]">{sourceDialogTitle}</h3>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(sourceDialogContent).catch(err => {
                        console.error("Failed to copy: ", err);
                      });
                    }}
                    className="p-1.5 hover:bg-card rounded-md transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <button
                    onClick={closeSourceDialog}
                    className="p-1.5 hover:bg-card rounded-md transition-colors"
                    title="Close panel"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              </div>
              <div className="p-6 flex-1 flex flex-col overflow-hidden h-full">
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent h-full">
                  {isLoadingSourceContent ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-6 w-6 animate-spin text-accent" />
                    </div>
                  ) : (
                    <div className="relative bg-card rounded-md p-4">
                      <Highlight
                        theme={themes.vsDark}
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
          </div>
        </div>
      </div>
    </div>
  )
}
