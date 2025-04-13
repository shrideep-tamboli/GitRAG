"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/lib/AuthContext"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Copy, Download, ExternalLink } from "lucide-react"

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

export default function ConnectRepoSection() {
  const { user } = useAuth()
  const [repoUrl, setRepoUrl] = useState("")
  const [inputRepoUrl, setInputRepoUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [contents, setContents] = useState<RepoItem[]>([])
  const [vectorizing, setVectorizing] = useState(false)
  const [vectorizeMessage, setVectorizeMessage] = useState("")

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

  const handleConnect = async () => {
    setLoading(true)
    setError("")
    setContents([])

    try {
      const response = await fetch("/api/connect-repo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: inputRepoUrl,
          userId: user?.id,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to connect to the repository")
      }

      if (data.message) {
        setError(data.message)
      } else {
        setContents(data.contents)
        setRepoUrl(inputRepoUrl)
        setInputRepoUrl("")

        await fetch("/api/repo-structure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repoUrl: inputRepoUrl,
            repoStructure: data.contents,
            userId: user?.id,
          }),
        })

        setVectorizing(true)
        setVectorizeMessage("")
        try {
          const vectorizeRes = await fetch("/api/vectorize", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ userId: user?.id }),
          })
          const vectorizeData = await vectorizeRes.json()
          setVectorizeMessage(vectorizeData.message || "Vectorization complete!")
        } catch (vectorizeError: unknown) {
          console.error("Error vectorizing graph:", vectorizeError)
          setVectorizeMessage("Error vectorizing graph")
        } finally {
          setVectorizing(false)
        }

        const repoStructureSection = document.getElementById("repo-structure")
        repoStructureSection?.scrollIntoView({ behavior: "smooth" })
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError("An unexpected error occurred.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="connect-repo" className="min-h-screen flex items-center justify-center p-8 bg-[#f9f9f7]">
      <div className="w-full max-w-6xl">
        <Card className="border-2 border-gray-800/20 rounded-xl bg-[#fdf6e3] shadow-lg overflow-hidden">
          <CardContent className="p-0">
            <div className="flex flex-col md:flex-row">
              <div className="flex-1 flex flex-col items-center justify-center p-8 md:border-r md:border-gray-800/10">
                <h1 className="text-2xl font-bold mb-6 text-gray-800">Connect to Git Repository</h1>

                <div className="w-full max-w-md mb-6">
                  <Input
                    type="text"
                    value={inputRepoUrl}
                    onChange={(e) => setInputRepoUrl(e.target.value)}
                    placeholder="Enter Git Repo URL"
                    className="w-full border-2 border-gray-800/20 rounded-lg p-3 bg-white text-gray-800 focus:border-gray-800/40 focus:ring-0"
                  />
                </div>

                <button
                  onClick={handleConnect}
                  disabled={loading || vectorizing}
                  className={`rounded-lg border-0 transition-all flex items-center justify-center bg-[#f8b878] text-gray-800 font-medium h-12 px-6 ${
                    loading || vectorizing ? "opacity-50 cursor-not-allowed" : "hover:bg-[#f6a55f] hover:shadow-md"
                  }`}
                >
                  {loading ? "Connecting..." : vectorizing ? "Vectorizing..." : "Connect Repository"}
                </button>

                {error && <p className="text-red-500 mt-4">{error}</p>}
                {vectorizeMessage && <p className="mt-4 text-gray-700">{vectorizeMessage}</p>}

                {contents.length > 0 && (
                  <div className="mt-8 w-full max-w-2xl">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-xl font-bold text-gray-800">Repository Contents</h2>
                      <button className="flex items-center gap-1 bg-[#f8b878] text-gray-800 px-4 py-2 rounded-lg hover:bg-[#f6a55f]">
                        <Copy size={16} />
                        <span>Copy</span>
                      </button>
                    </div>

                    <Card className="border-2 border-gray-800/20 rounded-lg bg-[#fdf6e3] p-4">
                      <ul className="list-none">
                        {contents.map((item, index) => (
                          <li key={index} className="mb-2 flex items-start">
                            <span className="text-gray-600 mr-2">├─</span>
                            <div>
                              <strong className="text-gray-800">{item.name}</strong>
                              <span className="text-gray-600 text-sm ml-2">({item.type})</span>
                              {item.download_url && (
                                <a
                                  href={item.download_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#f6a55f] ml-2 inline-flex items-center"
                                >
                                  <ExternalLink size={14} className="mr-1" />
                                  View
                                </a>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Card>

                    <div className="flex justify-end gap-2 mt-4">
                      <button className="flex items-center gap-1 bg-[#f8b878] text-gray-800 px-4 py-2 rounded-lg hover:bg-[#f6a55f]">
                        <Download size={16} />
                        <span>Download</span>
                      </button>
                      <button className="flex items-center gap-1 bg-[#f8b878] text-gray-800 px-4 py-2 rounded-lg hover:bg-[#f6a55f]">
                        <Copy size={16} />
                        <span>Copy all</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-8">
                <h2 className="text-xl font-bold mb-6 text-gray-800">Connected Repository</h2>

                <Card className="border-2 border-gray-800/20 rounded-lg bg-[#fdf6e3] p-4 w-full max-w-md mb-6">
                  <p className="text-center text-gray-800">{repoUrl || "No repository connected."}</p>
                </Card>

                <button
                  onClick={() => {
                    const repoStructureSection = document.getElementById("repo-structure")
                    repoStructureSection?.scrollIntoView({ behavior: "smooth" })
                  }}
                  className="rounded-lg border-0 transition-all bg-[#f8b878] text-gray-800 font-medium h-12 px-6 hover:bg-[#f6a55f] hover:shadow-md"
                >
                  View Repository Structure
                </button>

{/* 
                {repoUrl && (
                  <div className="mt-8 w-full max-w-md">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-gray-800">Try these examples:</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["GitRag"].map((example) => (
                        <button
                          key={example}
                          className="bg-[#fdf6e3] border-2 border-gray-800/20 text-gray-800 px-4 py-2 rounded-lg hover:bg-[#f8b878]"
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
*/}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
