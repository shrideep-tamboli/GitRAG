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
    const selectedContext = body.context as string[];

    if (!sources || !Array.isArray(sources)) {
      throw new Error("No sources provided");
    }

    console.log("Processing chat with", sources.length, "sources");

    // Fetch file contents and build context
    const structured = await Promise.all(
      sources.map(async (s) => ({
        filePath: s.url.includes("/contents/")
          ? s.url.split("/contents/")[1]
          : s.url.split("/main/")[1] || s.url,
        fileContent: await fetchFileContent(s.url),
        codeSummary: s.codeSummary,
      }))
    );

    // 4) Escape all braces in the JSON context so LangChain's template parser won't choke
    const contextStr = JSON.stringify(structured, null, 2)
      .replace(/[{]/g, "{{")
      .replace(/[}]/g, "}}");

    // 5) Build a prompt template
    const promptTemplate = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a concise assistant. If you're given a selectedContext array, use it to answer the user's question. Here's the selectedContext array: ${selectedContext}. 
        If you're not given a selectedContext array, use the following files as context (path, content, summary) to answer the user's question:${contextStr}`,
      ],
      ["placeholder", "{messages}"],
    ]);

    // 6) LLM wrapper & trimmer
    const llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GEMINI_API_KEY,
    });
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
      const prompt = await promptTemplate.invoke({ messages: msgs });
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
