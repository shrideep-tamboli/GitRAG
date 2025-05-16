import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
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

// --- Supabase setup ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// --- Google AI setup ---
interface EmbeddingValue { values: number[] }
interface EmbeddingResponse {
  embeddings: EmbeddingValue[];
  data?: { embeddings: number[][] };
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

// --- Utility functions ---
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

async function fetchFileContent(url: string): Promise<string | null> {
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

interface Summary {
  codeSummary: string;
  summaryEmbedding: number[] | null;
  url: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const msg = body.message as string;
    const summaries = body.summaries as Summary[];

    // 1) Embed the user query
    const queryEmbedding = await generateEmbeddings(msg);

    // 2) Compute similarity scores for all summaries
    console.log("Received summaries count:", summaries.length);
    console.log("Summaries with embeddings count:", summaries.filter(s => s.summaryEmbedding).length);

    const sims = summaries
      .filter((s) => s.summaryEmbedding)
      .map((s) => {
        const score = cosineSimilarity(queryEmbedding, s.summaryEmbedding!);
        console.log(`URL: ${s.url}, Score: ${score}`);
        return {
          ...s,
          score,
        };
      });

    // Sort the results in descending order based on the score
    sims.sort((a, b) => b.score - a.score);

    // Select the top 3 highest scoring summaries
    const top3Sims = sims.slice(0, 3);

    // Log the top 3 highest scoring URLs
    console.log("Top 3 Retrieved Code Files:", top3Sims.map(s => s.url), top3Sims.map(s => ({ url: s.url, score: s.score })));

    // 3) Fetch file contents and build context
    const structured = await Promise.all(
      top3Sims.map(async (s) => ({
        filePath: s.url.includes("/contents/")
          ? s.url.split("/contents/")[1]
          : s.url.split("/main/")[1] || s.url,
        fileContent: (await fetchFileContent(s.url)) || "No content",
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
        `You are a concise assistant. Use the following files as context (path, content, summary)
        to answer the user's question in ≤3 sentences:${contextStr}`,
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
    const threadId = body.threadId || uuidv4();
    const result = await graph.invoke(
      { messages: [new HumanMessage(msg)] },
      { configurable: { thread_id: threadId } }
    );
    const assistantMsg = result.messages.at(-1)!.content;

    // 10) Persist the final turn
    await supabase.from("chat_data").insert({
      user_query: msg,
      bot_response: assistantMsg,
      context_urls: top3Sims.map((s) => s.url),
      similarity_scores: top3Sims.map((s) => ({ url: s.url, score: s.score })),
      thread_id: threadId,
    });

    return NextResponse.json({
      success: true,
      response: assistantMsg,
      threadId,
    });
  } catch (err) {
    console.error("POST error:", err);
    return NextResponse.json(
      { success: false, message: "Failed to process chat" },
      { status: 500 }
    );
  }
}
