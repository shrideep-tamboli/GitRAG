import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

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
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = body.message as string;
    const summaries = body.summaries as Array<{
      codeSummary: string;
      summaryEmbedding: number[] | null;
      url: string;
    }>;

    // 1) Embed the user query
    const queryEmbedding = await generateEmbeddings(message);

    // 2) Compute similarity scores for all summaries
    const sims = summaries
      .filter((s) => s.summaryEmbedding)
      .map((s) => ({
        ...s,
        score: cosineSimilarity(queryEmbedding, s.summaryEmbedding!),
      }));

    // Sort the results in descending order based on the score
    sims.sort((a, b) => b.score - a.score);

    // Select the top 3 highest scoring summaries
    const top3Sims = sims.slice(0, 3);

    // Return the top sources
    return NextResponse.json({
      success: true,
      sources: top3Sims.map(s => ({
        url: s.url,
        score: s.score,
        codeSummary: s.codeSummary,
        summaryEmbedding: s.summaryEmbedding
      }))
    });
  } catch (err) {
    console.error("Retrieve error:", err);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve relevant sources" },
      { status: 500 }
    );
  }
}
