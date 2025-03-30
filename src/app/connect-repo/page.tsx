"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Home } from "lucide-react"

export default function ConnectRepo() {
  const [repoUrl, setRepoUrl] = useState("")
  const [inputRepoUrl, setInputRepoUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

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

  const [contents, setContents] = useState<RepoItem[]>([])
  // New state for tracking vectorization status and messages
  const [vectorizing, setVectorizing] = useState(false)
  const [vectorizeMessage, setVectorizeMessage] = useState("")

  const router = useRouter()

  // Fetch the connected repository URL when the component mounts
  useEffect(() => {
    const fetchConnectedRepo = async () => {
      try {
        const response = await fetch("/api/get-repo-url")
        if (!response.ok) {
          throw new Error("Failed to fetch connected repository")
        }
        const data = await response.json()
        console.log("Fetched data from get-repo-url:", data)
        if (data.repoUrl) {
          setRepoUrl(data.repoUrl)
        } else {
          console.warn("No repoUrl found in the response.")
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          console.error("Error fetching connected repository:", err.message)
        } else {
          console.error("Unexpected error fetching connected repository:", err)
        }
      }
    }

    fetchConnectedRepo()
  }, [])

  const handleConnect = async () => {
    setLoading(true)
    setError("")
    setContents([])

    try {
      // Connect to the repository
      const response = await fetch("/api/connect-repo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: inputRepoUrl }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to connect to the repository")
      }

      if (data.message) {
        setError(data.message)
      } else {
        // Log the processing time
        console.log(`Repository processing completed in ${data.processingTime} seconds`)

        // Log token usage for each file
        data.contents.forEach((item: RepoItem) => {
          if (item.metadata) {
            console.log(`Token usage for ${item.name}:`, {
              input_tokens: item.metadata.input_tokens,
              output_tokens: item.metadata.output_tokens,
              total_tokens: item.metadata.total_tokens,
            })
          }
        })

        // Save the repo structure and update UI state
        setContents(data.contents)
        setRepoUrl(inputRepoUrl)
        setInputRepoUrl("")

        // Create/update the knowledge graph by sending the repo structure
        await fetch("/api/repo-structure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repoUrl: inputRepoUrl,
            repoStructure: data.contents,
          }),
        })

        // Now that a KG exists, trigger vectorization
        setVectorizing(true)
        setVectorizeMessage("")
        try {
          const vectorizeRes = await fetch("/api/vectorize", { method: "POST" })
          const vectorizeData = await vectorizeRes.json()
          setVectorizeMessage(vectorizeData.message || "Vectorization complete!")
        } catch (vectorizeError: unknown) {
          console.error("Error vectorizing graph:", vectorizeError)
          setVectorizeMessage("Error vectorizing graph")
        } finally {
          setVectorizing(false)
        }

        // After vectorization, navigate to the repository structure view
        router.push("/repo-structure")
      }

      console.log("Repository Structure:", data.contents)
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error("Error connecting to repository:", err.message)
        setError(err.message)
      } else {
        console.error("Unexpected error connecting to repository:", err)
        setError("An unexpected error occurred.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen">
      {/* Home button */}
      <button
        onClick={() => router.push("/")}
        className="absolute top-4 left-4 p-2 rounded-md bg-primary text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-md hover:scale-105 flex items-center justify-center"
        aria-label="Go to home page"
      >
        <Home size={20} />
      </button>

      <div className="flex flex-col md:flex-row min-h-screen p-8">
        <div className="flex-1 flex flex-col items-center justify-center md:border-r md:border-border dark:md:border-border/50 md:pr-8">
          <h1 className="text-2xl mb-4">Connect to Git Repository</h1>
          <input
            type="text"
            value={inputRepoUrl}
            onChange={(e) => setInputRepoUrl(e.target.value)}
            placeholder="Enter Git Repo URL"
            className="border rounded p-2 mb-4 w-full max-w-md text-black"
          />
          <button
            onClick={handleConnect}
            disabled={loading || vectorizing}
            className={`rounded-md border border-solid border-black/[.08] dark:border-white/[.145] transition-all flex items-center justify-center bg-primary text-primary-foreground h-10 px-4 ${
              loading || vectorizing
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-primary/90 hover:shadow-md hover:scale-105"
            }`}
          >
            {loading ? "Connecting..." : vectorizing ? "Vectorizing..." : "Connect"}
          </button>

          {error && <p className="text-red-500 mt-4">{error}</p>}
          {vectorizeMessage && <p className="mt-4">{vectorizeMessage}</p>}

          {contents.length > 0 && (
            <div className="mt-8 w-full max-w-2xl">
              <h2 className="text-xl mb-4">Repository Contents</h2>
              <ul className="list-disc list-inside">
                {contents.map((item, index) => (
                  <li key={index} className="mb-2">
                    <strong>{item.name}</strong> ({item.type}) - {item.path}
                    {item.download_url && (
                      <a
                        href={item.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green-500 ml-2"
                      >
                        View File
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <h2 className="text-xl mb-4">Connected Repository</h2>
          <p className="mb-2">{repoUrl || "No repository connected."}</p>
          <button
            onClick={() => router.push("/repo-structure")}
            className="rounded-md border border-solid border-black/[.08] dark:border-white/[.145] transition-all bg-primary text-primary-foreground h-10 px-4 hover:bg-primary/90 hover:shadow-md hover:scale-105"
          >
            View Repository Structure
          </button>
        </div>
      </div>
    </div>
  )
}

