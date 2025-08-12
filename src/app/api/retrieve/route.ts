import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// Define schema for file relevance check
const fileRelevanceSchema = z.object({
  needed: z.boolean().describe("Only true if the file is directly relevant to the query"),
  enough: z.boolean().describe("Whether this file alone is sufficient to fully answer the query"),
  reasoning: z.string().describe("Detailed explanation of the decision, including relevance to the query"),
  relevantCodeBlock: z.array(z.string()).describe("Only specific code blocks directly relevant to the query")
});

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Initialize LLM for file selection
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.2,
});

// --- Types ---
interface EmbeddingValue { values: number[] }
interface EmbeddingResponse {
  embeddings: EmbeddingValue[];
  data?: { embeddings: number[][] };
}

interface FileContext {
  filePath: string;
  fileContent: string;
  codeSummary: string;
  score: number;
  url: string;
}

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

export interface RetrievedSource {
  url: string;
  score: number;
  codeSummary: string;
  summaryEmbedding: number[] | null;
  reasoning: string;  // Made this required since we always provide it
  relevantCodeBlocks: string[]; // Array of relevant code blocks
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

export async function POST(request: Request) {
  try {
    const body: RetrieveRequest = await request.json();
    const { threadId, message, summaries, urlFrequencyList = [] } = body;

            // Define schema for context check response
    const contextCheckSchema = z.object({
      hasEnoughContext: z.boolean().describe("Whether the message has enough context to be answered on its own"),
      reasoning: z.string().describe("Explanation for why the message does or doesn't have enough context")
    });

    // 1) First, check if the current message has enough context
    const contextCheckPrompt = ChatPromptTemplate.fromMessages([
      ["system", `You are an AI assistant that determines if a user's message has enough context to be answered.`],
      ["human", `Does this message have enough context to be answered on its own, or does it reference previous messages?
      
      Message: {message}
      
      If the message is a follow-up or requires context from previous messages, respond with hasEnoughContext: false.`]
    ]);

    // Create a structured LLM with our schema
    const structuredLlm = llm.withStructuredOutput(contextCheckSchema, { name: "contextCheck" });
    
    // Get the formatted prompt
    const formattedPrompt = await contextCheckPrompt.format({ message });
    
    // Get the structured response
    let contextCheck;
    try {
      contextCheck = await structuredLlm.invoke(formattedPrompt);
      console.log('Context Check Response:', contextCheck);
    } catch (e) {
      console.error('Error in context check:', e);
      contextCheck = { hasEnoughContext: true, reasoning: 'Defaulting to true due to error in context check' };
    }

    let searchQuery = message;
    
    // Define chat message interface
    interface ChatMessage {
      user_query: string;
      bot_response: string;
      created_at: string;
      context_urls?: string[];
    }
    
    let previousMessages: ChatMessage[] = [];
    
    if (!contextCheck.hasEnoughContext && threadId) {
      // Extract UUID part if the threadId has a prefix (e.g., 'thread_9s3mme2a8' -> '9s3mme2a8')
      // Or use as-is if it's already a valid UUID
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const uuidMatch = threadId.match(uuidPattern);
      const cleanThreadId = uuidMatch ? uuidMatch[0] : threadId;
      
      console.log('Context needed - fetching previous messages for thread:', cleanThreadId);
      try {
        const { data, error } = await supabase
          .from('chat_data')
          .select('user_query, bot_response, created_at, context_urls')
          .eq('thread_id', cleanThreadId)
          .order('created_at', { ascending: false })
          .limit(5); // Get last 5 messages
          
        if (data) {
          previousMessages = data as ChatMessage[];
        }

        console.log('Previous messages query result:', { 
          count: previousMessages?.length || 0, 
          error 
        });
          
        if (error) {
          console.error('Supabase error:', error);
        } else if (previousMessages && previousMessages.length > 0) {
          console.log('===== PREVIOUS MESSAGES =====');
          previousMessages.forEach((msg, index) => {
            console.log(`\n--- Message ${index + 1} (${new Date(msg.created_at).toISOString()}) ---`);
            console.log(`User: ${msg.user_query}`);
            console.log(`Bot: ${msg.bot_response}\n`);
          });
          console.log('=============================');
          
          // Create a structured LLM for query rewriting
          const queryRewriteSchema = z.object({
            rewrittenQuery: z.string().describe("The rewritten query that incorporates the context from previous messages"),
            reasoning: z.string().describe("Explanation of how the context was used to rewrite the query")
          });
          
          const structuredQueryRewriter = llm.withStructuredOutput(queryRewriteSchema, { name: "queryRewriter" });
          
          // Create prompt for query rewriting
          const rewritePrompt = ChatPromptTemplate.fromMessages([
            ["system", `You are a helpful assistant that rewrites user queries to include necessary context from previous messages.
            Your task is to rewrite the current user query to be self-contained and clear, incorporating relevant context from the conversation history.
            
            Respond with a JSON object containing:
            - rewrittenQuery: The rewritten query that includes all necessary context
            - reasoning: Brief explanation of how you incorporated the context`],
            ["human", `Rewrite the following query to include necessary context from the conversation history.
            
            Conversation History (most recent first):
            {history}
            
            Current Query: {currentQuery}
            
            Rewrite the current query to be self-contained and clear, incorporating relevant context from the conversation history.`]
          ]);
          
          try {
            // Format the conversation history for the prompt
            const conversationHistory = previousMessages
              .map((msg, idx) => 
                `Message ${previousMessages.length - idx} (${new Date(msg.created_at).toISOString()}):\n` +
                `User: ${msg.user_query}\n` +
                `Assistant: ${msg.bot_response}\n`
              )
              .join('\n');
            
            // Get the formatted prompt
            const formattedRewritePrompt = await rewritePrompt.format({
              history: conversationHistory,
              currentQuery: message
            });
            
            // Get the rewritten query using the structured LLM
            const rewriteResult = await structuredQueryRewriter.invoke(formattedRewritePrompt);
            console.log('Query Rewrite Result:', rewriteResult);
            
            // Use the rewritten query for search
            searchQuery = rewriteResult.rewrittenQuery;
            console.log('Original query:', message);
            console.log('Rewritten query with context:', searchQuery);
            console.log('Rewriting reasoning:', rewriteResult.reasoning);
            
          } catch (rewriteError) {
            console.error('Error rewriting query with context:', rewriteError);
            // Fallback to simple concatenation if rewriting fails
            const previousQueries = previousMessages.map(m => m.user_query).join(' ');
            searchQuery = `${previousQueries} ${message}`.trim();
            console.log('Falling back to simple query concatenation:', searchQuery);
          }
        } else {
          console.log('No previous messages found for thread:', threadId);
        }
      } catch (e) {
        console.error('Error fetching previous message:', e);
      }
    }

    // 2) Log the final search query and context check result
    console.log('Context Check Result:', {
      hasEnoughContext: contextCheck?.hasEnoughContext,
      reasoning: contextCheck?.reasoning,
      threadId: threadId || 'none',
      originalMessage: message,
      finalSearchQuery: searchQuery,
      queryIncludesPrevious: searchQuery !== message
    });

    // 3) Embed the final search query
    console.log('Embedding final search query:', searchQuery);
    const queryEmbedding = await generateEmbeddings(searchQuery);

        // Define interface for chat message structure
    interface ChatMessage {
      context_urls?: string[];
      [key: string]: unknown;
    }

    // 4) Collect context URLs from previous messages if needed
    let contextUrls: string[] = [];
    const chatMessages: ChatMessage[] = Array.isArray(previousMessages) ? previousMessages : [];
    if (!contextCheck.hasEnoughContext && threadId && chatMessages.length > 0) {
      contextUrls = chatMessages
        .filter((msg): msg is ChatMessage & { context_urls: unknown[] } => 
          Array.isArray(msg.context_urls))
        .flatMap(msg => msg.context_urls)
        .filter((url): url is string => 
          typeof url === 'string' && url.trim() !== '');
      
      console.log('Found context URLs from previous messages:', contextUrls);
    }

    // 5) Two-phase retrieval:
    // Phase 1: First check files from urlFrequencyList if available
    const phase1Results: Array<{
      url: string;
      codeSummary: string;
      summaryEmbedding: number[] | null;
      score: number;
      isFromContext: boolean;
      isFromFrequencyList: boolean;
      needed: boolean;
      enough: boolean;
      reasoning: string;
      relevantCodeBlocks: string[];
    }> = [];
    
    // Get all summaries with their cosine similarity scores
    const allSummariesWithScores = summaries
      .filter(s => s.summaryEmbedding)
      .map(s => ({
        ...s,
        score: cosineSimilarity(queryEmbedding, s.summaryEmbedding!)
      }))
      .sort((a, b) => b.score - a.score);
    
    // If we have cached files, process those files first
    if (urlFrequencyList?.length > 0) {
      console.log('Phase 1: Processing files from cache');
      const frequencyUrls = new Set(urlFrequencyList.map(item => item.url));
      
      // Get and sort cached files by cosine similarity
      const frequencySummaries = allSummariesWithScores
        .filter(s => Array.from(frequencyUrls).some(url => s.url.includes(url)))
        .sort((a, b) => b.score - a.score);
      
      console.log(`Found ${frequencySummaries.length} files from cache`);
      
      // Process each file in the frequency list to check if it should be used
      for (const sim of frequencySummaries) {
        const fileContent = await fetchFileContent(sim.url);
        const fileContext: FileContext = {
          filePath: sim.url.includes("/contents/") 
            ? sim.url.split("/contents/")[1] 
            : sim.url.split("/main/")[1] || sim.url,
          fileContent,
          codeSummary: sim.codeSummary,
          score: sim.score,
          url: sim.url
        };
        
        const fileAnalysis = await shouldUseFile(
          fileContext,
          message,
          phase1Results
            .filter(f => f.needed)
            .map(f => {
              const { ...relevantData } = f;
              return `File: ${f.url}\n` +
                Object.entries(relevantData)
                  .filter(([key, value]) => value !== undefined && value !== null && value !== '' && !Array.isArray(value) || (Array.isArray(value) && value.length > 0))
                  .map(([key, value]) => 
                    `${key}: ${Array.isArray(value) ? value.join('\n') : value}`
                  )
                  .join('\n');
            })
            .join('\n\n')
        );
        
        const result = {
          ...sim,
          isFromContext: contextUrls.some(u => sim.url.includes(u)),
          isFromFrequencyList: true,
          needed: fileAnalysis.needed,
          enough: fileAnalysis.enough,
          reasoning: fileAnalysis.reasoning,
          relevantCodeBlocks: fileAnalysis.relevantCodeBlocks || []
        };
        
        phase1Results.push(result);
        console.log(`Continous Context`, phase1Results)
        
        console.log(`File ${sim.url} - needed: ${result.needed}, enough: ${result.enough}`);
        
        // If we have enough context, we can stop early
        if (result.enough) {
          console.log('Found sufficient context in frequency list files');
          break;
        }
      }
      
      // Check if any file in phase 1 had enough context
      const hasEnoughInPhase1 = phase1Results.some(r => r.enough);
      
      // If we found files with enough context in phase 1, return those results
      if (hasEnoughInPhase1) {
        const sufficientResults = phase1Results.filter(r => r.needed);
        console.log('Returning results from cache with sufficient context');
        return NextResponse.json({
          success: true,
          sources: sufficientResults.map(r => ({
            url: r.url,
            score: r.score,
            codeSummary: r.codeSummary,
            summaryEmbedding: r.summaryEmbedding,
            reasoning: r.reasoning,
            relevantCodeBlocks: r.relevantCodeBlocks
          })),
          reasoning: `Found ${sufficientResults.length} relevant source(s) from cache with sufficient context.`,
          relevantCodeBlocks: sufficientResults.flatMap(r => r.relevantCodeBlocks),
          finalQuery: searchQuery
        });
      } else {
        console.log('No files in cache had enough context, proceeding to Phase 2');
      }
    }
    
    // Phase 2: Fall back to regular similarity search for remaining files
    console.log('Phase 2: Falling back to regular similarity search');
    
    // Get files that weren't already checked in phase 1
    // But include files that were marked as needed (even if not enough) in phase 1
    const checkedUrls = new Set(phase1Results.filter(r => !r.needed).map(r => r.url));
    const remainingSummaries = [
      ...phase1Results.filter(r => r.needed),
      ...allSummariesWithScores.filter(s => !checkedUrls.has(s.url))
    ].sort((a, b) => b.score - a.score);
    
    // Process files in batches of 3, continuing until a batch has all unneeded files
    const phase2Results: typeof phase1Results = [];
    const BATCH_SIZE = 3;
    
    // Process files in batches
    for (let i = 0; i < remainingSummaries.length; i += BATCH_SIZE) {
      const batch = remainingSummaries.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${i / BATCH_SIZE + 1} with ${batch.length} files`);
      
      // Process all files in the current batch in parallel
      const batchPromises = batch.map(async (sim) => {
        const fileContent = await fetchFileContent(sim.url);
        const fileContext: FileContext = {
          filePath: sim.url.includes("/contents/") 
            ? sim.url.split("/contents/")[1] 
            : sim.url.split("/main/")[1] || sim.url,
          fileContent,
          codeSummary: sim.codeSummary,
          score: sim.score,
          url: sim.url
        };
        
        return shouldUseFile(
          fileContext,
          message,
          phase2Results.map(f => f.codeSummary).join('\n\n')
        ).then(fileAnalysis => ({
          sim,
          analysis: fileAnalysis
        }));
      });
      
      // Wait for all files in the batch to be processed
      const batchResults = await Promise.all(batchPromises);
      
      // Process the results of the current batch
      let hasNeededFileInBatch = false;
      
      for (const { sim, analysis } of batchResults) {
        if (analysis.needed) {
          hasNeededFileInBatch = true;
          
          const result = {
            ...sim,
            isFromContext: contextUrls.some(u => sim.url.includes(u)),
            isFromFrequencyList: false,
            needed: true,
            enough: analysis.enough,
            reasoning: analysis.reasoning,
            relevantCodeBlocks: analysis.relevantCodeBlocks || []
          };
          
          phase2Results.push(result);
          console.log(`File ${sim.url} - needed: true, enough: ${result.enough}`);
        } else {
          console.log(`File ${sim.url} - needed: false`);
        }
      }
      
      // If no files in this batch were needed, we can stop
      if (!hasNeededFileInBatch) {
        console.log('No files in this batch were needed, stopping Phase 2');
        break;
      }
      
      // Safety limit: don't process more than 30 files total (10 batches of 3)
      if (phase2Results.length >= 30) {
        console.log('Reached maximum number of files to process in Phase 2');
        break;
      }
    }
    
    // Combine phase 1 and phase 2 results, prioritizing phase 2
    const allResults = [...phase1Results, ...phase2Results]
      .filter(r => r.needed)
      .sort((a, b) => b.score - a.score);
      
    // If we have any results, return them
    if (allResults.length > 0) {
      return NextResponse.json({
        success: true,
        sources: allResults.map(r => ({
          url: r.url,
          score: r.score,
          codeSummary: r.codeSummary,
          summaryEmbedding: r.summaryEmbedding,
          reasoning: r.reasoning,
          relevantCodeBlocks: r.relevantCodeBlocks
        })),
        reasoning: `Found ${allResults.length} relevant source(s).`,
        relevantCodeBlocks: allResults.flatMap(r => r.relevantCodeBlocks),
        finalQuery: message // Using the original message as the final query
      });
    }

    // If we get here, no relevant files were found
    console.log('No relevant files found for the query');
    return NextResponse.json({
      success: true,
      sources: [],
      reasoning: 'No relevant files found for the query.',
      relevantCodeBlocks: [],
      finalQuery: searchQuery
    });

    // Function to fetch file content
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

    // Function to determine if a file is needed and sufficient
    async function shouldUseFile(
      file: FileContext,
      query: string,
      previousContext: string
    ): Promise<{ 
      needed: boolean; 
      enough: boolean; 
      reasoning: string;
      relevantCodeBlocks: string[];
    }> {
      // Create the prompt
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
        4. relevantCodeBlock: Only specific code blocks from THIS FILE that directly answer the query
      
        BE STRICT IN YOUR EVALUATION. When in doubt, mark as not needed.`],
        ["human", `User query: {query}
        
        File path: {filePath}
        File summary: {fileSummary}
        
        File content: {fileContent}`]
      ]);

      // Create a structured LLM for file relevance check
      const structuredFileChecker = llm.withStructuredOutput(fileRelevanceSchema, { 
        name: "fileRelevance" 
      });

      try {
        // Format the prompt with the actual values
        const formattedPrompt = await prompt.format({
          query,
          previousContext: previousContext || 'None',
          filePath: file.filePath,
          fileSummary: file.codeSummary,
          fileContent: file.fileContent
        });

        // Get the structured response
        const result = await structuredFileChecker.invoke(formattedPrompt);
        
        console.log(`→ ${file.filePath}`);
        console.log("LLM File Analysis Result:", {
          needed: result.needed,
          enough: result.enough,
          reasoning: result.reasoning,
          codeBlocksCount: result.relevantCodeBlock?.length || 0
        });
      
        return {
          needed: result.needed,
          enough: result.enough,
          reasoning: result.reasoning,
          relevantCodeBlocks: result.relevantCodeBlock || []
        };
      } catch (e) {
        console.error('Error in file relevance check:', e);
        return {
          needed: false,
          enough: false,
          reasoning: 'Error processing file analysis',
          relevantCodeBlocks: []
        };
      }
    }

    // This code is no longer needed as we've moved the logic above
  } catch (err) {
    console.error("Retrieve error:", err);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve relevant sources" },
      { status: 500 }
    );
  }
}
