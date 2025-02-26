import { NextResponse } from "next/server";
import { HfInference } from "@huggingface/inference";

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY!);

interface Summary {
  codeSummary: string;
  summaryEmbedding: number[] | null;
  url: string;
}

async function generateEmbeddings(text: string): Promise<number[]> {
  try {
    const response = await hf.featureExtraction({
      model: "sentence-transformers/all-MiniLM-L6-v2",
      inputs: text,
    });
    return response as number[];
  } catch (error) {
    console.error("Error generating embeddings:", error);
    throw error;
  }
}

// Helper function to compute cosine similarity between two vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] ** 2;
    normB += vecB[i] ** 2;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Generate the embedding for the input query
    const message_embedding = await generateEmbeddings(body.message);
    console.log("Query Embedding Dimension", message_embedding.length);

    // Retrieve the summaries from the request body
    const summaries: Summary[] = body.summaries;
    console.log("User Query:", body.message);

    // Log the list of URLs from the summaries
    const urls = summaries.map((summary) => summary.url);
    console.log("Number of items in the List of URLs:", urls.length);

    // Compute cosine similarity for each summary (if embedding exists)
    const similarityResults = summaries
      .filter(summary => summary.summaryEmbedding !== null)
      .map(summary => {
        const score = cosineSimilarity(message_embedding, summary.summaryEmbedding!);
        return { score, url: summary.url };
      });

    // Sort the results in descending order based on the similarity score
    similarityResults.sort((a, b) => b.score - a.score);

    // Log the results
    console.log("Similarity Results (sorted descending):", similarityResults);

    return NextResponse.json({ success: true, results: similarityResults });
  } catch (error) {
    console.error("Error processing chat request:", error);
    return NextResponse.json(
      { success: false, message: "Error processing request" },
      { status: 500 }
    );
  }
}
