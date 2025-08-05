import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const threadId = body.threadId as string | undefined;
    const message = body.message as string;
    const summaries = body.summaries as Array<{
      codeSummary: string;
      summaryEmbedding: number[] | null;
      url: string;
    }>;

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

    // 5) Compute similarity scores, prioritizing context URLs if available
    let sims;
    
    if (contextUrls.length > 0) {
      console.log('Prioritizing search in context URLs');
      // First, search only within context URLs
      const contextUrlSims = summaries
        .filter(s => s.summaryEmbedding && contextUrls.some(url => s.url.includes(url)))
        .map(s => ({
          ...s,
          score: cosineSimilarity(queryEmbedding, s.summaryEmbedding!),
          isFromContext: true
        }));
      
      // Then search the rest of the summaries
      const otherSims = summaries
        .filter(s => s.summaryEmbedding && !contextUrls.some(url => s.url.includes(url)))
        .map(s => ({
          ...s,
          score: cosineSimilarity(queryEmbedding, s.summaryEmbedding!),
          isFromContext: false
        }));
      
      // Combine and sort by score
      sims = [...contextUrlSims, ...otherSims];
    } else {
      // If no context URLs, search all summaries
      sims = summaries
        .filter((s) => s.summaryEmbedding)
        .map((s) => ({
          ...s,
          score: cosineSimilarity(queryEmbedding, s.summaryEmbedding!),
          isFromContext: false
        }));
    }

    // Sort the results in descending order based on the score
    sims.sort((a, b) => b.score - a.score);

    // Sort by score and take top 6
    const sortedSims = [...sims].sort((a, b) => b.score - a.score).slice(0, 3);

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

    // Define schema for file relevance check
    const fileRelevanceSchema = z.object({
      needed: z.boolean().describe("Whether this file is needed to answer the query"),
      enough: z.boolean().describe("Whether this file alone is sufficient to fully answer the query"),
      reasoning: z.string().describe("Explanation of why the file is needed/sufficient"),
      relevantCodeBlock: z.array(z.string()).describe("Relevant code blocks from the file")
    });

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
        You will be given:
        1. The user's query
        2. Previous context (if any)
        3. A file's content and metadata

        You must answer two questions:
        1. Is this file needed to answer the query? (yes/no)
        2. Is this file alone enough to fully answer the query? (yes/no)
        
        The relevantCodeBlock should be an array of code blocks that are most relevant to answering the query. Each string should be a complete, self-contained code block that helps answer the user's question. If no code is relevant, return an empty array.`],
        ["human", `User query: {query}
        
        Previous context: {previousContext}
        
        File path: {filePath}
        File summary: {fileSummary}
        
        File content (first 2000 chars): {fileContent}`]
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
          fileContent: file.fileContent.substring(0, 2000)
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

    // Process files in order of relevance
    const selectedFiles: RetrievedSource[] = [];
    for (const sim of sortedSims) {
      if (selectedFiles.length >= 3) break;

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

      const previousContext = selectedFiles
        .map(f => `File: ${f.url.split('/').pop()}\nSummary: ${f.codeSummary}`)
        .join('\n\n');

      const fileAnalysis = await shouldUseFile(
        fileContext,
        body.message,
        previousContext
      );

      if (fileAnalysis.needed) {
        selectedFiles.push({
          url: sim.url,
          score: sim.score,
          codeSummary: sim.codeSummary,
          summaryEmbedding: sim.summaryEmbedding,
          reasoning: fileAnalysis.reasoning || `Selected based on relevance score of ${sim.score.toFixed(2)}.`,
          relevantCodeBlocks: 'relevantCodeBlocks' in fileAnalysis ? fileAnalysis.relevantCodeBlocks : []
        });

        if (fileAnalysis.enough || selectedFiles.length >= 3) {
          break; // Stop if enough or limit reached
        }
      }
    }

    // If no files were selected, fall back to the top result
    const finalSources: RetrievedSource[] = selectedFiles.length > 0 
      ? selectedFiles 
      : [{
          url: sortedSims[0].url,
          score: sortedSims[0].score,
          codeSummary: sortedSims[0].codeSummary,
          summaryEmbedding: sortedSims[0].summaryEmbedding,
          reasoning: `Selected as the most relevant file with a high relevance score of ${sortedSims[0].score.toFixed(2)}.`,
          relevantCodeBlocks: []
        }];

    // Ensure all sources have the required fields
    const sourcesWithReasoning = finalSources.map(source => ({
      ...source,
      relevantCodeBlocks: source.relevantCodeBlocks || []
    }));

    return NextResponse.json({
      success: true,
      sources: sourcesWithReasoning,
      reasoning: `Selected ${sourcesWithReasoning.length} relevant source${sourcesWithReasoning.length !== 1 ? 's' : ''} to answer the query.`,
      relevantCodeBlocks: sourcesWithReasoning.map(source => source.relevantCodeBlocks).flat(),
      finalQuery: searchQuery // Include the final query (original or rewritten)
    });
  } catch (err) {
    console.error("Retrieve error:", err);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve relevant sources" },
      { status: 500 }
    );
  }
}
