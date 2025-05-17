import { NextResponse } from "next/server";
import axios from "axios";
import { get_encoding } from "tiktoken";
import { GoogleGenAI } from "@google/genai";
import pLimit from "p-limit";

// Interface for code summary metadata
interface CodeSummaryMetadata {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

// Configuration
const API_CONFIG = {
  CONCURRENT_REQUESTS: 3,
  RATE_LIMIT_RPM: 30,
  BACKOFF_DELAY: 10,
  MAX_RETRIES: 3,
};

// Blacklist filters
const blacklistedKeywords = ["LICENSE", "git", "docker", "Makefile", "config", "package", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp",".sqlite",".zip"];
const blacklistedDirKeywords = [".git", ".github", "docs", "tests", "example", "images", "docker", "sdks", "dev", "events", "extensions", "deployment", "public", "venv", ".ico"];

const isBlacklisted = (itemName: string, itemPath: string): boolean => {
  if (itemName.startsWith(".")) return true;
  for (const keyword of blacklistedKeywords) {
    if (itemName.toLowerCase().includes(keyword.toLowerCase())) return true;
  }
  for (const keyword of blacklistedDirKeywords) {
    if (itemPath.toLowerCase().includes(keyword.toLowerCase())) return true;
  }
  return false;
};

// Delay helper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Sliding window rate limiter
const requestTimestamps: number[] = [];
const WINDOW_SIZE_MS = 60 * 1000;

function cleanOldTimestamps() {
  const now = Date.now();
  while (requestTimestamps.length && now - requestTimestamps[0] > WINDOW_SIZE_MS) {
    requestTimestamps.shift();
  }
}

async function rateLimit() {
  cleanOldTimestamps();
  if (requestTimestamps.length >= API_CONFIG.RATE_LIMIT_RPM) {
    const waitTime = WINDOW_SIZE_MS - (Date.now() - requestTimestamps[0]);
    console.log(`🌐 Rate limit hit — waiting ${Math.round(waitTime)}ms`);
    await delay(waitTime);
    cleanOldTimestamps();
  }
  requestTimestamps.push(Date.now());
}

// Retry with exponential backoff
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = API_CONFIG.MAX_RETRIES): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: unknown) {
      retries++;
      if (retries >= maxRetries || (!isRateLimitError(error))) {
        throw error;
      }
      const backoffTime = API_CONFIG.BACKOFF_DELAY * Math.pow(2, retries) * (0.5 + Math.random());
      console.log(`Rate limit hit, retrying in ${Math.round(backoffTime)}ms (retry ${retries}/${maxRetries})`);
      await delay(backoffTime);
    }
  }
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("429") || error.message.includes("rate limit");
  }
  return false;
}

// Token counting using tiktoken
function countTokens(text: string): number {
  const encoding = get_encoding("cl100k_base");
  return encoding.encode(text).length;
}

// Gemini summarization
async function getCodeSummary(code: string, fileUrl: string): Promise<{
  summary: string;
  metadata: CodeSummaryMetadata | null;
  current_input_token: number;
}> {
  try {
    const system_prompt = `Generate concise comments for the following code describing the purpose of the code and the logic behind it. 
Always include the first line as the File URL: ${fileUrl}
STRICTLY DO NOT include code syntaxes. 
Here is the code: ${code}`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const current_input_token = countTokens(code);
    console.log(`Processing ${fileUrl} - Input Tokens: ${current_input_token}`);

    await rateLimit(); // sliding window rate limit before API call

    const response = await retryWithBackoff(() =>
      ai.models.generateContent({
        model: "gemini-2.0-flash-lite",
        contents: system_prompt,
      })
    );

    const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) throw new Error("Failed to generate summary: No response text");

    const output_tokens = countTokens(responseText);
    const metadata = {
      input_tokens: current_input_token,
      output_tokens,
      total_tokens: current_input_token + output_tokens,
    };

    return { summary: responseText, metadata, current_input_token };
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error in getCodeSummary:", error.message);
      return {
        summary: "Failed to generate summary",
        metadata: null,
        current_input_token: 0,
      };
    } else {
      console.error("Unexpected error:", error);
      return {
        summary: "Failed to generate summary",
        metadata: null,
        current_input_token: 0,
      };
    }
  }
}

// Fetch raw code from GitHub
async function fetchCodeContent(url: string): Promise<string> {
  try {
    const response = await axios.get(url, { timeout: 1000 });
    return response.data;
  } catch (error) {
    console.warn("Error fetching code:", error);
    return "";
  }
}

// Repo item type
interface RepositoryItem {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  codeSummary: string | null;
  metadata?: CodeSummaryMetadata | null;
  current_input_token?: number;
  total_input_token?: number;
}

// GitHub API crawl
const discoverRepositoryFiles = async (
  repoUrl: string,
  token: string,
  path = ""
): Promise<RepositoryItem[]> => {
  const repoItems: RepositoryItem[] = [];
  const parts = repoUrl.replace(/\/$/, "").split("/");
  const [owner, repoName] = [parts[parts.length - 2], parts[parts.length - 1]];
  const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${path}`;

  const response = await axios.get(apiUrl, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  const contents = response.data;
  for (const item of contents) {
    if (isBlacklisted(item.name, item.path)) continue;

    const repoItem: RepositoryItem = {
      name: item.name,
      path: item.path,
      type: item.type as "file" | "dir",
      download_url: item.download_url || null,
      codeSummary: null,
    };

    repoItems.push(repoItem);

    if (item.type === "dir") {
      const subdirContents = await discoverRepositoryFiles(repoUrl, token, item.path);
      repoItems.push(...subdirContents);
    }
  }
  return repoItems;
};

// File processing logic
const processRepositoryFiles = async (
  filesToProcess: RepositoryItem[],
  runningInputTokenSum: { sum: number } = { sum: 0 }
): Promise<void> => {
  const limit = pLimit(API_CONFIG.CONCURRENT_REQUESTS);

  await Promise.all(
    filesToProcess.map((item) =>
      limit(async () => {
        try {
          if (!item.download_url) return;
          const codeContent = await fetchCodeContent(item.download_url);
          if (!codeContent) return;

          const { summary, metadata, current_input_token } = await getCodeSummary(codeContent, item.download_url);

          item.metadata = metadata;
          item.codeSummary = summary;
          item.current_input_token = current_input_token;
          runningInputTokenSum.sum += current_input_token;
          item.total_input_token = runningInputTokenSum.sum;

          console.log(`✅ ${item.name} processed (${current_input_token} tokens)`);
        } catch (error) {
          console.error(`❌ Error processing ${item.path}:`, error);
        }
      })
    )
  );
};

// Fetch and process full repository
const fetchRepositoryContents = async (
  repoUrl: string,
  token: string,
  path = "",
  runningInputTokenSum: { sum: number } = { sum: 0 }
): Promise<RepositoryItem[]> => {
  console.log("🔍 Discovering repository files...");
  const allItems = await discoverRepositoryFiles(repoUrl, token, path);

  const filesToProcess = allItems.filter(
    (item) =>
      item.type === "file" &&
      item.download_url &&
      /\.(ts|tsx|js|jsx|py|java|cpp|c|go|rs|php)$/.test(item.name)
  );

  console.log(`📂 ${filesToProcess.length} files to process`);
  await processRepositoryFiles(filesToProcess, runningInputTokenSum);

  return allItems;
};

// API handler
export async function POST(req: Request) {
  const startTime = performance.now();

  try {
    const { url } = await req.json();
    const token = process.env.git_api_key;
    const groqKey = process.env.GROQ_API_KEY;

    if (!url || !token || !groqKey) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const contents = await fetchRepositoryContents(url, token, "", { sum: 0 });

    if (!contents.length) {
      return NextResponse.json({ message: "No content found" }, { status: 200 });
    }

    const sortedContents = contents.sort((a, b) => {
      const tokensA = a.metadata?.total_tokens ?? 0;
      const tokensB = b.metadata?.total_tokens ?? 0;
      return tokensA - tokensB;
    });

    const tokenTotals = sortedContents.reduce(
      (acc, item) => {
        if (item.metadata) {
          acc.totalInputTokens += item.metadata.input_tokens;
          acc.totalOutputTokens += item.metadata.output_tokens;
          acc.totalTokens += item.metadata.total_tokens;
        }
        return acc;
      },
      { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 }
    );

    const endTime = performance.now();
    const processingTime = (endTime - startTime) / 1000;

    return NextResponse.json({
      contents: sortedContents,
      processingTime: Number(processingTime.toFixed(2)),
      tokenTotals,
    });
  } catch (error) {
    const endTime = performance.now();
    const processingTime = (endTime - startTime) / 1000;
    console.error("Error:", error);

    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
        processingTime: Number(processingTime.toFixed(2)),
      },
      { status: 500 }
    );
  }
}
