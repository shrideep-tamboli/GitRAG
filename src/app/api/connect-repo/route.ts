import { NextResponse } from "next/server"
import axios from "axios"
import Groq from "groq-sdk"

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
})

const blacklistedKeywords = ["LICENSE", "git", "docker", "Makefile","config","package"]
const blacklistedDirKeywords = [ ".git", ".github", "docs", "tests", "example", "images", "docker", "sdks", "dev", "events", "extensions", "deployment", "public", "venv" ];

// Helper function to check if an item is blacklisted
const isBlacklisted = (itemName: string, itemPath: string): boolean => {
  if (itemName.startsWith(".")) return true

  for (const keyword of blacklistedKeywords) {
    if (itemName.toLowerCase().includes(keyword.toLowerCase())) return true
  }

  for (const keyword of blacklistedDirKeywords) {
    if (itemPath.toLowerCase().includes(keyword.toLowerCase())) return true
  }

  return false
}

// Helper function to truncate code to a reasonable size
function truncateCode(code: string, maxLength = 2000): string {
  if (code.length <= maxLength) return code
  return code.slice(0, maxLength) + "\n... (truncated for length)"
}

// Add delay between API calls
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Function to get code summary using Groq
async function getCodeSummary(code: string): Promise<string> {
  try {
    // Truncate code before sending to API
    const truncatedCode = truncateCode(code)

    // Add delay to avoid rate limits
    await delay(1000) // 1 second delay between requests

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Provide a brief, concise summary (max 100 words) of this code's main functionality:\n\n${truncatedCode}`,
        },
      ],
      model: "llama-3.3-70b-versatile",
      // Add temperature and max tokens to control response size
      temperature: 0.5,
      max_tokens: 150,
    })

    return completion.choices[0]?.message?.content || "No summary available"
  } catch (error: any) {
    // Improved error handling
    if (error?.response?.status === 413 || error?.message?.includes("rate_limit_exceeded")) {
      console.warn("Rate limit hit, returning simplified summary")
      return "File content too large to summarize"
    }
    console.error("Error getting code summary:", error)
    return "Failed to generate summary"
  }
}

// Function to fetch code content from URL with size limit
async function fetchCodeContent(url: string, maxSize = 100000): Promise<string> {
  try {
    const response = await axios.get(url, {
      maxContentLength: maxSize,
      timeout: 5000, // 5 second timeout
    })
    return response.data
  } catch (error: any) {
    if (error.code === "ECONNABORTED") {
      console.warn("Request timeout or content too large:", url)
      return ""
    }
    console.error("Error fetching code content:", error)
    return ""
  }
}

// Recursive function to fetch repository contents
const fetchRepositoryContents = async (repoUrl: string, token: string, path = ""): Promise<any[]> => {
  const repoItems: any[] = []

  try {
    const parts = repoUrl.replace(/\/$/, "").split("/")
    const owner = parts[parts.length - 2]
    const repoName = parts[parts.length - 1]
    const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${path}`

    const response = await axios.get(apiUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })

    if (response.status === 200) {
      const contents = response.data

      for (const item of contents) {
        if (isBlacklisted(item.name, item.path)) {
          continue
        }

        const repoItem = {
          name: item.name,
          path: item.path,
          type: item.type,
          download_url: item.download_url || null,
          codeSummary: null as string | null,
        }

        // Only process files with specific extensions
        if (item.type === "file" && item.download_url && /\.(ts|tsx|js|jsx|py|java|cpp|c|go|rs|php)$/.test(item.name)) {
          const codeContent = await fetchCodeContent(item.download_url)
          if (codeContent) {
            repoItem.codeSummary = await getCodeSummary(codeContent)
          }
        }

        repoItems.push(repoItem)

        if (item.type === "dir") {
          const subdirContents = await fetchRepositoryContents(repoUrl, token, item.path)
          repoItems.push(...subdirContents)
        }
      }
    }
  } catch (error: any) {
    console.error(`Error fetching repository contents: ${error.message}`)
    throw new Error(`Failed to fetch repository contents: ${error.response?.data?.message || error.message}`)
  }

  return repoItems
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json()
    const token = process.env.git_api_key
    const groqKey = process.env.GROQ_API_KEY

    if (!url || !token || !groqKey) {
      return NextResponse.json({ error: "Missing required parameters: url, token, or GROQ_API_KEY" }, { status: 400 })
    }

    const contents = await fetchRepositoryContents(url, token)

    if (!contents || contents.length === 0) {
      return NextResponse.json({ message: "Repository is empty or no non-blacklisted items found" }, { status: 200 })
    }

    console.log("Repo_Structure:", contents)
    return NextResponse.json(contents)
  } catch (error: any) {
    console.error("Error processing request:", error.message)
    return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 })
  }
}

