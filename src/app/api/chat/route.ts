import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
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

interface RetrievedSource {
  url: string;
  score: number;
  codeSummary: string;
  summaryEmbedding: number[] | null;
  reasoning?: string;
}

// --- Supabase setup ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// --- Utility functions ---

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



export async function POST(request: Request) {
  try {
    const body = await request.json();
    const msg = body.message as string;
    const sources = body.sources as RetrievedSource[];
    const threadId = body.threadId as string | undefined;

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

    // Build context string with reasoning and file content for each source
    const contextStr = await Promise.all(sources.map(async (source) => {
      const fileContent = await fetchFileContent(source.url);
      return `Reasoning: ${source.reasoning || 'Selected based on relevance score.'}\nFile Content:\n${fileContent}`;
    })).then(results => results.join('\n\n' + '-'.repeat(80) + '\n\n'));

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

    // 9) Invoke with a stable threadId
    const finalThreadId = threadId || uuidv4();
    const result = await graph.invoke(
      { messages: [new HumanMessage(msg)] },
      { configurable: { thread_id: finalThreadId } }
    );
    const assistantMsg = result.messages.at(-1)!.content;

    // Persist the final turn
    await supabase.from("chat_data").insert({
      user_query: msg,
      bot_response: assistantMsg,
      context_urls: sources.map((s) => s.url),
      similarity_scores: sources.map((s) => ({ url: s.url, score: s.score })),
      thread_id: finalThreadId,
    });

    // Return the response
    return NextResponse.json({
      success: true,
      response: assistantMsg,
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
