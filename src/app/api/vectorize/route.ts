// app/api/vectorize/route.ts
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import neo4j from "neo4j-driver";
import pLimit from "p-limit";
import { updateProgress } from "./progress/utils";

// Configuration
const API_CONFIG = {
  CONCURRENT_REQUESTS: 100,
  RATE_LIMIT_RPM: 500,
  BACKOFF_DELAY: 5,
  MAX_RETRIES: 3,
};

// Sliding-window rate limiter state
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
    console.log(`⏳ Rate limit hit, waiting ${waitTime}ms`);
    await new Promise((r) => setTimeout(r, waitTime));
    cleanOldTimestamps();
  }
  requestTimestamps.push(Date.now());
}

// Exponential backoff on 429s
async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let tries = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      tries++;
      const isRateError =
        (err as Error).toString().includes("429") ||
        (err as Error).toString().toLowerCase().includes("rate limit");
      if (tries > API_CONFIG.MAX_RETRIES || !isRateError) throw err;
      const backoff = API_CONFIG.BACKOFF_DELAY * 2 ** tries * (0.5 + Math.random());
      console.warn(`⚠️ Retry ${tries} in ${Math.round(backoff)}ms due to rate error`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

// GenAI client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  vertexai: false,
});

// Neo4j driver
const driver = neo4j.driver(
  process.env.NEO4J_URI ?? "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER ?? "neo4j",
    process.env.NEO4J_PASSWORD ?? "password"
  )
);

interface EmbeddingValue { values: number[]; }
interface EmbeddingResponse { embeddings: EmbeddingValue[]; }

interface FileNode {
  properties: {
    url: string;
    codeSummary?: string;
  };
}

async function generateEmbedding(text: string): Promise<number[]> {
  await rateLimit();
  const resp = await retryWithBackoff(() =>
    ai.models.embedContent({ model: "text-embedding-004", contents: text })
  ) as EmbeddingResponse;
  const vals = resp.embeddings?.[0]?.values;
  if (!Array.isArray(vals)) throw new Error("Invalid embedding response");
  return vals;
}

export async function POST(req: Request) {
  try {
    const { userId } = await req.json();

    // 1) Read all file nodes in one session
    const readSession = driver.session();
    const result = await readSession.run(
      "MATCH (n {userId: $userId}) WHERE n.type='File_Url' RETURN n",
      { userId }
    );
    await readSession.close();

    const fileNodes = result.records
      .map(r => r.get("n") as FileNode)
      .filter((n: FileNode) => !!n.properties.url);

    console.log(`🔍 Found ${fileNodes.length} files to vectorize`);
    
    // Initialize progress tracking
    const totalFiles = fileNodes.length;
    let processedFiles = 0;
    
    // Update initial progress
    updateProgress(userId, {
      totalFiles,
      processedFiles: 0,
      currentFile: ""
    });

    // 2) Process in parallel, but each write uses its own session
    const limit = pLimit(API_CONFIG.CONCURRENT_REQUESTS);
    await Promise.allSettled(
      fileNodes.map((node: FileNode) =>
        limit(async () => {
          const url: string = node.properties.url;
          // Update progress with current file
          updateProgress(userId, {
            currentFile: url,
            processedFiles
          });
          
          console.log(`➡️ Fetching ${url}`);
          let content = "";
          try {
            const res = await fetch(url);
            if (!res.ok) {
              console.warn(`Fetch failed (${res.status}): ${url}`);
              processedFiles++;
              updateProgress(userId, { processedFiles });
              return;
            }
            content = await res.text();
          } catch (e) {
            console.warn(`Fetch error for ${url}:`, e);
            processedFiles++;
            updateProgress(userId, { processedFiles });
            return;
          }

          // 3) Skip oversized content
          const maxBytes = 4 * 1024 * 1024;
          if (Buffer.byteLength(content, "utf8") > maxBytes) {
            console.warn(`Skipping ${url}: >4MB`);
            processedFiles++;
            updateProgress(userId, { processedFiles });
            return;
          }

          try {
            console.log(`🎯 Embedding content for ${url}`);
            const contentEmbedding = await generateEmbedding(content);

            const summary = node.properties.codeSummary || "";
            console.log(`🎯 Embedding summary for ${url}`);
            const summaryEmbedding = summary.trim()
              ? await generateEmbedding(summary)
              : [];

            // 4) Write embeddings in a fresh session
            const writeSession = driver.session();
            try {
              await writeSession.run(
                `
                MATCH (n) WHERE n.url = $url
                SET n.contentEmbedding = $contentEmbedding,
                    n.summaryEmbedding = $summaryEmbedding
                `,
                { url, contentEmbedding, summaryEmbedding }
              );
              console.log(`✅ Stored embeddings for ${url} - ${processedFiles + 1}/${totalFiles}`);
            } finally {
              await writeSession.close();
            }
            
            // Update progress
            processedFiles++;
            updateProgress(userId, { processedFiles });

          } catch (embedErr) {
            console.error(`❌ Embedding error for ${url}:`, embedErr);
            // Still update progress even for errors
            processedFiles++;
            updateProgress(userId, { processedFiles });
          }
        })
      )
    );

    return NextResponse.json(
      { message: "Graph vectorized successfully" },
      { status: 200 }
    );

  } catch (err: unknown) {
    console.error("❌ Vectorization error:", err);
    return NextResponse.json(
      { error: "Error vectorizing graph", details: (err as Error).message },
      { status: 500 }
    );
  }
}
