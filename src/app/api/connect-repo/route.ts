import { NextResponse } from "next/server";
import axios from "axios";
import { get_encoding } from "tiktoken";
import { GoogleGenAI } from "@google/genai";

// Define an interface for the metadata returned from the code summary.
interface CodeSummaryMetadata {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

const blacklistedKeywords = ["LICENSE", "git", "docker", "Makefile", "config", "package"];
const blacklistedDirKeywords = [
  ".git",
  ".github",
  "docs",
  "tests",
  "example",
  "images",
  "docker",
  "sdks",
  "dev",
  "events",
  "extensions",
  "deployment",
  "public",
  "venv", ".ico"
];

// Helper function to check if an item is blacklisted
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

// Add delay between API calls
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Use Tiktoken for token counting (synchronous)
function countTokens(text: string): number {
  const encoding = get_encoding("cl100k_base");
  return encoding.encode(text).length;
}

// Function to get code summary using Google's Gemini model.
// Replaced "any" with the proper CodeSummaryMetadata type.
// Note the metadata is now coerced to null if undefined.
async function getCodeSummary(code: string): Promise<{
  summary: string;
  metadata: CodeSummaryMetadata | null;
  current_input_token: number;
}> {
  try {
    await delay(1000); // Keep the delay to avoid rate limits

    const system_prompt = `Analyze the provided code and return a detailed summary in a valid JSON format. Your response should include (but is not limited to) the following keys:
                {
                  "overall_summary": "A comprehensive explanation of what the code does, its purpose, and high-level functionality.",
                  "functions": "A list of all the functions defined in the code along with a brief description of each function's purpose, parameters, and return values (if identifiable).",
                  "classes": "If applicable, a list of classes defined in the code, along with their key methods and attributes.",
                  "variables": "Important global or significant variables used in the code, including constants.",
                  "dependencies": {
                    "external_libraries": "Any external libraries, frameworks, or modules imported and used in the code.",
                    "file_dependencies": "Any other files or modules (both frontend and backend) that the code depends on for data (e.g., files from which data is sent or received, API endpoints, etc.)."
                  },
                  "requests": "Identify and list all HTTP requests (GET, POST, PUT, DELETE, etc.) made in the code along with their endpoints and a brief description of their purpose.",
                  "file_system_operations": "Any file system operations performed (reading/writing files, accessing directories, etc.).",
                  "additional_notes": "Any other relevant details or observations that may help in understanding the code (such as design patterns, error handling, comments, etc.)."
                }

                Please ensure that the output is valid JSON and use the keys above as a guideline. Do not include any extra keys or text outside the JSON structure.

                Here is the code to analyze: ${code}`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Use our custom countTokens function for a consistent token count
    const current_input_token = countTokens(code);
    console.log("Number of Input Tokens", current_input_token);

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: system_prompt,
    });

    if (!response.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error("Failed to generate summary: No response text");
    }

    const responseText = response.candidates[0].content.parts[0].text;
    console.log("Code Summary", responseText);

    // Since Gemini might not provide usage metadata directly, we'll estimate it
    const output_tokens = countTokens(responseText);
    const metadata = {
      input_tokens: current_input_token,
      output_tokens: output_tokens,
      total_tokens: current_input_token + output_tokens
    };

    return {
      summary: responseText,
      metadata,
      current_input_token,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (
        "response" in error &&
        typeof error.response === "object" &&
        error.response !== null &&
        "status" in error.response &&
        error.response.status === 413
      ) {
        console.warn("Rate limit hit, returning simplified summary");
        return {
          summary: "File content too large to summarize",
          metadata: null,
          current_input_token: 0,
        };
      }
      console.error("Error getting code summary:", error.message);
      return {
        summary: "Failed to generate summary",
        metadata: null,
        current_input_token: 0,
      };
    } else {
      console.error("Unexpected error getting code summary:", error);
      return {
        summary: "Failed to generate summary",
        metadata: null,
        current_input_token: 0,
      };
    }
  }
}

// Function to fetch code content from URL with size limit
async function fetchCodeContent(url: string): Promise<string> {
  try {
    const response = await axios.get(url, {
      timeout: 5000, // 5 second timeout
    });
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if ("code" in error && error.code === "ECONNABORTED") {
        console.warn("Request timeout or content too large:", url);
        return "";
      }
      console.error("Error fetching code content:", error.message);
      return "";
    } else {
      console.error("Unexpected error fetching code content:", error);
      return "";
    }
  }
}

interface RepositoryItem {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  codeSummary: string | null;
  // Allow metadata to be either CodeSummaryMetadata, null, or undefined.
  metadata?: CodeSummaryMetadata | null;
  current_input_token?: number;
  total_input_token?: number;
}

// Recursive function to fetch repository contents with a running token total.
// We pass a mutable object to hold the running total across recursive calls.
const fetchRepositoryContents = async (
  repoUrl: string,
  token: string,
  path = "",
  runningInputTokenSum: { sum: number } = { sum: 0 }
): Promise<RepositoryItem[]> => {
  const repoItems: RepositoryItem[] = [];

  try {
    const parts = repoUrl.replace(/\/$/, "").split("/");
    const owner = parts[parts.length - 2];
    const repoName = parts[parts.length - 1];
    const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${path}`;

    const response = await axios.get(apiUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (response.status === 200) {
      const contents: Array<{
        name: string;
        path: string;
        type: string;
        download_url?: string | null;
      }> = response.data;

      for (const item of contents) {
        if (isBlacklisted(item.name, item.path)) {
          continue;
        }

        const repoItem: RepositoryItem = {
          name: item.name,
          path: item.path,
          type: item.type as "file" | "dir",
          download_url: item.download_url || null,
          codeSummary: null,
        };

        // Only process files with specific extensions
        if (
          item.type === "file" &&
          item.download_url &&
          /\.(ts|tsx|js|jsx|py|java|cpp|c|go|rs|php)$/.test(item.name)
        ) {
          const codeContent = await fetchCodeContent(item.download_url);
          if (codeContent) {
            console.log(`Processing file: ${item.name}`);
            const { summary, metadata, current_input_token } = await getCodeSummary(codeContent);
            console.log(`Token usage for ${item.name}:`, metadata);
            // Update the running total using the same token count method.
            runningInputTokenSum.sum += current_input_token;
            repoItem.metadata = metadata;
            repoItem.codeSummary = summary;
            repoItem.current_input_token = current_input_token;
            repoItem.total_input_token = runningInputTokenSum.sum;
            console.log(`Total Input Tokens so far: ${runningInputTokenSum.sum}`);
          }
        }

        repoItems.push(repoItem);

        if (item.type === "dir") {
          const subdirContents = await fetchRepositoryContents(repoUrl, token, item.path, runningInputTokenSum);
          repoItems.push(...subdirContents);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      let errorMessage = error.message;
      if (
        "response" in error &&
        typeof error.response === "object" &&
        error.response !== null &&
        "data" in error.response &&
        typeof error.response.data === "object" &&
        error.response.data !== null &&
        "message" in error.response.data &&
        typeof error.response.data.message === "string"
      ) {
        errorMessage = error.response.data.message;
      }

      console.error(`Error fetching repository contents: ${errorMessage}`);
      throw new Error(`Failed to fetch repository contents: ${errorMessage}`);
    } else {
      console.error("Unexpected error fetching repository contents:", error);
      throw new Error("Failed to fetch repository contents");
    }
  }
  return repoItems;
};

export async function POST(req: Request) {
  const startTime = performance.now();
  try {
    const { url } = await req.json();
    const token = process.env.git_api_key;
    const groqKey = process.env.GROQ_API_KEY;

    if (!url || !token || !groqKey) {
      return NextResponse.json(
        { error: "Missing required parameters: url, token, or GROQ_API_KEY" },
        { status: 400 }
      );
    }

    // Start with a running token total of 0.
    const contents = await fetchRepositoryContents(url, token, "", { sum: 0 });

    if (!contents || contents.length === 0) {
      return NextResponse.json(
        { message: "Repository is empty or no non-blacklisted items found" },
        { status: 200 }
      );
    }

    // Sort the repository items in ascending order by total_tokens.
    // For items without metadata, we default total_tokens to 0.
    const sortedContents = contents.sort((a, b) => {
      const tokensA = a.metadata?.total_tokens ?? 0;
      const tokensB = b.metadata?.total_tokens ?? 0;
      return tokensA - tokensB;
    });

    const BATCH_TOKEN_LIMIT = 15000;
    const batches: RepositoryItem[][] = [];
    let currentBatch: RepositoryItem[] = [];
    let currentBatchTokenSum = 0;

    for (const item of sortedContents) {
      const tokens = item.metadata?.total_tokens ?? 0;

      // Check if adding this item will exceed the batch limit.
      if (currentBatchTokenSum + tokens <= BATCH_TOKEN_LIMIT) {
        currentBatch.push(item);
        currentBatchTokenSum += tokens;
      } else {
        // Push the current batch and start a new one.
        batches.push(currentBatch);
        currentBatch = [item];
        currentBatchTokenSum = tokens;
      }
    }

    // Add any remaining items in the last batch.
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    console.log("Batches:", batches);

    const endTime = performance.now();
    const processingTime = (endTime - startTime) / 1000; // Convert to seconds
    console.log(`Total processing time: ${processingTime.toFixed(2)} seconds`);

    // Calculate total tokens from the metadata if needed.
    const tokenTotals = sortedContents.reduce(
      (acc, item) => {
        if (item.metadata) {
          acc.totalInputTokens += item.metadata.input_tokens;
          acc.totalOutputTokens += item.metadata.output_tokens;
          acc.totalTokens += item.metadata.total_tokens;
        }
        return acc;
      },
      {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      }
    );

    console.log("Total token usage:", tokenTotals);

    return NextResponse.json({
      contents: sortedContents,
      processingTime: Number(processingTime.toFixed(2)),
      tokenTotals,
      batches,
    });
  } catch (error) {
    const endTime = performance.now();
    const processingTime = (endTime - startTime) / 1000;
    console.log(`Total processing time (with error): ${processingTime.toFixed(2)} seconds`);

    if (error instanceof Error) {
      console.error("Error processing request:", error.message);
      return NextResponse.json(
        {
          error: "Internal Server Error",
          details: error.message,
          processingTime: Number(processingTime.toFixed(2)),
        },
        { status: 500 }
      );
    } else {
      console.error("Unexpected error processing request:", error);
      return NextResponse.json(
        { error: "Internal Server Error", details: "An unexpected error occurred." },
        { status: 500 }
      );
    }
  }
}
