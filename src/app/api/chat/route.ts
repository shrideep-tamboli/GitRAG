import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies as nextCookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";
import Database from "better-sqlite3";

// LangGraph imports
import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { trimMessages, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

interface RetrievedSource {
  url: string;
  score: number;
  codeSummary: string;
  reasoning?: string;
  relevantCodeBlocks?: string[];
}

// --- Supabase setup ---
const createClient = async () => {
  const cookieStore = await nextCookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );
};

// --- Utility functions ---
/* Function to fetch file content 
async function fetchFileContent(url: string): Promise<string> {
  try {
    let resp;
    if (url.includes("raw.githubusercontent.com")) {
      resp = await axios.get(url);
    } else if (url.includes("api.github.com/repos")) {
      const parts = url.split("/repos/")[1].split("/contents/");
      const rawUrl = `https://raw.githubusercontent.com/${parts[0]}/main/${parts[1]}`;
      resp = await axios.get(rawUrl);
    } else {
      resp = await axios.get(url);
    }
    return resp.data;
  } catch (e) {
    if (axios.isAxiosError(e)) {
      return `Error: ${e.message} (status ${e.response?.status})`;
    }
    return "Unknown fetch error";
  }
}
*/


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      message: msg, 
      originalMessage,
      sources = [], 
      threadId,
    } = body;
    const supabase = await createClient();

    // 1) Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError) {
      console.error('Error getting user:', userError);
      return NextResponse.json(
        { success: false, message: 'Authentication required' },
        { status: 401 }
      );
    }

    // Determine if we're using an enhanced query
    const isEnhancedQuery = !!originalMessage && originalMessage !== msg;

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      throw new Error("No sources provided");
    }

    console.log("Processing chat with", sources.length, "potential sources");

    // Initialize LLM for file selection and response generation
    const llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0.2, // Lower temperature for more deterministic decisions
    });

    // Build context string with reasoning, relevant code blocks, and file content for each source
    const contextStr = await Promise.all(sources.map(async (source: RetrievedSource) => {
      const relevantCodeBlocks = source.relevantCodeBlocks?.length 
        ? `\n\nRelevant Code Snippets:\n${source.relevantCodeBlocks.map((block: string, i: number) => `--- Snippet ${i + 1} ---\n${block}`).join('\n\n')}`
        : '';
      return `Reasoning: ${source.reasoning || 'Selected based on relevance score.'}${relevantCodeBlocks}`;
    })).then((results: string[]) => results.join('\n\n' + '='.repeat(80) + '\n\n'));

    console.log("Sending to Gemini:", {
      message: msg,
      context: contextStr  // Log how the context is being formatted
    });
    
    console.log(`Using ${sources.length} relevant files for context`);

    // Build the prompt template with proper escaping
    const promptTemplate = ChatPromptTemplate.fromMessages([
      ["system", `You are a helpful AI assistant that answers questions about a codebase.
      Use the following context with reasoning to answer the user's question.      
      
      {context}
      
      If the answer cannot be found in the provided context, say "I couldn't find the answer in the provided context."`],
      ["human", "{messages}"],
    ]);
    const trimmer = trimMessages({
      maxTokens: 4000,
      strategy: "last",
      includeSystem: true,
      allowPartial: false,
      tokenCounter: (ms) => ms.length,
    });

    // 7) Define the graph node
    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const msgs = await trimmer.invoke(state.messages);
      const prompt = await promptTemplate.invoke({ 
        messages: msgs,
        context: contextStr,
      });
      const res = await llm.invoke(prompt);
      return { messages: [res] };
    };

    // 8) Initialize better-sqlite3 and the SqliteSaver correctly
    const db = new Database("./chat-history.sqlite");
    const checkpointer = new SqliteSaver(db);
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("model", callModel)
      .addEdge(START, "model")
      .addEdge("model", END)
      .compile({ checkpointer });

    // 9) Generate a proper UUID for the thread if one doesn't exist
    const finalThreadId = threadId?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || uuidv4();
    
    // 10) Invoke with the stable threadId and the appropriate message (enhanced or original)
    const result = await graph.invoke(
      { messages: [new HumanMessage(msg)] },
      { configurable: { thread_id: finalThreadId } }
    );
    const assistantMsg = result.messages.at(-1)!.content;

    // Use Zod-structured output to split the assistant's answer
    const responseSchema = z.object({
      textResponse: z
        .string()
        .describe("Plain-language explanation without code fences."),
      codeBlock: z
        .string()
        .optional()
        .describe("Code content without backticks or language fences."),
      language: z.string().optional().default("typescript"),
    });

    // Converter prompt: take the model's answer and extract fields
    const converterPrompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "You will receive an assistant answer. Extract two parts: a plain text explanation (textResponse) and, if present, a code block's content without backticks (codeBlock) and its language (language). If no code is present, omit codeBlock and language.",
      ],
      [
        "human",
        "Answer to convert into structured fields:\n{answer}\n\nOnly provide the fields requested.",
      ],
    ]);

    const extractor = llm.withStructuredOutput(responseSchema, {
      name: "ChatResponse",
    });

    const conversionInput = await converterPrompt.invoke({
      answer:
        typeof assistantMsg === "string"
          ? assistantMsg
          : JSON.stringify(assistantMsg),
    });

    const structured = await extractor.invoke(conversionInput);
    const combinedResponse = structured.codeBlock
      ? `${structured.textResponse}\n\n\`\`\`${structured.language || "text"}\n${structured.codeBlock}\n\`\`\``
      : structured.textResponse;

    // Persist the final turn
    try {
      console.log('Attempting to save to chat_data:', {
        thread_id: finalThreadId,
        user_query: msg,
        has_bot_response: !!assistantMsg,
        sources_count: sources.length
      });
      
      const { data, error } = await supabase
        .from('chat_data')
        .insert({
          user_query: isEnhancedQuery ? originalMessage : msg,
          enhanced_query: isEnhancedQuery ? msg : null,
          bot_response: combinedResponse,
          context_urls: sources.map((s) => s.url),
          similarity_scores: sources.map((s) => ({ url: s.url, score: s.score })),
          thread_id: finalThreadId,
          email: user?.email || null,
        })
        .select();

      if (error) {
        console.error('Error saving to Supabase:', error);
      } else {
        console.log('Successfully saved to chat_data:', data);
      }
    } catch (e) {
      console.error('Exception while saving to Supabase:', e);
    }

    // Return the response
    return NextResponse.json({
      success: true,
      response: combinedResponse,
      structuredResponse: structured,
      threadId: finalThreadId,
    });
  } catch (err) {
    console.error("POST error:", err);
    return NextResponse.json(
      { success: false, message: "Failed to process chat" },
      { status: 500 }
    );
  }
}
