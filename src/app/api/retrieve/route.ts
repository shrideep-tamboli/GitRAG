// route.ts
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// (keep your fileRelevanceSchema, supabase, llm, ai, generateEmbeddings, cosineSimilarity, types, etc.)
// I preserve most helper functions and LLM initialization from your original file.

const fileRelevanceSchema = z.object({
  needed: z.boolean().describe("Only true if the file is directly relevant to the query"),
  enough: z.boolean().describe("Whether this file alone is sufficient to fully answer the query"),
  reasoning: z.string().describe("Detailed explanation of the decision, including relevance to the query"),
  relevantCodeBlock: z.array(z.string()).describe("Only specific code blocks directly relevant to the query. Avoid any extra character in the code block, not even any extra special character for say to indicate a line break or new line or tabs, etc that is not there in the source code itself. ")
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.2,
});

const ai = (() => {
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI === "true") {
    return new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
    });
  }
  return new GoogleGenAI({
    vertexai: false,
    apiKey: process.env.GEMINI_API_KEY,
  });
})();

async function generateEmbeddings(text: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: "text-embedding-004",
    contents: text,
  });
  const typed = response as EmbeddingResponse;
  if (typed.embeddings?.[0]?.values) {
    return typed.embeddings[0].values;
  }
  if (typed.data?.embeddings?.[0]) {
    return typed.data.embeddings[0];
  }
  throw new Error("Invalid embedding format");
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Types
export interface RetrievedSource {
  url: string;
  score: number;
  codeSummary: string;
  summaryEmbedding: number[] | null;
  reasoning: string;
  relevantCodeBlocks: string[];
}

interface EmbeddingResponse {
  embeddings?: Array<{ values?: number[] }>;
  data?: {
    embeddings: number[][];
  };
}

interface ProcessedFileResult extends RetrievedSource {
  isFromContext?: boolean;
  isFromFrequencyList?: boolean;
  needed: boolean;
  enough: boolean;
  reasoning: string;
}

interface RetrieveRequest {
  threadId?: string;
  message: string;
  summaries: Array<{
    codeSummary: string;
    summaryEmbedding: number[] | null;
    url: string;
  }>;
  urlFrequencyList?: Array<{
    url: string;
    frequency: number;
  }>;
}

// Helper to fetch raw file text
async function fetchFileContent(url: string): Promise<string> {
  try {
    let resp;
    if (url.includes("raw.githubusercontent.com")) {
      resp = await fetch(url);
    } else if (url.includes("api.github.com/repos")) {
      const parts = url.split("/repos/")[1].split("/contents/");
      const rawUrl = `https://raw.githubusercontent.com/${parts[0]}/main/${parts[1]}`;
      resp = await fetch(rawUrl);
    } else {
      resp = await fetch(url);
    }
    return await resp.text();
  } catch (e) {
    console.error(`Error fetching ${url}:`, e);
    return "";
  }
}

// The structured file checker (same logic you had)
async function shouldUseFile(
  file: { filePath: string; fileContent: string; codeSummary: string; score: number; url: string },
  query: string,
  previousContext: string
): Promise<{
  needed: boolean;
  enough: boolean;
  reasoning: string;
  relevantCodeBlocks: string[];
}> {
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", `You are an AI assistant that determines if a file is needed to answer a user's query.

    INSTRUCTIONS:
    1. Focus ONLY on the current file's content. Do not consider other files.
    2. A file should ONLY be marked as "needed" if it DIRECTLY contains code that answers the query.
    3. A file is NOT needed if:
      - It doesn't contain any code related to the query
      - It only contains references to other files
      - It's a configuration or utility file not directly related to the query
      - The connection to the query is too general or tangential

    For each file, provide:
    1. needed: true ONLY if this specific file's code directly answers the query
    2. enough: true ONLY if this file alone completely answers the query
    3. reasoning: Explain how THIS FILE's code answers the query. Do not mention other files.
    4. relevantCodeBlock: Only specific, raw code blocks from THIS FILE that directly answer the query ()

    BE STRICT IN YOUR EVALUATION. When in doubt, mark as not needed.`],
        ["human", `User query: {query}

    File path: {filePath}
    File summary: {fileSummary}

    File content: {fileContent}`]
  ]);

  const structuredFileChecker = llm.withStructuredOutput(fileRelevanceSchema, { name: "fileRelevance" });

  try {
    const formattedPrompt = await prompt.format({
      query,
      previousContext: previousContext || 'None',
      filePath: file.filePath,
      fileSummary: file.codeSummary,
      fileContent: file.fileContent
    });

    const result = await structuredFileChecker.invoke(formattedPrompt);

    const response = {
      needed: result.needed,
      enough: result.enough,
      reasoning: result.reasoning,
      relevantCodeBlocks: result.relevantCodeBlock || []
    };
    
    if (response.needed) {
      console.log(`[${file.filePath}] Relevant code blocks found: ${response.relevantCodeBlocks.length}`);
    }
    
    return response;
  } catch (e) {
    console.error(`[${file.filePath}] Error in file relevance check:`, e);
    return {
      needed: false,
      enough: false,
      reasoning: 'Error processing file analysis',
      relevantCodeBlocks: []
    };
  }
}

// POST handler that streams NDJSON lines
export async function POST(request: Request) {
  const requestId = Math.random().toString(36).substring(2, 8);
  console.log(`[${requestId}] Starting request processing...`);
  
  try {
    const body: RetrieveRequest = await request.json();
    const { threadId, message, summaries, urlFrequencyList = [] } = body;

    // Prepare stream
    const encoder = new TextEncoder();
    // Removed unused controllerRef

    const stream = new ReadableStream({
      async start(controller) {
        // controller variable is used by the stream
        const write = (obj: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          } catch (e) {
            console.error("Stream enqueue error:", e);
          }
        };

        try {
          console.log(`[${requestId}] Starting context check...`);
          const contextCheckSchema = z.object({
            hasEnoughContext: z.boolean(),
            reasoning: z.string()
          });
          const contextCheckPrompt = ChatPromptTemplate.fromMessages([
            ["system", `You are an AI assistant that determines if a user's message has enough context to be answered.`],
            ["human", `Does this message have enough context to be answered on its own, or does it reference previous messages?

            Message: {message}

            If the message is a follow-up or requires context from previous messages, respond with hasEnoughContext: false.`]
          ]);
          const structuredLlm = llm.withStructuredOutput(contextCheckSchema, { name: "contextCheck" });
          const formattedPrompt = await contextCheckPrompt.format({ message });
          let contextCheck;
          try {
            contextCheck = await structuredLlm.invoke(formattedPrompt);
          } catch (e) {
            console.error('Error in context check:', e);
            contextCheck = { hasEnoughContext: true, reasoning: 'Defaulting to true due to error in context check' };
          }

          let searchQuery = message;

          // Optionally rewrite query using previous messages (kept simple; original logic preserved)
          if (!contextCheck.hasEnoughContext && threadId) {
            try {
              // Attempt to fetch last messages from supabase for query rewrite if present
              const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
              const uuidMatch = threadId.match(uuidPattern);
              const cleanThreadId = uuidMatch ? uuidMatch[0] : threadId;

              const { data } = await supabase
                .from('chat_data')
                .select('user_query, bot_response, created_at, context_urls')
                .eq('thread_id', cleanThreadId)
                .order('created_at', { ascending: false })
                .limit(5);

              if (data && data.length > 0) {
                interface ChatMessage {
                  user_query: string;
                  bot_response: string;
                  created_at: string;
                  context_urls?: string[];
                }

                const conversationHistory = (data as ChatMessage[])
                  .map((msg) => `User: ${msg.user_query}\nAssistant: ${msg.bot_response}`)
                  .join("\n\n");

                const queryRewriteSchema = z.object({
                  rewrittenQuery: z.string(),
                  reasoning: z.string()
                });
                const structuredQueryRewriter = llm.withStructuredOutput(queryRewriteSchema, { name: "queryRewriter" });
                const rewritePrompt = ChatPromptTemplate.fromMessages([
                  ["system", `Rewrite the current user query to include necessary context from the conversation history.`],
                  ["human", `Conversation History:
                  {history}

                  Current Query: {currentQuery}

                  Rewrite the current query to be self-contained and clear.`]
                ]);
                const formattedRewritePrompt = await rewritePrompt.format({
                  history: conversationHistory,
                  currentQuery: message
                });
                try {
                  const rewriteResult = await structuredQueryRewriter.invoke(formattedRewritePrompt);
                  searchQuery = rewriteResult.rewrittenQuery;
                  // STREAM: inform frontend about rewritten query for reasoning UI
                  write({ type: "rewrite", data: { rewrittenQuery: searchQuery } });
                } catch (e) {
                  console.error("Query rewrite failed, falling back to original message:", e);
                  searchQuery = `${conversationHistory} ${message}`.trim();
                  // STREAM: still inform frontend what we're using as effective query
                  write({ type: "rewrite", data: { rewrittenQuery: searchQuery } });
                  console.log(`Query (Rewritten): ${searchQuery}`);
                }
              }
            } catch (e) {
              console.error("Error fetching previous messages for rewrite:", e);
            }
          }

          // 2) Embed the final query
          const queryEmbedding = await generateEmbeddings(searchQuery);

          // 3) Score summaries by cosine similarity
          const allSummariesWithScores = summaries
            .filter(s => s.summaryEmbedding)
            .map(s => ({ ...s, score: cosineSimilarity(queryEmbedding, s.summaryEmbedding!) }))
            .sort((a, b) => b.score - a.score);

          // Phase 1: process cached frequency list in batches (if provided)
          const phase1Results: ProcessedFileResult[] = [];
          let shouldProceedToPhase2 = true;
          const BATCH_SIZE = 3;

          if (urlFrequencyList?.length > 0) {
            const frequencyUrls = new Set(urlFrequencyList.map(item => item.url));
            const frequencySummaries = allSummariesWithScores
              .filter(s => Array.from(frequencyUrls).some(url => s.url.includes(url)))
              .sort((a, b) => b.score - a.score);

            // Process in batches of 3
            for (let i = 0; i < frequencySummaries.length; i += BATCH_SIZE) {
              const batchNumber = (i / BATCH_SIZE) + 1;
              const batch = frequencySummaries.slice(i, i + BATCH_SIZE);
              const batchResults: ProcessedFileResult[] = [];
              let hasNeededInBatch = false;
              
              console.log(`\n[${requestId}] [Phase 1] Processing Batch ${batchNumber}`);
              console.log('─'.repeat(80));

              // Process current batch in parallel
              const batchPromises = batch.map(async (sim) => {
                const filePath = sim.url.includes("/contents/") ? sim.url.split("/contents/")[1] : sim.url.split("/main/")[1] || sim.url;
                console.log(`\n[${requestId}] [Phase 1] File: ${filePath}`);
                
                const fileContent = await fetchFileContent(sim.url);
                const fileContext = {
                  filePath,
                  fileContent,
                  codeSummary: sim.codeSummary,
                  score: sim.score,
                  url: sim.url
                };

                const fileAnalysis = await shouldUseFile(fileContext, searchQuery, 
                  [...phase1Results, ...batchResults].filter(f => f.needed).map(f => f.codeSummary).join("\n\n"));
                console.log(`searchQuery: ${searchQuery}`);
                console.log(`Original Message: ${message}`)
                console.log(`[${requestId}] [Phase 1] File Analysis:`);
                console.log(`  Relative URL: ${filePath}`);
                console.log(`  Needed: ${fileAnalysis.needed}`);
                console.log(`  Enough: ${fileAnalysis.enough}`);
                console.log(`  Reasoning: ${fileAnalysis.reasoning}`);
                console.log(`  Relevant Code Blocks: ${fileAnalysis.relevantCodeBlocks?.length || 0}`);

                const result = {
                  url: sim.url,
                  score: sim.score,
                  codeSummary: sim.codeSummary,
                  summaryEmbedding: sim.summaryEmbedding || null,
                  isFromContext: false,
                  isFromFrequencyList: true,
                  needed: fileAnalysis.needed,
                  enough: fileAnalysis.enough,
                  reasoning: fileAnalysis.reasoning,
                  relevantCodeBlocks: fileAnalysis.relevantCodeBlocks || []
                };

                if (result.needed) {
                  hasNeededInBatch = true;
                  write({ type: "file", data: result });
                }

                return result;
              });

              // Wait for all files in batch to be processed
              const batchResultsResolved = await Promise.all(batchPromises);
              phase1Results.push(...batchResultsResolved);

              // If any file in this batch was needed, we'll stop after this batch
              if (hasNeededInBatch) {
                shouldProceedToPhase2 = false;
                break;
              }
            }
          }

          // Phase 2: process remaining files if no needed files found in Phase 1
          const phase2Results: ProcessedFileResult[] = [];
          
          if (shouldProceedToPhase2) {
            const processedUrls = new Set(phase1Results.map(r => r.url));
            const remainingSummaries = allSummariesWithScores
              .filter(s => !processedUrls.has(s.url))
              .sort((a, b) => b.score - a.score);

            // Process remaining files in batches of 3
            for (let i = 0; i < remainingSummaries.length; i += BATCH_SIZE) {
              const batchNumber = (i / BATCH_SIZE) + 1;
              const batch = remainingSummaries.slice(i, i + BATCH_SIZE);
              const batchResults: ProcessedFileResult[] = [];
              
              console.log(`\n[${requestId}] [Phase 2] Processing Batch ${batchNumber}`);
              console.log('─'.repeat(80));

              // Process current batch in parallel
              const batchPromises = batch.map(async (sim) => {
                const filePath = sim.url.includes("/contents/") ? sim.url.split("/contents/")[1] : sim.url.split("/main/")[1] || sim.url;
                console.log(`\n[${requestId}] [Phase 2] File: ${filePath}`);
                
                const fileContent = await fetchFileContent(sim.url);
                const fileContext = {
                  filePath,
                  fileContent,
                  codeSummary: sim.codeSummary,
                  score: sim.score,
                  url: sim.url
                };

                const analysis = await shouldUseFile(
                  fileContext,
                  searchQuery,
                  [...phase1Results, ...phase2Results, ...batchResults]
                    .filter(f => f.needed)
                    .map(f => f.codeSummary)
                    .join("\n\n")
                );

                console.log(`[${requestId}] [Phase 2] File Analysis:`);
                console.log(`  Relative URL: ${filePath}`);
                console.log(`  Needed: ${analysis.needed}`);
                console.log(`  Enough: ${analysis.enough}`);
                console.log(`  Reasoning: ${analysis.reasoning}`);
                console.log(`  Relevant Code Blocks: ${analysis.relevantCodeBlocks?.length || 0}`);

                const result = {
                  url: sim.url,
                  score: sim.score,
                  codeSummary: sim.codeSummary,
                  summaryEmbedding: sim.summaryEmbedding || null,
                  isFromContext: false,
                  isFromFrequencyList: false,
                  needed: analysis.needed,
                  enough: analysis.enough,
                  reasoning: analysis.reasoning,
                  relevantCodeBlocks: analysis.relevantCodeBlocks || []
                };

                return { sim, result };
              });

              // Process batch results
              const batchResultsResolved = await Promise.all(batchPromises);
              
              // Filter to only include needed files
              const neededFiles = batchResultsResolved
                .filter(({ result }) => result.needed)
                .map(({ result }) => result);
              
              // Add needed files to results
              phase2Results.push(...neededFiles);

              // Emit batch summary with needed files
              write({ 
                type: "batch", 
                data: { 
                  batchIndex: Math.floor(i / BATCH_SIZE) + 1, 
                  results: neededFiles,
                  isFinal: neededFiles.length === 0 // Mark as final if no files are needed
                } 
              });
              
              // If no files were needed in this batch, we can stop processing further batches
              if (neededFiles.length === 0) {
                console.log(`[${requestId}] [Phase 2] No needed files in batch ${batchNumber}, stopping further processing`);
                break;
              }

              // If we've found enough relevant files, we can stop
              if (phase2Results.length >= 30) { // safety cap
                console.log(`[${requestId}] [Phase 2] Reached maximum number of relevant files (30), stopping`);
                break;
              }
            }
          }

          // Combine phase1 & phase2 and return the final set of needed files
          // Use a Map to deduplicate by URL while keeping the highest score
          const uniqueResults = new Map();
          
          // Add phase1 results first
          phase1Results
            .filter(r => r.needed)
            .forEach(r => {
              if (!uniqueResults.has(r.url) || (uniqueResults.get(r.url).score < r.score)) {
                uniqueResults.set(r.url, r);
              }
            });
          
          // Add phase2 results, allowing them to override phase1 if score is higher
          phase2Results.forEach(r => {
            if (!uniqueResults.has(r.url) || (uniqueResults.get(r.url).score < r.score)) {
              uniqueResults.set(r.url, r);
            }
          });

          // Convert to array and sort by score
          const allResults = Array.from(uniqueResults.values())
            .sort((a, b) => b.score - a.score);

          const finalSources = allResults.map(r => ({
            url: r.url,
            score: r.score,
            codeSummary: r.codeSummary,
            summaryEmbedding: r.summaryEmbedding,
            reasoning: r.reasoning,
            relevantCodeBlocks: r.relevantCodeBlocks || []
          }));

          // STREAM: final message
          write({ type: "final", data: { sources: finalSources, finalQuery: searchQuery } });
          controller.close();
          return;

        } catch (err: unknown) {
          console.error(`[${requestId}] Error during processing:`, err);
          if (controller) {
            write({ type: "error", data: { message: String(err instanceof Error ? err.message : String(err)) } });
            controller.close();
          }
          return;
        }
      } // start
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache, no-transform"
      }
    });

  } catch (err: unknown) {
    console.error(`[${requestId}] Top-level error:`, err);
    return NextResponse.json({ 
      success: false, 
      message: "Failed to retrieve relevant sources",
      error: err instanceof Error ? err.message : String(err)
    }, { status: 500 });
  }
}
